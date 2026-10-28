import { describe, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { applyChatMessage, type ApplyChatMessageDependencies, type ChatSourceMessage } from "@core/src/features/orders/application/apply-chat-message";
import { createChatToolRegistry } from "@core/src/features/orders/application/chat-message-tools";
import type { ChatContextItem } from "@core/src/features/orders/application/chat-tool-types";
import { createChatInterpreter } from "@core/src/features/orders/application/chat-message-interpreter";
import { identifyProductsInText, type IdentifyProductInTextDependencies } from "@core/src/features/products/application/identify-product-in-text";
import { resolveVariant } from "@core/src/features/products/application/resolve-variant";
import type { ImageIdentification } from "@core/src/features/products/application/identify-products-in-image";
import type { DecisionAnswers, DecisionRequest, ExtractionRequest, OrchestrateDependencies, ToolCall } from "@core/src/shared/ai-tools/application/orchestrate";
import type { AiError } from "@core/src/shared/ai-tools/application/ai-error";
import { mentionedPriceNote } from "@shared/mentioned-price";
import { chooseSellerNotice } from "@core/src/features/orders/domain/seller-notice";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order";
import type { ChatMessageOutcomes, StoredChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, ContactId, OrderId, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { CatalogItem, MatchConfidence } from "@core/src/features/products/domain/image-identification";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductRef, ProductWithSellableVariants, TextCandidate, TextIdentification, VariantChoice, VariantChoiceInput } from "@core/src/features/products/domain/text-identification";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1) as CompanyId;
const messageId = id(2) as ChatMessageId;
const chatId = id(3) as ChatId;
const contactId = id(4) as ContactId;
const sellerId = "uploader" as UserId;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const at = new Date("2026-10-11T12:00:00Z");
const productPolo = id(10) as ProductId;
const productCap = id(11) as ProductId;
const variant = (n: number, name: string, attributes: Record<string, string>, amount = 35): CatalogItem =>
  ({ variantId: id(100 + n) as VariantId, productName: name, variantAttributes: attributes, sku: null, unitPrice: money(amount) });
const poloM = variant(1, "Polo básico", { Talla: "M" });
const poloL = variant(2, "Polo básico", { Talla: "L" });
const cap = variant(3, "Gorra", {}, 25);
const catalog: readonly ProductWithSellableVariants[] = [
  { productId: productPolo, name: "Polo básico", variants: [poloM, poloL] },
  { productId: productCap, name: "Gorra", variants: [cap] },
];

const photoMessage = (over: Partial<ChatSourceMessage> = {}): ChatSourceMessage => ({ id: messageId, companyId, chatId, contactId, direction: "incoming", uploadedByUserId: sellerId,
  imageId: id(5) as ImageId, text: null, caption: null, ...over });
const textMessage = (text: string | null, over: Partial<ChatSourceMessage> = {}): ChatSourceMessage => photoMessage({ imageId: null, text, ...over });

const visual = (productId: ProductId, confidence = 0.92): ImageIdentification =>
  ({ kind: "found", method: "visual", productId, confidence: confidence as MatchConfidence, candidates: 2, topDistance: 0.1, chosenDistance: 0.1 });
const qr = (item: CatalogItem, productId: ProductId): ImageIdentification => ({ kind: "found", method: "qr", items: [{ ...item, productId }], unknownCodes: [] });
const notFound: ImageIdentification = { kind: "not_found", reason: "no_visual_match", topDistance: 0.5 };
const notProduct: ImageIdentification = { kind: "not_product", topDistance: 0.5 };

const existingOrder = (items: OrderAggregate["items"] = [{ id: id(60) as OrderItemId, variantId: cap.variantId, productName: "Gorra", variantAttributes: {}, sku: null,
  quantity: 1 as PositiveInteger, unitPrice: money(25), subtotal: money(25), mentionedPrice: null }]): OrderAggregate => ({
  number: 1007 as OrderNumber, id: id(9) as OrderId, companyId, sellerId, chatId, buyer: { contactId, name: null, phone: null },
  fromCatalog: false, checkoutEnabledAt: null, checkoutConfirmedAt: null, createdAt: at, scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null, cancelled: false,
  items, payments: [], delivery: null, deliveryStatus: "pending", stockDeducted: false,
  itemsTotal: money(25), deliveryCost: money(0), deliveryCharge: money(0), total: money(25) });

type Options = Readonly<{
  message?: ChatSourceMessage | null;
  identification?: ImageIdentification;
  decision?: (request: DecisionRequest) => DecisionAnswers | AiError;
  extraction?: (request: ExtractionRequest) => readonly ToolCall[];
  variantChoice?: VariantChoice;
  /** What the text identification answers for each product mention; unlisted mentions are not found. */
  identify?: Readonly<Record<string, TextIdentification>>;
  /** Runs the real text identification over these dependencies instead of `identify`. */
  textLookup?: IdentifyProductInTextDependencies;
  topCandidate?: ProductRef | null;
  target?: ChatOrderTarget;
  stored?: StoredChatMessageOutcome;
  readiness?: "ready" | "no_searchable_photos" | "no_active_products";
  interpretationEnabled?: boolean;
  catalog?: readonly ProductWithSellableVariants[];
  overrides?: Partial<ApplyChatMessageDependencies>;
}>;

const answer = (choice: string, confidence = 0.95): DecisionAnswers => ({ action: { choice, confidence }, predicates: {}, choices: {} });
const emptyContext: readonly ChatContextItem[] = [];

/**
 * A fake variant chooser: none for a word that is no sellable value; else the variant whose every value is one of the words, or kept from
 * the base when no word names another value of that attribute, or is the attribute's only sellable value. The real chooser is a model.
 */
function valuesChooser({ words, variants, base }: VariantChoiceInput): VariantChoice {
  const spoken = words.join(" ").toLowerCase().split(/\s+/);
  const valuesOf = (attribute: string) => new Set(variants.map(({ variantAttributes }) => variantAttributes[attribute]));
  const named = (value: string | undefined) => value !== undefined && spoken.includes(value.toLowerCase());
  const known = new Set(["talla", "color", "en", "a", ...variants.flatMap(({ variantAttributes }) => Object.values(variantAttributes).map((value) => value.toLowerCase()))]);
  if (!spoken.every((word) => known.has(word))) return { variantId: null, confidence: 0.9 };
  const fits = variants.filter(({ variantAttributes }) => Object.entries(variantAttributes).every(([attribute, value]) => named(value) || valuesOf(attribute).size === 1
    || (base?.variantAttributes[attribute] === value && ![...valuesOf(attribute)].some(named))));
  return fits.length === 1 ? { variantId: fits[0]!.variantId, confidence: 0.95 } : { variantId: null, confidence: 0.9 };
}

type Store = { orders: Map<string, OrderAggregate>; customers: Set<string>; messages: Map<string, string>; outcomes: Map<string, ChatMessageOutcomes> };

