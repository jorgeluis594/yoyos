import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { Currency } from "@shared/money";
import { limaCalendarDay } from "@shared/orders-date";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import type { RegisteredTool, ToolRun, ToolRunError } from "@core/src/features/assistants/application/answer-tool-call";
import { maxCombination, maxProductName, type Display } from "@core/src/features/assistants/domain/order-projection";
import { moreProductsLine } from "@core/src/features/assistants/domain/product-projection";
import { resolveSalesPeriod, type SalesPeriod } from "@core/src/features/assistants/domain/sales-period";
import {
  clipText, otherCurrencySales, rankOneProduct, rankSoldProducts,
  type ProjectableDescribedVariant, type ProjectableSold, type RankedProduct,
} from "@core/src/features/assistants/domain/product-sales-projection";
import { day, page, unknownField } from "@core/src/features/assistants/presentation/tools/input-fields";
import { display as defaultDisplay } from "@core/src/features/assistants/presentation/display";
import { todayLine } from "@core/src/features/assistants/presentation/tools/orders-texts";
import { noProductMessage, pageOutOfRangeMessage } from "@core/src/features/assistants/presentation/tools/products-texts";
import { periodRefusalMessage } from "@core/src/features/assistants/presentation/tools/sales-texts";
import {
  bestSellersDescription, bestSellersHeader, bestSellersTextHeader, ignoredWithProductNote, moreVariantsLine, noProductSalesInCurrencyMessage, noProductSalesMessage,
  noSingleProductSalesInCurrencyMessage, noSingleProductSalesMessage, noTextSalesMessage, otherCurrencyLine, periodPhrase, shareLine, singleProductHeader, unitsText,
} from "@core/src/features/assistants/presentation/tools/product-sales-texts";

type Failure = ToolRunError;
type Read<T> = Promise<Result<T, Failure>>;

/** What the tool asks of the sales reads: the period as whole Lima days, and either the ranking (narrowed by `text`) or one product. */
export type BestSellersRequest =
  | Readonly<{ kind: "ranking"; period: SalesPeriod; text?: string }>
  | Readonly<{ kind: "product"; period: SalesPeriod; productId: string }>;
/** The sold variants of the period with the products they belong to; a `product` request that finds no product of the store answers `product_not_found` and reads no order. */
export type BestSellersAnswer =
  | Readonly<{ kind: "sold"; storeCurrency: Currency; sold: ProjectableSold; described: readonly ProjectableDescribedVariant[] }>
  | Readonly<{ kind: "product_not_found" }>;

/** What the tool needs of orders and products; `src/composition/assistant-product-sales-capabilities.ts` wires the composed operations. */
export type BestSellersDependencies = Readonly<{
  clock: () => Date;
  appLink: (productId: string) => string;
  read: (request: BestSellersRequest, access: AssistantAccess) => Read<BestSellersAnswer>;
}>;

const optionalPage = page.unwrap().optional();
const inputSchema = z.strictObject({
  desde: day.optional(), hasta: day.optional(),
  orden: z.enum(["unidades", "monto"], { error: 'El orden puede ser "unidades" o "monto".' }).optional(),
  texto: z.string({ error: "texto debe ser un texto." }).trim().max(120, "texto admite como máximo 120 caracteres.").optional(),
  producto: z.string({ error: "producto debe ser un texto." }).trim().min(1, "producto no puede estar vacío.").max(100, "producto admite como máximo 100 caracteres.").optional(),
  pagina: optionalPage,
}, unknownField);

const text = z.string();
const variantSchema = z.strictObject({ combinacion: text, unidades: z.number(), monto: text });
const productSchema = z.strictObject({
  id: text, nombre: text, unidades: z.number(), monto: text, participacion: text, enlace: text,
  variantes: z.array(variantSchema).readonly().optional(), mas_variantes: text.optional(),
});
const outputSchema = z.strictObject({
  hoy: text, resumen: text.optional(), mensaje: text.optional(), nota: text.optional(), pagina: z.number(), total: z.number(), hay_mas: text.optional(),
  productos: z.array(productSchema).readonly(), otras_monedas: z.array(text).readonly().optional(),
});
export type BestSellersOutput = z.output<typeof outputSchema>;

