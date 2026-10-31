import { describe, expect, test, vi } from "vitest";
vi.mock("@core/src/composition/event-bus", () => ({ applicationEventBus: () => ({ publishEvent: vi.fn() }) }));
vi.mock("@core/src/shared/infrastructure/persistance", () => ({
  getCompanyId: () => "00000000-0000-4000-8000-000000000001", withTenantIsolation: (_company: string, work: () => unknown) => work() }));

import { createMessageCandidateLimits, createVisualSearch } from "@core/src/features/products/composition";
import { maxPhotoCandidates } from "@core/src/features/products/infrastructure/product-matching/visual-stages-cost";
import { chatMessageDeadlineMs } from "@core/src/features/orders/application/chat-message-policy";
import { createFitReadingContext, messageCostBoundUsd, readerOutputTokenLimit, readerTokenBudget, tokenizerRatio } from "@core/src/features/orders/infrastructure/chat-reader-budget";
import { aiTimeoutMaxMs } from "@core/src/features/orders/infrastructure/chat-reader-env";
import { context, id, pending, productId, readingProduct } from "@core/src/features/orders/infrastructure/chat-reading-fixtures";
import { priceOf } from "@core/src/shared/infrastructure/model-prices";
import type { ChatReadingContext, ReadingItem, ReadingPending } from "@core/src/features/orders/domain/chat-reading";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

/** Prisma's interactive transaction timer (`persistance.ts`), which the lock waits of the message transaction end inside. */
const transactionTimerMs = 5_000;
const price = priceOf("gpt-6-luna")!;
const readerCostUsd = (inputTokens: number) => (inputTokens * tokenizerRatio * price.input + readerOutputTokenLimit * price.output) / 1_000_000;

/** Every setting of the photo stages at its bound, with the OpenAI describer: the most a photo message can pay besides the reader. */
const worstPhotoStages = createVisualSearch({ OPENAI_API_KEY: "key", IMAGE_EMBEDDER_PROVIDER: "openai", PRODUCT_MATCH_CANDIDATES: String(maxPhotoCandidates), PRODUCT_MATCH_TIMEOUT_MS: "20000" });

describe("the cost and the time of one message at the bounds of every setting", () => {
  test("with every setting at its bound, the worst photo message and the worst text message cost at most US$0.003", () => {
    const budget = readerTokenBudget({ photoStagesReserveUsd: worstPhotoStages.photoStagesReserveUsd });
    expect(worstPhotoStages.photoStagesReserveUsd).toBeGreaterThan(0);
    expect(readerCostUsd(budget.textInputTokens)).toBeLessThanOrEqual(messageCostBoundUsd);
    expect(worstPhotoStages.photoStagesReserveUsd + readerCostUsd(budget.photoInputTokens)).toBeLessThanOrEqual(messageCostBoundUsd);
    // A photo pays its stages first, so its reader budget is the smaller one.
    expect(budget.photoInputTokens).toBeLessThan(budget.textInputTokens);
  });

  test("any photo reserve the startup check admits keeps the photo message within the bound, and a larger one fails at startup", () => {
    for (const reserve of [0, 0.00099, 0.00125, 0.0016, 0.0017]) {
      const budget = readerTokenBudget({ photoStagesReserveUsd: reserve });
      expect(reserve + readerCostUsd(budget.photoInputTokens)).toBeLessThanOrEqual(messageCostBoundUsd);
    }
    expect(() => readerTokenBudget({ photoStagesReserveUsd: 0.0018 })).toThrow();
  });

  test("the settings that bound the cost fail at startup above their bound", () => {
    expect(() => createVisualSearch({ OPENAI_API_KEY: "key", PRODUCT_MATCH_CANDIDATES: String(maxPhotoCandidates + 1) })).toThrow();
    expect(() => createVisualSearch({ OPENAI_API_KEY: "key", PRODUCT_MATCH_TIMEOUT_MS: "20001" })).toThrow();
  });

  test("with every time setting at its bound, the photo-stage deadline, the candidate search, the reader and the transaction timer fit the attempt deadline", () => {
    const candidateSearchMs = createMessageCandidateLimits({}).timeoutMs;
    expect(worstPhotoStages.photoStageTimeoutMs).toBe(40_000);
    expect(aiTimeoutMaxMs).toBe(35_000);
    const slowestAttemptMs = worstPhotoStages.photoStageTimeoutMs + candidateSearchMs + aiTimeoutMaxMs + transactionTimerMs;
    expect(slowestAttemptMs).toBe(81_000);
    expect(slowestAttemptMs).toBeLessThan(chatMessageDeadlineMs);
  });
});