/** In-memory ports; `transaction` restores the state when its work fails, like a rollback. */
function harness(options: Options = {}) {
  const calls: string[] = [];
  const decisions: DecisionRequest[] = [];
  const extractions: ExtractionRequest[] = [];
  const variantChoices: string[][] = [];
  const identifyBatches: string[][] = [];
  const loadedVariants: ProductId[][] = [];
  const topCandidateQueries: string[] = [];
  const store: Store = { orders: new Map(), customers: new Set(), messages: new Map(), outcomes: new Map() };
  const called = <T>(name: string, value: T): T => { calls.push(name); return value; };
  const target: ChatOrderTarget = options.target ?? { kind: "none" };
  if (target.kind === "open") store.orders.set(target.order.id, target.order);
  const ai: OrchestrateDependencies = {
    minActionConfidence: 0.6, minToolPredicate: 0.5, minReportPredicate: 0.9,
    decide: async (request) => {
      decisions.push(request);
      const decided = options.decision ? options.decision(request) : answer("no_intent");
      return "code" in decided ? err(decided) : ok(decided);
    },
    extract: async (request) => { extractions.push(request); return ok(options.extraction ? options.extraction(request) : []); },
  };
  const registry = createChatToolRegistry({
    loadSellableVariants: async (ids) => { loadedVariants.push([...ids]); return ok((options.catalog ?? catalog).filter((product) => ids.includes(product.productId))); },
    resolveVariant: (input, signal) => resolveVariant(input, { minConfidence: 0.8, chooseVariant: async (choice) => {
      variantChoices.push(choice.words.slice());
      return ok(options.variantChoice ?? valuesChooser(choice));
    } }, signal),
    identifyProductsInText: async (lines, signal) => {
      if (options.textLookup) return identifyProductsInText(lines, options.textLookup, signal);
      identifyBatches.push(lines.map(({ mention }) => mention));
      return ok(lines.map(({ mention }) => options.identify?.[mention] ?? { kind: "not_found" as const }));
    },
    findTopTextCandidate: async (mention) => { topCandidateQueries.push(mention); return ok(options.topCandidate ?? null); },
  });
  const items = (): ChatContextItem[] => target.kind === "open" ? target.order.items.map((item, index) => ({ label: `I${index + 1}`, variantId: item.variantId, productId: target.productIds.get(item.variantId) ?? null,
    productName: item.productName, variantAttributes: item.variantAttributes, quantity: item.quantity, unitPrice: item.unitPrice })) : [...emptyContext];
  const deps: ApplyChatMessageDependencies = {
    findOutcome: async (key) => called("findOutcome", ok(options.stored && key === messageId ? options.stored : store.outcomes.has(key) ? { outcomes: store.outcomes.get(key)!, noticeSentAt: null } : null)),
    findSourceMessage: async () => called("findSourceMessage", ok(options.message === undefined ? photoMessage() : options.message)),
    findChatOrderContext: async () => called("findChatOrderContext", ok({ items: items() })),
    readImage: async () => called("readImage", ok({ bytes: new Uint8Array([1]), contentType: "image/jpeg" })),
    identifyProductsInImage: async () => called("identifyProductsInImage", ok(options.identification ?? visual(productCap))),
    loadSellableProducts: async (ids) => called("loadSellableProducts", ok((options.catalog ?? catalog).filter((product) => ids.includes(product.productId)))),
    catalogSearchReadiness: async () => called("catalogSearchReadiness", ok(options.readiness ?? "ready")),
    interpretationEnabled: options.interpretationEnabled ?? true,
    interpretAndApply: createChatInterpreter(registry, ai),
    transaction: async (_company, work) => {
      calls.push("transaction");
      const snapshot = structuredClone({ orders: store.orders, customers: store.customers, messages: store.messages, outcomes: store.outcomes });
      const result = await work();
      if (!result.success) Object.assign(store, snapshot);
      return result;
    },
    lockContact: async () => called("lockContact", ok(null)),
    ensureCustomerForContact: async () => { calls.push("ensureCustomerForContact"); store.customers.add("customer"); return ok({ customerId: id(400) as CustomerId }); },
    findChatOrderTargetForUpdate: async () => called("findChatOrderTargetForUpdate", ok(target.kind === "open" ? { ...target, order: store.orders.get(target.order.id)! } : target)),
    allocateNumber: async () => called("allocateNumber", ok(1008 as OrderNumber)),
    saveNewOrder: async (order) => { calls.push("saveNewOrder"); store.orders.set(order.id, order); return ok(null); },
    saveItemChanges: async (order) => { calls.push("saveItemChanges"); store.orders.set(order.id, order); return ok(null); },
    recordOrderMessage: async (orderId, key) => { calls.push("recordOrderMessage"); store.messages.set(key, orderId); return ok(null); },
    recordOutcome: async ({ messageId: key, outcomes }) => { calls.push("recordOutcome"); store.outcomes.set(key, outcomes); return ok(null); },
    newOrderId: () => id(500) as OrderId,
    newItemId: (() => { let counter = 300; return () => id(counter++) as OrderItemId; })(),
    clock: () => at,
    limits: { maxItemQuantity: 99 as PositiveInteger },
    ...options.overrides,
  };
  const controller = new AbortController();
  return { calls, decisions, extractions, variantChoices, identifyBatches, loadedVariants, topCandidateQueries, store, controller, deps, run: () => applyChatMessage({ companyId, messageId }, deps, controller.signal) };
}

const quantityOf = (store: Store, variantId: VariantId) => [...store.orders.values()].flatMap((order) => order.items).find((item) => item.variantId === variantId)?.quantity;
const outcomeKinds = (store: Store) => [...store.outcomes.values()].flatMap((outcomes) => outcomes.map(({ kind }) => kind));
const succeeded = async <T,>(result: Promise<Result<T, { code: string; message: string }>>) => { const done = await result; if (!done.success) throw new Error(done.error.code); return done.data; };