const invalid = (message: string): Failure => ({ code: "INVALID_INPUT", message });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BestSellersOptions = Readonly<{ display?: Display }>;

export function createBestSellersTool(deps: BestSellersDependencies, options: BestSellersOptions = {}): RegisteredTool<z.output<typeof inputSchema>, BestSellersOutput> {
  const display = options.display ?? defaultDisplay;

  const productItem = (ranked: RankedProduct): BestSellersOutput["productos"][number] => ({
    id: ranked.productId, nombre: clipText(ranked.name, maxProductName), unidades: ranked.units, monto: display.money(ranked.amount), participacion: shareLine(ranked.share),
    enlace: deps.appLink(ranked.productId),
    ...ranked.variants.length > 0 ? { variantes: ranked.variants.map((variant) => ({ combinacion: clipText(variant.combination, maxCombination), unidades: variant.units, monto: display.money(variant.amount) })) } : {},
    ...ranked.moreVariants > 0 ? { mas_variantes: moreVariantsLine(ranked.moreVariants) } : {},
  });

  return {
    name: "lo_mas_vendido", title: "Lo más vendido", description: bestSellersDescription, inputSchema, outputSchema,
    sampleOutputs: [sampleRanking(), sampleSingleProduct(60)],
    async run(input, access): Promise<ToolRun<BestSellersOutput>> {
      const today = limaCalendarDay(deps.clock());
      const resolved = resolveSalesPeriod({ ...input.desde === undefined ? {} : { desde: input.desde }, ...input.hasta === undefined ? {} : { hasta: input.hasta } }, today);
      if (!resolved.success) return err(invalid(periodRefusalMessage(resolved.error)));
      const period = resolved.data;
      const phrase = periodPhrase(period, display);
      const frame = { hoy: todayLine(display.day(today)) };

      if (input.producto !== undefined) {
        // A product identifier that is not a UUID cannot exist: it answers like an unknown product, without a read.
        if (!uuid.test(input.producto)) return err({ code: "NOT_FOUND", message: noProductMessage });
        const answer = await deps.read({ kind: "product", period, productId: input.producto.toLowerCase() }, access);
        if (!answer.success) return answer;
        if (answer.data.kind === "product_not_found") return err({ code: "NOT_FOUND", message: noProductMessage });
        const { storeCurrency, sold, described } = answer.data;
        const name = clipText(described[0]?.productName ?? "", maxProductName);
        const ignored = input.texto !== undefined && input.texto !== "" || input.orden !== undefined || input.pagina !== undefined;
        const note = ignored ? { nota: ignoredWithProductNote } : {};
        const others = otherCurrencySales(sold, described, storeCurrency, true).map((sale) => otherCurrencyLine(sale, display, { kind: "product", name }));
        const otherFields = others.length > 0 ? { otras_monedas: others } : {};
        const one = rankOneProduct(sold, described, storeCurrency);
        if (one === null) {
          const message = others.length > 0 ? noSingleProductSalesInCurrencyMessage(name, storeCurrency, phrase) : noSingleProductSalesMessage(name, phrase);
          return ok({ output: { ...frame, mensaje: message, ...note, pagina: 1, total: 0, productos: [], ...otherFields }, empty: true });
        }
        const resumen = singleProductHeader(name, phrase, one.units, display.money(one.amount), one.share, display.money(one.wholeAmount));
        return ok({ output: { ...frame, resumen, ...note, pagina: 1, total: 1, productos: [productItem(one)], ...otherFields }, empty: false });
      }

      const answer = await deps.read({ kind: "ranking", period, ...input.texto ? { text: input.texto } : {} }, access);
      if (!answer.success) return answer;
      if (answer.data.kind === "product_not_found") return err({ code: "NOT_FOUND", message: noProductMessage });
      const { storeCurrency, sold, described } = answer.data;
      const searched = input.texto === undefined || input.texto === "" ? undefined : input.texto;
      const current = input.pagina ?? 1;
      const ranking = rankSoldProducts(sold, described, { order: input.orden === "monto" ? "amount" : "units", page: current, storeCurrency, ...searched ? { text: searched } : {} });
      const others = otherCurrencySales(sold, described, storeCurrency, searched !== undefined)
        .map((sale) => otherCurrencyLine(sale, display, searched === undefined ? { kind: "all" } : { kind: "text", text: searched }));
      const otherFields = others.length > 0 ? { otras_monedas: others } : {};
      if (ranking.total === 0) {
        const hasSales = sold.currencies.some((total) => total.units > 0);
        const message = searched !== undefined ? noTextSalesMessage(searched, phrase)
          : hasSales ? noProductSalesInCurrencyMessage(storeCurrency, phrase) : noProductSalesMessage(phrase);
        return ok({ output: { ...frame, mensaje: message, pagina: 1, total: 0, productos: [], ...otherFields }, empty: true });
      }
      if (ranking.items.length === 0) {
        return ok({ output: { ...frame, mensaje: pageOutOfRangeMessage(ranking.total), pagina: current, total: ranking.total, productos: [], ...otherFields }, empty: true });
      }
      const amount = display.money(ranking.amount);
      const resumen = searched === undefined ? bestSellersHeader(phrase, ranking.units, ranking.total, amount)
        : bestSellersTextHeader(phrase, searched, ranking.units, ranking.total, amount, display.money(ranking.wholeAmount));
      const more = moreProductsLine(current, ranking.total);
      return ok({
        output: { ...frame, resumen, pagina: current, total: ranking.total, ...more === undefined ? {} : { hay_mas: more }, productos: ranking.items.map(productItem), ...otherFields },
        empty: false,
      });
    },
  };
}