const sizes = ["XS", "S", "M", "L", "XL", "XXL", "28", "30", "32", "34", "36", "38"];
const colors = ["Negro", "Blanco", "Rojo", "Azul", "Verde", "Gris"];
const catalogProduct = (n: number) => readingProduct(n, `Polera con capucha modelo ${n}`, sizes.flatMap((Talla, row) => colors.map((Color, column): [Record<string, string>, number] => [{ Talla, Color }, 30 + row + column / 10 + n / 100])));
const usualProduct = (n: number) => readingProduct(n, `Producto de catálogo ${n}`, [["S", "M", "L"].flatMap((Talla) => ["Negro", "Blanco"].map((Color): [Record<string, string>, number] => [{ Talla, Color }, 45]))][0]!);

describe("what the budget keeps", () => {
  const fit = (kind: "text" | "photo_product") => createFitReadingContext({ budget: readerTokenBudget({ photoStagesReserveUsd: kind === "text" ? 0 : worstPhotoStages.photoStagesReserveUsd }) });
  const withProducts = (kind: "text" | "photo_product", products: ChatReadingContext["products"]): ChatReadingContext =>
    context({ kind, text: "quiero la polera negra en M", products });
  /** PR #248's worst case: 24 products of 72 priced combinations, 40 items, 10 doubtful pendings of 4 candidates and a text of 2,000 characters. */
  const synthetic = (): ChatReadingContext => {
    const products = Array.from({ length: 24 }, (_, index) => catalogProduct(index + 1));
    const items: ReadingItem[] = Array.from({ length: 40 }, (_, index) => ({ ref: `I${index + 1}`, variantId: id(9000 + index) as VariantId, productId: productId((index % 24) + 1),
      productName: `Polera con capucha modelo ${(index % 24) + 1}`, variantAttributes: { Talla: sizes[index % sizes.length]!, Color: colors[index % colors.length]! }, quantity: 1 + (index % 4),
      unitPrice: { amount: 45.5, currency: "PEN" }, photoJustSent: false }));
    const pendings: ReadingPending[] = Array.from({ length: 10 }, (_, index) => ({ ref: `Q${index + 1}`, photoJustSent: false,
      pending: pending(index + 1, { subject: { kind: "product", candidates: [productId(index + 1), productId(index + 2), productId(index + 3), productId(index + 4)] }, quantity: 2 as PositiveInteger }) }));
    return context({ kind: "text", text: "quiero la polera negra en M ".repeat(80).slice(0, 2000), latestOrder: "open", items, pendings, products });
  };

  test("the synthetic catalog of PR #248 keeps at least 16 products as a text", () => {
    const fitted = fit("text")(synthetic());
    expect("code" in fitted).toBe(false);
    if (!("code" in fitted)) {
      expect(fitted.context.products.length).toBeGreaterThanOrEqual(16);
      expect(fitted.droppedProducts).toBe(24 - fitted.context.products.length);
    }
  });

  test("the usual case drops nothing as a text and as a captioned photo", () => {
    for (const kind of ["text", "photo_product"] as const) {
      const products = Array.from({ length: 12 }, (_, index) => usualProduct(index + 1));
      const shown = products.map((product, index) => (kind === "photo_product" && index === 0 ? { ...product, shown: true, shownVariantId: product.variants[0]!.variantId } : product));
      const fitted = fit(kind)(withProducts(kind, shown));
      expect("code" in fitted).toBe(false);
      if (!("code" in fitted)) expect(fitted).toMatchObject({ droppedProducts: 0 });
    }
  });
});