describe("applyChatMessage: photos", () => {
  test("adds the shown product of a high-certainty photo without any interpretation call", async () => {
    const h = harness({ identification: visual(productCap) });
    expect(await succeeded(h.run())).toMatchObject({ kind: "applied", createdOrder: true, noticeDue: false, outcomes: [{ kind: "added", variantId: cap.variantId, quantity: 1,
      identification: { method: "visual", productId: productCap, confidence: 0.92 } }] });
    expect(h.decisions).toHaveLength(0);
    expect(h.extractions).toHaveLength(0);
    expect(quantityOf(h.store, cap.variantId)).toBe(1);
    expect(h.calls).not.toContain("catalogSearchReadiness");
  });

  test("makes no interpretation request for a photo without a caption", async () => {
    const h = harness({ message: photoMessage({ caption: null }), identification: qr(poloM, productPolo) });
    await h.run();
    expect(h.decisions).toHaveLength(0);
    expect(quantityOf(h.store, poloM.variantId)).toBe(1);
  });

  test("adds only the photo's product when the caption names another product", async () => {
    const h = harness({ message: photoMessage({ caption: "y una gorra negra" }), identification: visual(productPolo),
      decision: () => answer("add_shown_product_with_details"), extraction: () => [{ tool: "add_shown_product_with_details", args: { variantWords: ["M"], quantity: null, perEach: false, mentionedPrice: null } }] });
    await h.run();
    expect([...h.store.orders.values()].flatMap((order) => order.items.map((item) => item.variantId))).toEqual([poloM.variantId]);
  });

  test("adds the caption's variant and quantity for a photo with details", async () => {
    const h = harness({ message: photoMessage({ caption: "2 en talla M" }), identification: visual(productPolo),
      decision: () => answer("add_shown_product_with_details"),
      extraction: () => [{ tool: "add_shown_product_with_details", args: { variantWords: ["M"], quantity: 2, perEach: false, mentionedPrice: null } }] });
    expect(await succeeded(h.run())).toMatchObject({ kind: "applied", trace: { tools: ["add_shown_product_with_details"], extraction: true, decisionCalls: 1 } });
    expect(quantityOf(h.store, poloM.variantId)).toBe(2);
    expect(h.extractions[0]!.tools.map(({ name }) => name)).toEqual(["add_shown_product_with_details"]);
  });

  test("keeps the mentioned price of a caption as a note on the added item", async () => {
    const h = harness({ message: photoMessage({ caption: "a 20 soles" }), identification: visual(productCap),
      decision: () => answer("add_shown_product_with_details"),
      extraction: () => [{ tool: "add_shown_product_with_details", args: { variantWords: [], quantity: null, perEach: false, mentionedPrice: { amount: "20", units: 1, currency: "not_named" } } }] });
    await h.run();
    const [order] = [...h.store.orders.values()];
    expect(order!.items[0]).toMatchObject({ unitPrice: money(25), mentionedPrice: { amount: money(20), units: 1 } });
    expect(order!.total).toEqual(money(25));
  });

  test("resolves a caption variant through the same variant resolution as texts", async () => {
    const h = harness({ message: photoMessage({ caption: "en la grande" }), identification: visual(productPolo), variantChoice: { variantId: poloL.variantId, confidence: 0.9 },
      decision: () => answer("add_shown_product_with_details"),
      extraction: () => [{ tool: "add_shown_product_with_details", args: { variantWords: ["la grande"], quantity: null, perEach: false, mentionedPrice: null } }] });
    await h.run();
    expect(h.variantChoices).toEqual([["la grande"]]);
    expect(quantityOf(h.store, poloL.variantId)).toBe(1);
  });

  test("lets the caption's variant win over the variant of a QR label", async () => {
    const h = harness({ message: photoMessage({ caption: "en talla L" }), identification: qr(poloM, productPolo),
      decision: () => answer("add_shown_product_with_details"),
      extraction: () => [{ tool: "add_shown_product_with_details", args: { variantWords: ["L"], quantity: null, perEach: false, mentionedPrice: null } }] });
    await h.run();
    expect(quantityOf(h.store, poloL.variantId)).toBe(1);
    expect(quantityOf(h.store, poloM.variantId)).toBeUndefined();
  });

  test("int-photo-label-other-size: «en talla L» on the M Negro label adds L Negro", async () => {
    const negroM = variant(5, "Polo básico", { Talla: "M", Color: "Negro" });
    const negroL = variant(6, "Polo básico", { Talla: "L", Color: "Negro" });
    const blancoL = variant(7, "Polo básico", { Talla: "L", Color: "Blanco" });
    const h = harness({ message: photoMessage({ caption: "en talla L" }), identification: qr(negroM, productPolo), catalog: [{ productId: productPolo, name: "Polo básico", variants: [negroM, negroL, blancoL] }],
      decision: () => answer("add_shown_product_with_details"),
      extraction: () => [{ tool: "add_shown_product_with_details", args: { variantWords: ["talla", "L"], quantity: null, perEach: false, mentionedPrice: null } }] });
    await h.run();
    expect(quantityOf(h.store, negroL.variantId)).toBe(1);
    expect(h.variantChoices).toEqual([["talla", "L"]]);
  });

  test("int-single-color-product: a text add names only the size when the color has a single sellable value", async () => {
    const beigeM = variant(5, "Polo básico", { Talla: "M", Color: "Beige" });
    const beigeL = variant(6, "Polo básico", { Talla: "L", Color: "Beige" });
    const h = harness({ message: textMessage("un polo talla L"), identify: { polo: { kind: "found", productId: productPolo, confidence: 0.9 } }, catalog: [{ productId: productPolo, name: "Polo básico", variants: [beigeM, beigeL] }],
      decision: () => answer("add_products"), extraction: () => [{ tool: "add_products", args: { lines: [{ productMention: "polo", variantWords: ["talla", "L"], quantity: null, mentionedPrice: null }] } }] });
    await h.run();
    expect(quantityOf(h.store, beigeL.variantId)).toBe(1);
    expect(h.variantChoices).toEqual([["talla", "L"]]);
  });

  test("adds one item per variant when two QR labels of a product are sent with a caption that names a variant", async () => {
    const identification: ImageIdentification = { kind: "found", method: "qr", unknownCodes: [], items: [{ ...poloM, productId: productPolo }, { ...poloL, productId: productPolo }] };
    const h = harness({ message: photoMessage({ caption: "2 en talla M" }), identification, decision: () => answer("add_shown_product_with_details"),
      extraction: () => [{ tool: "add_shown_product_with_details", args: { variantWords: ["M"], quantity: 2, perEach: false, mentionedPrice: null } }] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "added", variantId: poloM.variantId, quantity: 2 }] });
    expect(quantityOf(h.store, poloM.variantId)).toBe(2);
    expect(quantityOf(h.store, poloL.variantId)).toBeUndefined();
  });

  test("reports a missing variant for a photo of a product with several variants and no caption", async () => {
    const h = harness({ identification: visual(productPolo) });
    expect(await succeeded(h.run())).toMatchObject({ kind: "applied", orderId: null, noticeDue: true,
      outcomes: [{ kind: "variant_missing", productId: productPolo, identification: { method: "visual" } }] });
    expect(h.store.orders.size).toBe(0);
    expect(h.calls).not.toContain("ensureCustomerForContact");
    expect(h.calls).not.toContain("allocateNumber");
  });

  test("reports a missing variant and adds no gorra for a photo of a polo with the caption «quiero la gorra»", async () => {
    const h = harness({ message: photoMessage({ caption: "quiero la gorra" }), identification: visual(productPolo),
      decision: () => answer("add_shown_product_with_details"),
      extraction: () => [{ tool: "add_shown_product_with_details", args: { variantWords: [], quantity: null, perEach: false, mentionedPrice: null } }] });
    expect(await succeeded(h.run())).toMatchObject({ kind: "applied", orderId: null, noticeDue: true, outcomes: [{ kind: "variant_missing", productId: productPolo }] });
    expect(h.store.orders.size).toBe(0);
    expect(quantityOf(h.store, cap.variantId)).toBeUndefined();
  });

  test("reports a variant that is not available when the caption names one the product lacks", async () => {
    const h = harness({ message: photoMessage({ caption: "en talla XL" }), identification: visual(productPolo), variantChoice: { variantId: null, confidence: 0.9 },
      decision: () => answer("add_shown_product_with_details"),
      extraction: () => [{ tool: "add_shown_product_with_details", args: { variantWords: ["XL"], quantity: null, perEach: false, mentionedPrice: null } }] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "variant_not_available", productId: productPolo }], noticeDue: true });
    expect(h.store.orders.size).toBe(0);
  });

  test("reports quantity above limit and changes nothing for a caption of 1000 units", async () => {
    const h = harness({ message: photoMessage({ caption: "mil gorras" }), identification: visual(productCap),
      decision: () => answer("add_shown_product_with_details"),
      extraction: () => [{ tool: "add_shown_product_with_details", args: { variantWords: [], quantity: 1000, perEach: false, mentionedPrice: null } }] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "quantity_above_limit", productId: productCap }], noticeDue: true, createdOrder: false });
    expect(h.store.orders.size).toBe(0);
  });

  test("records not identified for a photo without a match even when it has a caption", async () => {
    const h = harness({ message: photoMessage({ caption: "2 de estos en talla M" }), identification: notFound });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "not_identified", source: "photo", identification: null, silent: false }], noticeDue: true });
    expect(h.decisions).toHaveLength(0);
    expect(h.extractions).toHaveLength(0);
  });

  test("never adds a product named in the caption of an unmatched photo", async () => {
    const h = harness({ message: photoMessage({ caption: "y una gorra negra" }), identification: notFound });
    await h.run();
    expect(h.store.orders.size).toBe(0);
    expect(h.calls).not.toContain("ensureCustomerForContact");
  });

  test("records no intent and no notice for a photo that does not show a product", async () => {
    const h = harness({ identification: notProduct });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "no_intent" }], noticeDue: false });
    expect(h.decisions).toHaveLength(0);
  });

  test("reports an image with a request when a non-product photo has a caption asking to add", async () => {
    const h = harness({ message: photoMessage({ caption: "y agrégame una gorra negra" }), identification: notProduct, decision: () => answer("report_request_with_non_product_image") });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "image_with_request" }], noticeDue: true });
    expect(h.decisions[0]!.action.choices.map(({ value }) => value).sort()).toEqual(["no_intent", "report_request_with_non_product_image", "several"]);
    expect(h.decisions[0]!.contextText).toContain("The photo does not show a catalog product.");
  });

  test("records no intent for a transfer screenshot whose caption only reports the payment", async () => {
    const h = harness({ message: photoMessage({ caption: "listo, ya te yapee" }), identification: notProduct, decision: () => answer("no_intent") });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "no_intent" }], noticeDue: false });
  });

  test("adds the shown product for a matched photo whose caption has no letters or digits, without an interpretation call", async () => {
    const h = harness({ message: photoMessage({ caption: "👍" }), identification: visual(productCap) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "added", variantId: cap.variantId }] });
    expect(h.decisions).toHaveLength(0);
  });

  test("adds the shown product for a matched photo whose caption action is below the minimum confidence", async () => {
    const h = harness({ message: photoMessage({ caption: "mmm" }), identification: visual(productCap), decision: () => answer("no_intent", 0.3) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "added", variantId: cap.variantId }], trace: { decisionCalls: 1 } });
  });

  test("records no intent for a matched photo whose caption declines the product", async () => {
    const h = harness({ message: photoMessage({ caption: "no lo quiero" }), identification: visual(productCap), decision: () => answer("decline_shown_product") });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "no_intent" }], noticeDue: false });
    expect(h.store.orders.size).toBe(0);
  });

  test("sends the caption with the product name and variants, never the image, to interpretation", async () => {
    const h = harness({ message: photoMessage({ caption: "dos de estos" }), identification: visual(productPolo), decision: () => answer("no_intent") });
    await h.run();
    const [request] = h.decisions;
    expect(request!.messageParts).toEqual([{ kind: "text", text: "dos de estos" }]);
    expect(request!.contextText).toContain("Polo básico");
    expect(request!.contextText).toContain("M");
    expect(request!.contextText).toContain("L");
  });

  test("names the open order's items to interpretation as labeled lines", async () => {
    const h = harness({ message: photoMessage({ caption: "uno más" }), identification: visual(productCap), target: { kind: "open", order: existingOrder(), productIds: new Map([[cap.variantId, productCap]]) },
      decision: () => answer("no_intent") });
    await h.run();
    expect(h.decisions[0]!.contextText).toContain("I1: Gorra");
  });

  test("adds a matched photo to the open order without allocating a number or creating a customer", async () => {
    const h = harness({ identification: visual(productCap), target: { kind: "open", order: existingOrder(), productIds: new Map([[cap.variantId, productCap]]) } });
    expect(await succeeded(h.run())).toMatchObject({ kind: "applied", orderId: id(9), createdOrder: false });
    expect(quantityOf(h.store, cap.variantId)).toBe(2);
    expect(h.calls).toContain("saveItemChanges");
    expect(h.calls).not.toContain("allocateNumber");
    expect(h.calls).not.toContain("ensureCustomerForContact");
    expect(h.store.messages.get(messageId)).toBe(id(9));
  });

  test("creates the order for the seller who registered the message with the customer and number of the new order", async () => {
    const h = harness({ identification: visual(productCap) });
    await h.run();
    const [order] = [...h.store.orders.values()];
    expect(order).toMatchObject({ number: 1008, sellerId, chatId, buyer: { contactId } });
    expect(h.calls.indexOf("lockContact")).toBeLessThan(h.calls.indexOf("findChatOrderTargetForUpdate"));
    expect(h.store.customers.size).toBe(1);
  });

  test("records a miss for a product that left the catalog after it was matched", async () => {
    const h = harness({ identification: visual(productCap), catalog: [] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "not_identified", source: "photo", identification: { method: "visual", productId: productCap }, silent: false }], noticeDue: true });
  });

  test("adds a photo with several QR labels and reports the missing variant of another product", async () => {
    const identification: ImageIdentification = { kind: "found", method: "qr", unknownCodes: [],
      items: [{ ...cap, productId: productCap }, { ...poloM, productId: productPolo }] };
    const h = harness({ identification });
    const done = await succeeded(h.run());
    expect(done).toMatchObject({ kind: "applied", outcomes: [{ kind: "added", variantId: cap.variantId }, { kind: "added", variantId: poloM.variantId }] });
  });

  test("records silent misses when the catalog has no searchable photos", async () => {
    for (const readiness of ["no_searchable_photos", "no_active_products"] as const) {
      const h = harness({ identification: notFound, readiness });
      expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "not_identified", silent: true }], noticeDue: false });
    }
  });

  test("processes and notifies a message whose sent date is three days old", async () => {
    const h = harness({ identification: notFound, overrides: { clock: () => new Date(at.getTime() + 3 * 24 * 3600 * 1000) } });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "not_identified", silent: false }], noticeDue: true });
  });

  test("ignores the caption and adds the shown product when interpretation is disabled", async () => {
    const h = harness({ message: photoMessage({ caption: "2 en talla M" }), identification: visual(productCap), interpretationEnabled: false });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "added", variantId: cap.variantId, quantity: 1 }] });
    expect(h.decisions).toHaveLength(0);
  });

  test("records no intent for a non-product photo with a caption when interpretation is disabled", async () => {
    const h = harness({ message: photoMessage({ caption: "agrégame una gorra" }), identification: notProduct, interpretationEnabled: false });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "no_intent" }], noticeDue: false });
  });
});