// Sample outputs for the static validator: maximum-length texts, so the 24 KB budget is checked on realistic worst cases.
const long = (length: number, seed = "x") => seed.repeat(length).slice(0, length);
const uuidSample = "0123abcd-0000-4000-8000-000000000000";
const sampleProduct = (variants: number, more: number): BestSellersOutput["productos"][number] => ({
  id: uuidSample, nombre: long(maxProductName, "Polo "), unidades: 99_999, monto: "S/ 99,999,999.00", participacion: "menos de 1% de tus ventas de productos del periodo",
  enlace: `https://app.yoyos.lat/products/${uuidSample}`,
  variantes: Array.from({ length: variants }, () => ({ combinacion: long(maxCombination, "M / Azul "), unidades: 99_999, monto: "S/ 99,999,999.00" })),
  ...more > 0 ? { mas_variantes: moreVariantsLine(more) } : {},
});
function sampleRanking(): BestSellersOutput {
  return {
    hoy: "Hoy es 31/10/2026", resumen: bestSellersTextHeader("del 01/10/2026 al 31/10/2026 (hasta hoy)", long(120, "polo "), 999_999, 20_000, "S/ 99,999,999.00", "S/ 99,999,999.00"),
    pagina: 1, total: 21, hay_mas: "hay más: pide la página 2", productos: Array.from({ length: 20 }, () => sampleProduct(3, 97)),
    otras_monedas: ["USD", "EUR"].map((currency) => `Además vendiste en ${currency}, entre los productos que coinciden con "${long(120, "polo ")}": ${unitsText(99_999)}, US$ 99,999,999.00, fuera de estas cifras.`),
  };
}
function sampleSingleProduct(variants: number): BestSellersOutput {
  return {
    hoy: "Hoy es 31/10/2026", nota: ignoredWithProductNote,
    resumen: singleProductHeader(long(maxProductName, "Polo "), "del 01/10/2026 al 31/10/2026 (hasta hoy)", 99_999, "S/ 99,999,999.00", { kind: "percent", value: 100 }, "S/ 99,999,999.00"),
    pagina: 1, total: 1, productos: [sampleProduct(variants, 0)],
    otras_monedas: [`Además vendiste "${long(maxProductName, "Polo ")}" en USD: ${unitsText(99_999)}, US$ 99,999,999.00, fuera de estas cifras.`],
  };
}