describe("applyChatMessage: messages and texts", () => {
  test("skips outgoing messages and texts without letters or digits without reading them", async () => {
    const outgoing = harness({ message: photoMessage({ direction: "outgoing" }) });
    expect(await succeeded(outgoing.run())).toEqual({ kind: "skipped", reason: "outgoing_message" });
    const empty = harness({ message: textMessage("👍🙏") });
    expect(await succeeded(empty.run())).toEqual({ kind: "skipped", reason: "empty_text" });
    for (const h of [outgoing, empty]) {
      expect(h.calls).not.toContain("findChatOrderContext");
      expect(h.calls).not.toContain("readImage");
      expect(h.calls).not.toContain("recordOutcome");
    }
  });

  test("skips texts when interpretation is disabled", async () => {
    const h = harness({ message: textMessage("hola"), interpretationEnabled: false });
    expect(await succeeded(h.run())).toEqual({ kind: "skipped", reason: "interpretation_disabled" });
    expect(h.store.outcomes.size).toBe(0);
  });

  test("fails with message not found for a message of another company or one that does not exist", async () => {
    expect(await harness({ message: null }).run()).toMatchObject({ success: false, error: { code: "MESSAGE_NOT_FOUND" } });
    expect(await harness({ message: photoMessage({ companyId: id(99) as CompanyId }) }).run()).toMatchObject({ success: false, error: { code: "MESSAGE_NOT_FOUND" } });
  });

  test("records no intent for a greeting without creating a customer, an order or a notice", async () => {
    const h = harness({ message: textMessage("hola"), decision: () => answer("no_intent") });
    expect(await succeeded(h.run())).toMatchObject({ kind: "applied", orderId: null, createdOrder: false, outcomes: [{ kind: "no_intent" }], noticeDue: false });
    expect(h.store.customers.size).toBe(0);
    expect(h.calls).not.toContain("ensureCustomerForContact");
    expect(h.calls).not.toContain("allocateNumber");
    expect(h.calls).not.toContain("recordOrderMessage");
    expect(h.decisions[0]!.messageParts).toEqual([{ kind: "text", text: "hola" }]);
  });

  test("records ambiguous intent without notice or extraction when the action confidence is below the minimum", async () => {
    const h = harness({ message: textMessage("mmm eso"), decision: () => answer("no_intent", 0.2) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "ambiguous_intent" }], noticeDue: false });
    expect(h.extractions).toHaveLength(0);
  });

  test("returns already processed and changes nothing for a repeated message", async () => {
    const h = harness({ stored: { outcomes: [{ kind: "no_intent" }], noticeSentAt: null } });
    expect(await succeeded(h.run())).toEqual({ kind: "already_processed", noticeDue: false });
    expect(h.calls).toEqual(["findOutcome"]);
  });

  test("returns already processed with a notice due when the stored outcomes were never notified", async () => {
    const stored = { outcomes: [{ kind: "failed", errorCode: "RETRIES_EXHAUSTED" }] as ChatMessageOutcomes, noticeSentAt: null };
    expect(await succeeded(harness({ stored }).run())).toEqual({ kind: "already_processed", noticeDue: true });
    expect(await succeeded(harness({ stored: { ...stored, noticeSentAt: at } }).run())).toEqual({ kind: "already_processed", noticeDue: false });
  });

  test("re-reads the winner when another run recorded the message first and rolls back its own writes", async () => {
    // The winner commits outside this run's transaction, so its row survives the rollback.
    let winner: StoredChatMessageOutcome | null = null;
    const h = harness({ identification: visual(productCap) });
    const deps: ApplyChatMessageDependencies = { ...h.deps,
      findOutcome: async () => ok(winner),
      recordOutcome: async () => { winner = { outcomes: [{ kind: "no_intent" }], noticeSentAt: null }; return err({ code: "MESSAGE_ALREADY_PROCESSED", message: "dup" }); } };
    expect(await succeeded(applyChatMessage({ companyId, messageId }, deps, h.controller.signal))).toEqual({ kind: "already_processed", noticeDue: false });
    expect(h.store.orders.size).toBe(0);
    expect(h.store.customers.size).toBe(0);
  });

  test("rolls back the order, the customer and the message when the outcome cannot be recorded", async () => {
    const h = harness({ identification: visual(productCap), overrides: { recordOutcome: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }) } });
    expect(await h.run()).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    expect(h.store.orders.size).toBe(0);
    expect(h.store.customers.size).toBe(0);
    expect(h.store.messages.size).toBe(0);
  });
});

describe("applyChatMessage: text tools", () => {
  const line = (n: number, v: CatalogItem, quantity = 1): OrderAggregate["items"][number] => ({ id: id(60 + n) as OrderItemId, variantId: v.variantId, productName: v.productName,
    variantAttributes: v.variantAttributes, sku: null, quantity: quantity as PositiveInteger, unitPrice: v.unitPrice, subtotal: money(v.unitPrice.amount * quantity), mentionedPrice: null });
  const openWith = (...items: OrderAggregate["items"]): ChatOrderTarget => ({ kind: "open", order: existingOrder(items),
    productIds: new Map(items.map((item) => [item.variantId, item.productName === "Gorra" ? productCap : productPolo])) });
  const twoPolos = (): ChatOrderTarget => openWith(line(1, poloM), line(2, poloL));
  const capAndPolo = (): ChatOrderTarget => openWith(line(1, cap), line(2, poloM));
  const found = (productId: ProductId, confidence = 0.9): TextIdentification => ({ kind: "found", productId, confidence });
  const decided = (choice: string, choices: DecisionAnswers["choices"] = {}, predicates: Record<string, number> = {}, confidence = 0.95): DecisionAnswers =>
    ({ action: { choice, confidence }, predicates, choices });
  // The reference answer is only read when the order has a single item.
  const itemChoice = (tool: string, value: string, confidence = 0.95, reference: "named" | "unnamed" = "named"): DecisionAnswers["choices"] =>
    ({ [`${tool}:item`]: { value, confidence }, [`${tool}:reference`]: { value: reference, confidence: 0.9 } });
  const removal = (value: string, confidence = 0.95, amount: "all" | "one" = "all"): DecisionAnswers["choices"] =>
    ({ ...itemChoice("remove_item", value, confidence), "remove_item:amount": { value: amount, confidence: 0.95 } });
  const add = (productMention: string, variantWords: string[] = [], quantity: number | null = null) => ({ productMention, variantWords, quantity, mentionedPrice: null });
  const addCall = (...lines: ReturnType<typeof add>[]): ToolCall => ({ tool: "add_products", args: { lines } });
  const quantities = (store: Store) => Object.fromEntries([...store.orders.values()].flatMap((order) => order.items).map((item) => [item.variantId, item.quantity]));

  test("adds the product a text names with the variant and quantity it states", async () => {
    const h = harness({ message: textMessage("quiero 2 polos M"), identify: { polo: found(productPolo) },
      decision: () => decided("add_products"), extraction: () => [addCall(add("polo", ["M"], 2))] });
    expect(await succeeded(h.run())).toMatchObject({ kind: "applied", createdOrder: true, noticeDue: false,
      outcomes: [{ kind: "added", variantId: poloM.variantId, quantity: 2, identification: { method: "text", productId: productPolo, confidence: 0.9 } }] });
    expect(h.extractions[0]!.tools.map(({ name }) => name)).toEqual(["add_products"]);
  });

  test("tells «Polo básico» from «Polo premium» by the price in the text, with and without an open order", async () => {
    const candidate = (productId: ProductId, name: string, amount: number): TextCandidate => ({ productId, name, minPrice: money(amount), maxPrice: money(amount), similarity: 0.9 });
    const textLookup = (hints: Array<number | null>): IdentifyProductInTextDependencies => ({
      findTextCandidates: async (queries) => ok(queries.map(() => [candidate(id(20) as ProductId, "Polo premium", 55), candidate(productPolo, "Polo básico", 35)])),
      chooseTextProduct: async ({ priceHint, candidates }) => {
        hints.push(priceHint);
        const fits = candidates.find(({ minPrice }) => priceHint !== null && minPrice.amount === priceHint);
        return ok({ productId: fits?.productId ?? null, confidence: 0.95, probabilities: [] });
      },
      minConfidence: 0.8, unclearMinProbability: 0.25,
    });
    for (const target of [undefined, capAndPolo()]) {
      const hints: Array<number | null> = [];
      const h = harness({ message: textMessage("el polo de 35"), target, textLookup: textLookup(hints), decision: () => decided("add_products"),
        extraction: () => [{ tool: "add_products", args: { lines: [{ productMention: "polo", variantWords: ["M"], quantity: null, mentionedPrice: { amount: "35", units: 1, currency: "not_named" } }] } }] });
      expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "added", variantId: poloM.variantId, identification: { productId: productPolo } }] });
      expect(hints).toEqual([35]);
    }
  });

  test("gives no price hint for a price in another currency, the unit amount for several units, and the named currency without an order", async () => {
    const hints: Array<[number | null, string | null]> = [];
    const only = (productId: ProductId, name: string): TextCandidate => ({ productId, name, minPrice: money(35), maxPrice: money(35), similarity: 0.9 });
    const textLookup: IdentifyProductInTextDependencies = {
      findTextCandidates: async (queries) => ok(queries.map(() => [only(productPolo, "Polo básico")])),
      chooseTextProduct: async ({ priceHint, priceHintCurrency }) => { hints.push([priceHint, priceHintCurrency ?? null]); return ok({ productId: null, confidence: 0, probabilities: [] }); },
      minConfidence: 0.8, unclearMinProbability: 0.25,
    };
    const h = harness({ message: textMessage("polo a 5 dólares y gorra 50 por 2"), textLookup, decision: () => decided("add_products"),
      extraction: () => [{ tool: "add_products", args: { lines: [
        { productMention: "polo", variantWords: [], quantity: null, mentionedPrice: { amount: "5", units: 1, currency: "other" } },
        { productMention: "gorra", variantWords: [], quantity: null, mentionedPrice: { amount: "50", units: 2, currency: "not_named" } },
        { productMention: "polo", variantWords: [], quantity: null, mentionedPrice: { amount: "35", units: 1, currency: "PEN" } }] } }] });
    await h.run();
    // Without an open order «35 soles» keeps its currency, so products compares it only with prices in soles.
    expect(hints).toEqual([[null, null], [25, null], [35, "PEN"]]);
  });

  test("resolves ten add lines with one candidates query and at most four sequential model calls", async () => {
    const mentions = Array.from({ length: 10 }, (_, index) => (index % 2 === 0 ? `polo ${index}` : `gorra ${index}`));
    const identify = Object.fromEntries(mentions.map((mention, index) => [mention, found(index % 2 === 0 ? productPolo : productCap)]));
    const h = harness({ message: textMessage("diez cosas"), identify, decision: () => decided("add_products"),
      extraction: () => [addCall(...mentions.map((mention, index) => add(mention, index % 2 === 0 ? ["M"] : [])))] });
    const done = await succeeded(h.run());
    expect(done).toMatchObject({ kind: "applied", outcomes: expect.arrayContaining([{ kind: "added", variantId: cap.variantId, quantity: 1, identification: expect.anything() }]) });
    expect(h.identifyBatches).toEqual([mentions]);
    expect(h.loadedVariants).toHaveLength(1);
    expect(h.loadedVariants[0]!.sort()).toEqual([productPolo, productCap].sort());
    expect([h.decisions.length, h.extractions.length]).toEqual([1, 1]);
    expect(quantities(h.store)).toEqual({ [poloM.variantId]: 5, [cap.variantId]: 5 });
  });

  test("records not identified for a product the catalog does not know and notifies", async () => {
    const h = harness({ message: textMessage("quiero un sombrero"), decision: () => decided("add_products"), extraction: () => [addCall(add("sombrero"))] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "not_identified", source: "text", identification: null, silent: false }], noticeDue: true, createdOrder: false });
    expect(h.calls).toContain("catalogSearchReadiness");
  });

  test("records a silent miss when the company has no active products", async () => {
    const h = harness({ message: textMessage("quiero un sombrero"), readiness: "no_active_products", decision: () => decided("add_products"), extraction: () => [addCall(add("sombrero"))] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "not_identified", source: "text", silent: true }], noticeDue: false });
  });

  test("keeps a text miss audible when only the photos cannot be searched", async () => {
    const h = harness({ message: textMessage("quiero un sombrero"), readiness: "no_searchable_photos", decision: () => decided("add_products"), extraction: () => [addCall(add("sombrero"))] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "not_identified", silent: false }], noticeDue: true });
  });

  test("does not read the catalog readiness when every product was found", async () => {
    const h = harness({ message: textMessage("una gorra"), identify: { gorra: found(productCap) }, decision: () => decided("add_products"), extraction: () => [addCall(add("gorra"))] });
    await h.run();
    expect(h.calls).not.toContain("catalogSearchReadiness");
  });

  test("reports the likely products when the text names a product that two candidates fit", async () => {
    const refs: [ProductRef, ProductRef] = [{ productId: productPolo, name: "Polo básico" }, { productId: productCap, name: "Gorra" }];
    const h = harness({ message: textMessage("quiero el negro"), identify: { negro: { kind: "not_clear", candidates: refs } }, decision: () => decided("add_products"), extraction: () => [addCall(add("negro"))] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "not_clear", productIds: [productPolo, productCap], silent: false }], noticeDue: true });
  });

  test("reports a missing variant when the text names a product with several variants and no variant", async () => {
    const h = harness({ message: textMessage("un polo"), identify: { polo: found(productPolo) }, decision: () => decided("add_products"), extraction: () => [addCall(add("polo"))] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "variant_missing", productId: productPolo, identification: { method: "text" } }], noticeDue: true });
  });

  test("ends with variant not available and ready when the text names a size the product lacks", async () => {
    const withoutM: readonly ProductWithSellableVariants[] = [{ productId: productPolo, name: "Polo básico", variants: [poloL] }, catalog[1]!];
    const h = harness({ message: textMessage("2 polos M y listo"), catalog: withoutM, target: openWith(line(1, cap)), identify: { polos: found(productPolo) },
      decision: () => decided("several", {}, { add_products: 0.9, mark_order_ready: 0.9 }), extraction: () => [addCall(add("polos", ["M"], 2))] });
    const done = await succeeded(h.run());
    expect(done).toMatchObject({ outcomes: [{ kind: "variant_not_available", productId: productPolo }, { kind: "ready" }], noticeDue: true });
    if (done.kind !== "applied") throw new Error("not applied");
    expect(chooseSellerNotice(done.outcomes)).toMatchObject({ kind: "variant_not_available", productId: productPolo });
    expect(quantities(h.store)).toEqual({ [cap.variantId]: 1 });
  });

  test("reports quantity above limit for a text of 1000 units", async () => {
    const h = harness({ message: textMessage("quiero 1000 polos M"), identify: { polos: found(productPolo) }, decision: () => decided("add_products"),
      extraction: () => [addCall(add("polos", ["M"], 1000))] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "quantity_above_limit", productId: productPolo }], noticeDue: true, createdOrder: false });
  });

  test("keeps the mentioned price of a text line as a note and drops one in another currency", async () => {
    const priced = (currency: string) => harness({ message: textMessage("una gorra a 20"), identify: { gorra: found(productCap) }, decision: () => decided("add_products"),
      extraction: () => [{ tool: "add_products", args: { lines: [{ productMention: "gorra", variantWords: [], quantity: null, mentionedPrice: { amount: "20", units: 1, currency } }] } }] });
    for (const currency of ["not_named", "PEN"]) {
      const kept = priced(currency);
      await kept.run();
      expect([...kept.store.orders.values()][0]!.items[0]).toMatchObject({ mentionedPrice: { amount: money(20), units: 1 } });
    }
    for (const currency of ["USD", "other"]) {
      const dropped = priced(currency);
      await dropped.run();
      expect([...dropped.store.orders.values()][0]!.items[0]!.mentionedPrice).toBeNull();
    }
  });

  test("adds to the open order and creates neither a customer nor a number", async () => {
    const h = harness({ message: textMessage("otra gorra"), target: openWith(line(1, cap)), identify: { gorra: found(productCap) }, decision: () => decided("add_products"), extraction: () => [addCall(add("gorra"))] });
    expect(await succeeded(h.run())).toMatchObject({ createdOrder: false, outcomes: [{ kind: "added", quantity: 1 }] });
    expect(quantities(h.store)).toEqual({ [cap.variantId]: 2 });
    expect(h.calls).not.toContain("allocateNumber");
  });

  test("removes an item chosen by the decision step without calling the extraction model", async () => {
    const h = harness({ message: textMessage("quita la gorra"), target: capAndPolo(), decision: () => decided("remove_item", removal("I1")) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "removed", variantId: cap.variantId, namedItem: true }], noticeDue: false, trace: { extraction: false, decisionCalls: 1 } });
    expect(h.extractions).toHaveLength(0);
    expect(quantities(h.store)).toEqual({ [poloM.variantId]: 1 });
  });

  test("lowers the quantity by one when the decision step chooses one unit", async () => {
    const h = harness({ message: textMessage("quita una gorra"), target: openWith(line(1, cap, 3), line(2, poloM)), decision: () => decided("remove_item", removal("I1", 0.95, "one")) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "quantity_lowered", variantId: cap.variantId }] });
    expect(quantities(h.store)[cap.variantId]).toBe(2);
  });

  test("reports an unclear item and removes nothing when the decision item choice is below the minimum", async () => {
    const h = harness({ message: textMessage("quita el polo"), target: twoPolos(), decision: () => decided("remove_item", removal("I1", 0.5)) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "unclear_item", orderId: id(9), namedItem: true, namedProductId: null }], noticeDue: true });
    expect(h.extractions).toHaveLength(0);
    expect(quantities(h.store)).toEqual({ [poloM.variantId]: 1, [poloL.variantId]: 1 });
  });

  test("reports an unclear item when the decision step cannot tell which item or how many", async () => {
    const ambiguous = harness({ message: textMessage("quita el polo"), target: twoPolos(), decision: () => decided("remove_item", removal("ambiguous")) });
    expect(await succeeded(ambiguous.run())).toMatchObject({ outcomes: [{ kind: "unclear_item", namedItem: true }] });
    const unsureAmount = harness({ message: textMessage("quita un polo"), target: openWith(line(1, poloM, 3), line(2, poloL)),
      decision: () => decided("remove_item", { ...itemChoice("remove_item", "I1"), "remove_item:amount": { value: "one", confidence: 0.4 } }) });
    expect(await succeeded(unsureAmount.run())).toMatchObject({ outcomes: [{ kind: "unclear_item" }] });
    expect(quantities(unsureAmount.store)).toEqual({ [poloM.variantId]: 3, [poloL.variantId]: 1 });
  });

  test("removes an item of one unit however unsure the amount choice is, since the whole item and one unit are the same", async () => {
    const h = harness({ message: textMessage("saca la gorrita"), target: capAndPolo(),
      decision: () => decided("remove_item", { ...itemChoice("remove_item", "I1"), "remove_item:amount": { value: "all", confidence: 0.58 } }) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "removed", variantId: cap.variantId, namedItem: true }] });
    expect(quantities(h.store)).toEqual({ [poloM.variantId]: 1 });
  });

  test("does not call an unnamed reference a named item when the choice is below the minimum", async () => {
    const h = harness({ message: textMessage("quítalo"), target: twoPolos(), decision: () => decided("remove_item", removal("unnamed", 0.5)) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "unclear_item", namedItem: false }] });
  });

  test("names the likeliest product of the catalog when the text names something not in the order", async () => {
    const h = harness({ message: textMessage("quita el sombrero"), target: capAndPolo(), topCandidate: { productId: productCap, name: "Gorra" },
      decision: () => decided("remove_item", removal("not_in_order")) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "unclear_item", namedItem: true, namedProductId: productCap }] });
    expect(h.topCandidateQueries).toEqual(["quita el sombrero"]);
    const none = harness({ message: textMessage("quita el sombrero"), target: capAndPolo(), decision: () => decided("remove_item", removal("not_in_order")) });
    expect(await succeeded(none.run())).toMatchObject({ outcomes: [{ kind: "unclear_item", namedProductId: null }] });
  });

  test("reports an unclear item for an unnamed reference when the order has two items", async () => {
    const h = harness({ message: textMessage("quítalo"), target: openWith(line(1, cap), line(2, poloM)), decision: () => decided("remove_item", removal("unnamed")) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "unclear_item", namedItem: false }] });
  });

  test("records whether the message named the only item, while changing that item either way", async () => {
    for (const [reference, namedItem] of [["unnamed", false], ["named", true]] as const) {
      const h = harness({ message: textMessage("que sean cuatro"), target: openWith(line(1, cap)),
        decision: () => decided("change_item_quantity", itemChoice("change_item_quantity", "I1", 0.95, reference)),
        extraction: () => [{ tool: "change_item_quantity", args: { quantity: 4 } }] });
      expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "quantity_changed", variantId: cap.variantId, quantity: 4, namedItem }] });
      expect(h.decisions[0]!.choices.find(({ id }) => id === "change_item_quantity:reference")?.choices.map(({ value }) => value)).toEqual(["named", "unnamed"]);
    }
  });

  test("reports no open order for a removal when the chat has none, offering no item tool", async () => {
    const h = harness({ message: textMessage("quita la gorra"), decision: () => decided("report_item_change_without_order") });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "no_open_order" }], noticeDue: true });
    expect(h.decisions[0]!.action.choices.map(({ value }) => value)).not.toContain("remove_item");
    expect(h.decisions[0]!.choices).toEqual([]);
  });

  test("runs two tools without extracted arguments without calling the extraction model", async () => {
    const h = harness({ message: textMessage("quita la gorra y listo"), target: capAndPolo(),
      decision: () => decided("several", removal("I1"), { remove_item: 0.9, mark_order_ready: 0.9, no_intent: 0.1 }) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "removed", variantId: cap.variantId }, { kind: "ready" }], trace: { tools: ["remove_item", "mark_order_ready"], extraction: false } });
    expect(h.extractions).toHaveLength(0);
  });

  test("marks the order ready without any extraction", async () => {
    const h = harness({ message: textMessage("listo, eso es todo"), target: capAndPolo(), decision: () => decided("mark_order_ready") });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "ready", orderId: id(9) }], noticeDue: true });
    expect(h.extractions).toHaveLength(0);
  });

  test("calls the extraction model with only the selected tools that need extracted arguments", async () => {
    const h = harness({ message: textMessage("agrega una gorra y listo"), identify: { gorra: found(productCap) },
      decision: () => decided("several", {}, { add_products: 0.9, mark_order_ready: 0.9, remove_item: 0.1, change_item_quantity: 0.2 }),
      extraction: () => [addCall(add("gorra"))] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "added", variantId: cap.variantId }, { kind: "ready" }], trace: { tools: ["add_products", "mark_order_ready"], extraction: true } });
    expect(h.extractions).toHaveLength(1);
    expect(h.extractions[0]!.tools.map(({ name }) => name)).toEqual(["add_products"]);
  });

  test("offers the order's item labels to the decision step and never to the extraction model", async () => {
    const h = harness({ message: textMessage("mejor 3 gorras"), target: capAndPolo(), decision: () => decided("change_item_quantity", itemChoice("change_item_quantity", "I1")),
      extraction: () => [{ tool: "change_item_quantity", args: { quantity: 3 } }] });
    await h.run();
    const question = h.decisions[0]!.choices.find(({ id: choiceId }) => choiceId === "change_item_quantity:item");
    expect(question!.choices.map(({ value }) => value)).toEqual(["I1", "I2", "unnamed", "not_in_order", "ambiguous"]);
    expect(Object.keys((h.extractions[0]!.tools[0]!.jsonSchema as { properties: object }).properties)).toEqual(["quantity"]);
  });

  test("changes the quantity of the item the decision step chose", async () => {
    const h = harness({ message: textMessage("mejor 3 gorras"), target: capAndPolo(), decision: () => decided("change_item_quantity", itemChoice("change_item_quantity", "I1")),
      extraction: () => [{ tool: "change_item_quantity", args: { quantity: 3 } }] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "quantity_changed", variantId: cap.variantId, quantity: 3, namedItem: true }] });
    expect(quantities(h.store)).toEqual({ [cap.variantId]: 3, [poloM.variantId]: 1 });
  });

  test("takes the item of a change tool from the decision answer even when the extraction model returns another label", async () => {
    const h = harness({ message: textMessage("mejor 3 gorras"), target: capAndPolo(), decision: () => decided("change_item_quantity", itemChoice("change_item_quantity", "I1")),
      extraction: () => [{ tool: "change_item_quantity", args: { item: { value: "I2", confidence: 1 }, quantity: 3 } }] });
    await h.run();
    expect(quantities(h.store)).toEqual({ [cap.variantId]: 3, [poloM.variantId]: 1 });
  });

  test("changes nothing and reports an unclear item when a quantity change names one of two items of the same product below the item confidence", async () => {
    const h = harness({ message: textMessage("mejor 3 del polo"), target: twoPolos(), decision: () => decided("change_item_quantity", itemChoice("change_item_quantity", "I1", 0.6)),
      extraction: () => [{ tool: "change_item_quantity", args: { quantity: 3 } }] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "unclear_item", namedItem: true }], noticeDue: true });
    expect(quantities(h.store)).toEqual({ [poloM.variantId]: 1, [poloL.variantId]: 1 });
  });

  test("treats a quantity change to zero as a removal and reports quantity above limit for 1000", async () => {
    const zero = harness({ message: textMessage("sin gorras"), target: capAndPolo(), decision: () => decided("change_item_quantity", itemChoice("change_item_quantity", "I1")),
      extraction: () => [{ tool: "change_item_quantity", args: { quantity: 0 } }] });
    expect(await succeeded(zero.run())).toMatchObject({ outcomes: [{ kind: "removed", variantId: cap.variantId }] });
    const many = harness({ message: textMessage("mil gorras"), target: capAndPolo(), decision: () => decided("change_item_quantity", itemChoice("change_item_quantity", "I1")),
      extraction: () => [{ tool: "change_item_quantity", args: { quantity: 1000 } }] });
    expect(await succeeded(many.run())).toMatchObject({ outcomes: [{ kind: "quantity_above_limit", productId: productCap }] });
  });

  test("changes the variant of the chosen item through the same variant resolution as adds", async () => {
    const h = harness({ message: textMessage("mejor en talla L"), target: openWith(line(1, poloM, 2)), decision: () => decided("change_item_variant", itemChoice("change_item_variant", "I1")),
      extraction: () => [{ tool: "change_item_variant", args: { variantWords: ["L"], mentionedPrice: null } }] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "variant_changed", fromVariantId: poloM.variantId, toVariantId: poloL.variantId, namedItem: true }] });
    expect(h.loadedVariants).toEqual([[productPolo]]);
    expect(quantities(h.store)).toEqual({ [poloL.variantId]: 2 });
  });

  test("int-change-variant: changes only the named attribute and keeps the color of the item", async () => {
    const negroM = variant(5, "Polo básico", { Talla: "M", Color: "Negro" });
    const negroL = variant(6, "Polo básico", { Talla: "L", Color: "Negro" });
    const blancoL = variant(7, "Polo básico", { Talla: "L", Color: "Blanco" });
    const h = harness({ message: textMessage("cámbialo a talla L"), target: openWith(line(1, negroM, 2)), catalog: [{ productId: productPolo, name: "Polo básico", variants: [negroM, negroL, blancoL] }],
      decision: () => decided("change_item_variant", itemChoice("change_item_variant", "I1")),
      extraction: () => [{ tool: "change_item_variant", args: { variantWords: ["talla", "L"], mentionedPrice: null } }] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "variant_changed", fromVariantId: negroM.variantId, toVariantId: negroL.variantId }] });
    expect(h.variantChoices).toEqual([["talla", "L"]]);
  });

  test("reports a variant that is not available and keeps the item when the new variant does not exist", async () => {
    const h = harness({ message: textMessage("mejor en XL"), target: openWith(line(1, poloM)), decision: () => decided("change_item_variant", itemChoice("change_item_variant", "I1")),
      extraction: () => [{ tool: "change_item_variant", args: { variantWords: ["XL"], mentionedPrice: null } }] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "variant_not_available", productId: productPolo }], noticeDue: true });
    expect(quantities(h.store)).toEqual({ [poloM.variantId]: 1 });
  });

  test("reports an unclear item for a variant change when the order's item has no known product", async () => {
    const target = openWith(line(1, poloM));
    const h = harness({ message: textMessage("mejor en talla L"), target: target.kind === "open" ? { ...target, productIds: new Map() } : target,
      decision: () => decided("change_item_variant", itemChoice("change_item_variant", "I1")), extraction: () => [{ tool: "change_item_variant", args: { variantWords: ["L"], mentionedPrice: null } }] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "unclear_item", namedProductId: null }] });
    expect(quantities(h.store)).toEqual({ [poloM.variantId]: 1 });
  });

  test("reports the closed order for a change once the chat's order closed", async () => {
    const h = harness({ message: textMessage("quita la gorra"), target: { kind: "closed", orderId: id(9) as OrderId, number: 1023 as OrderNumber },
      decision: () => decided("report_item_change_without_order") });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "order_closed", orderId: id(9) }], noticeDue: true });
  });

  test("reports no open order for a variant change when the chat has no order, without an extraction call", async () => {
    const h = harness({ message: textMessage("cámbialo a talla L"), decision: () => decided("report_item_change_without_order") });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "no_open_order" }] });
    expect(h.extractions).toHaveLength(0);
  });

  test("sets the mentioned price of the chosen item as a note", async () => {
    const h = harness({ message: textMessage("la gorra a 20"), target: capAndPolo(), decision: () => decided("set_item_mentioned_price", itemChoice("set_item_mentioned_price", "I1")),
      extraction: () => [{ tool: "set_item_mentioned_price", args: { mentionedPrice: { amount: "50", units: 3, currency: "not_named" } } }] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "mentioned_price_set", variantId: cap.variantId }] });
    expect([...h.store.orders.values()][0]!.items[0]).toMatchObject({ mentionedPrice: { amount: money(50), units: 3 } });
  });

  /** Applies one text per message id to the same harness, in order, answering each with the decision and extraction given for its text. */
  async function conversation(h: ReturnType<typeof harness>, texts: Record<string, { decision: DecisionAnswers; extraction?: readonly ToolCall[] }>) {
    const results = [];
    for (const text of Object.keys(texts)) {
      const key = id(next++) as ChatMessageId;
      current = text;
      results.push(await succeeded(applyChatMessage({ companyId, messageId: key }, h.deps, h.controller.signal)));
    }
    return results;
  }
  let current = "";
  let next = 700;

  test("runs the photo with «a 20 soles», «la gorra en 25 está bien» and «quita la gorra» in sequence: the note appears, disappears and goes with the item", async () => {
    const texts: Record<string, { decision: DecisionAnswers; extraction?: readonly ToolCall[] }> = {
      "a 20 soles": { decision: answer("add_shown_product_with_details"),
        extraction: [{ tool: "add_shown_product_with_details", args: { variantWords: [], quantity: null, perEach: false, mentionedPrice: { amount: "20", units: 1, currency: "not_named" } } }] },
      "la gorra en 25 está bien": { decision: decided("set_item_mentioned_price", itemChoice("set_item_mentioned_price", "I2")),
        extraction: [{ tool: "set_item_mentioned_price", args: { mentionedPrice: { amount: "25", units: 1, currency: "not_named" } } }] },
      "quita la gorra": { decision: decided("remove_item", removal("I2")) },
    };
    const target = openWith(line(1, poloM));
    if (target.kind === "open") (target.productIds as Map<VariantId, ProductId>).set(cap.variantId, productCap);
    const h = harness({ target, identification: visual(productCap), decision: () => texts[current]!.decision, extraction: () => texts[current]!.extraction ?? [],
      overrides: {
        findSourceMessage: async (key) => ok(current === "a 20 soles" ? photoMessage({ id: key, caption: current }) : textMessage(current, { id: key })),
        // The order changes between messages, so the interpreter is shown its current items.
        findChatOrderContext: async () => ok({ items: items().map((item, index) => ({ label: `I${index + 1}`, variantId: item.variantId, productId: target.kind === "open" ? target.productIds.get(item.variantId) ?? null : null,
          productName: item.productName, variantAttributes: item.variantAttributes, quantity: item.quantity, unitPrice: item.unitPrice })) }),
      } });
    function items() { return [...h.store.orders.values()][0]?.items ?? []; }
    const noteOf = (variantId: VariantId) => { const item = items().find((candidate) => candidate.variantId === variantId); return item && mentionedPriceNote({ unitPrice: item.unitPrice, mentionedPrice: item.mentionedPrice ?? null }); };
    await conversation(h, { "a 20 soles": texts["a 20 soles"]! });
    expect(noteOf(cap.variantId)).toEqual({ amount: money(20).amount, units: 1 });
    expect([...h.store.orders.values()][0]!.total).toEqual(money(60));
    await conversation(h, { "la gorra en 25 está bien": texts["la gorra en 25 está bien"]! });
    expect(noteOf(cap.variantId)).toBeNull();
    expect(quantityOf(h.store, cap.variantId)).toBe(1);
    await conversation(h, { "quita la gorra": texts["quita la gorra"]! });
    expect(items().map(({ variantId }) => variantId)).toEqual([poloM.variantId]);
    expect(noteOf(cap.variantId)).toBeUndefined();
    expect([...h.store.orders.values()][0]!.total).toEqual(money(35));
  });

  test("keeps the order active, unpaid and without checkout after adding, marking ready and removing its last item", async () => {
    const texts: Record<string, { decision: DecisionAnswers; extraction?: readonly ToolCall[] }> = {
      "agrégame un polo M": { decision: decided("add_products"), extraction: [addCall(add("polo", ["M"]))] },
      "listo, eso es todo": { decision: decided("mark_order_ready") },
      "quita todo": { decision: decided("remove_item", removal("I1")) },
    };
    const h = harness({ message: textMessage("x"), target: openWith(line(1, cap)), identify: { polo: found(productPolo) }, decision: () => texts[current]!.decision,
      extraction: () => texts[current]!.extraction ?? [], overrides: { findSourceMessage: async (key) => ok(textMessage(current, { id: key })) } });
    const activeOrder = () => {
      const [order] = [...h.store.orders.values()];
      return { cancelled: order!.cancelled, payments: order!.payments, checkoutEnabledAt: order!.checkoutEnabledAt, checkoutConfirmedAt: order!.checkoutConfirmedAt,
        completedAt: order!.completedAt, delivery: order!.delivery, stockDeducted: order!.stockDeducted };
    };
    const untouched = { cancelled: false, payments: [], checkoutEnabledAt: null, checkoutConfirmedAt: null, completedAt: null, delivery: null, stockDeducted: false };
    for (const text of Object.keys(texts)) {
      await conversation(h, { [text]: texts[text]! });
      expect(activeOrder()).toEqual(untouched);
    }
    expect(h.store.orders.size).toBe(1);
    // The use case is given no way to take a payment, open checkout, cancel the order or create a payment link.
    expect(Object.keys(h.deps).filter((name) => /payment|checkout|cancel|link|complete|fulfil/i.test(name))).toEqual([]);
  });

  test("records no intent for a mentioned price in another currency", async () => {
    const h = harness({ message: textMessage("la gorra a 5 dólares"), target: capAndPolo(), decision: () => decided("set_item_mentioned_price", itemChoice("set_item_mentioned_price", "I1")),
      extraction: () => [{ tool: "set_item_mentioned_price", args: { mentionedPrice: { amount: "5", units: 1, currency: "other" } } }] });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "no_intent" }], noticeDue: false });
  });

  test("reports an add without a name whose own predicate is clear although the action is unsure, and never a change", async () => {
    const h = harness({ message: textMessage("mándame otros tres así"), target: openWith(line(1, poloM)),
      decision: () => decided("add_products", {}, { report_unnamed_add: 0.97, add_products: 0.3 }, 0.45) });
    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "unnamed_add" }], noticeDue: true });
    expect(h.extractions).toHaveLength(0);
  });

  test("reports a variant without a product and an add without a name as problems for the seller", async () => {
    const variantOnly = harness({ message: textMessage("en talla L"), decision: () => decided("report_variant_without_product") });
    expect(await succeeded(variantOnly.run())).toMatchObject({ outcomes: [{ kind: "variant_only" }], noticeDue: true });
    const unnamed = harness({ message: textMessage("quiero más"), decision: () => decided("report_unnamed_add") });
    expect(await succeeded(unnamed.run())).toMatchObject({ outcomes: [{ kind: "unnamed_add" }], noticeDue: true });
    expect(variantOnly.extractions).toHaveLength(0);
  });

  test("makes no extraction request for «mejor quita la gorra», «listo, eso es todo», «hola» and «quita la gorra y listo»", async () => {
    const cases: readonly [string, DecisionAnswers][] = [
      ["mejor quita la gorra", decided("remove_item", removal("I1"))],
      ["listo, eso es todo", decided("mark_order_ready")],
      ["hola", decided("no_intent")],
      ["quita la gorra y listo", decided("several", removal("I1"), { remove_item: 0.9, mark_order_ready: 0.9 })],
    ];
    for (const [text, answers] of cases) {
      const h = harness({ message: textMessage(text), target: capAndPolo(), decision: () => answers });
      await succeeded(h.run());
      expect(h.extractions).toHaveLength(0);
    }
  });
});

describe("applyChatMessage: failures", () => {
  test("fails with deadline exceeded when the attempt deadline passes during a model call", async () => {
    const h = harness({ message: textMessage("hola"), decision: () => ({ code: "DEADLINE_EXCEEDED", message: "deadline" }) });
    expect(await h.run()).toMatchObject({ success: false, error: { code: "DEADLINE_EXCEEDED" } });
    expect(h.store.outcomes.size).toBe(0);
  });

  test("fails with deadline exceeded when the deadline passed while the photo was identified", async () => {
    const h = harness();
    const deps: ApplyChatMessageDependencies = { ...h.deps, identifyProductsInImage: async () => { h.controller.abort(); return ok(visual(productCap)); } };
    expect(await applyChatMessage({ companyId, messageId }, deps, h.controller.signal)).toMatchObject({ success: false, error: { code: "DEADLINE_EXCEEDED" } });
    expect(h.calls).not.toContain("transaction");
  });

  test("maps a provider outage to a retryable code and an invalid model answer to a permanent one", async () => {
    const down = harness({ message: textMessage("hola"), decision: () => ({ code: "AI_PROVIDER_UNAVAILABLE", message: "down" }) });
    expect(await down.run()).toMatchObject({ success: false, error: { code: "AI_PROVIDER_UNAVAILABLE" } });
    const invalid = harness({ message: textMessage("hola"), decision: () => answer("not_a_tool") });
    expect(await invalid.run()).toMatchObject({ success: false, error: { code: "INVALID_AI_RESPONSE" } });
  });

  test("treats a lost image as a lost message and a storage outage as retryable", async () => {
    const lost = harness({ overrides: { readImage: async () => err({ code: "IMAGE_NOT_FOUND", message: "gone" }) } });
    expect(await lost.run()).toMatchObject({ success: false, error: { code: "MESSAGE_NOT_FOUND" } });
    const down = harness({ overrides: { readImage: async () => err({ code: "IMAGE_STORAGE_UNAVAILABLE", storageCode: "IMAGE_STORAGE_UNAVAILABLE", message: "down" }) } });
    expect(await down.run()).toMatchObject({ success: false, error: { code: "IMAGE_STORAGE_UNAVAILABLE" } });
  });

  test("passes the matcher's failures through unchanged", async () => {
    const h = harness({ overrides: { identifyProductsInImage: async () => err({ code: "PRODUCT_MATCHER_UNAVAILABLE", message: "down" }) } });
    expect(await h.run()).toMatchObject({ success: false, error: { code: "PRODUCT_MATCHER_UNAVAILABLE" } });
  });

  test("names the seller who left as SELLER_UNAVAILABLE and writes nothing", async () => {
    const h = harness({ identification: visual(productCap), overrides: { saveNewOrder: async () => err({ code: "SELLER_UNAVAILABLE", message: "gone" }) } });
    expect(await h.run()).toMatchObject({ success: false, error: { code: "SELLER_UNAVAILABLE" } });
    expect(h.store.outcomes.size).toBe(0);
    expect(h.store.customers.size).toBe(0);
  });

  test("reads only kinds of outcome the notice choice understands", async () => {
    const h = harness({ identification: visual(productCap) });
    await h.run();
    expect(outcomeKinds(h.store)).toEqual(["added"]);
  });
});
