import { describe, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { applyChatMessage, type ApplyChatMessageDependencies, type ChatSourceMessage } from "@core/src/features/orders/application/apply-chat-message";
import { createChatToolRegistry, type ChatContextItem } from "@core/src/features/orders/application/chat-message-tools";
import { createChatInterpreter } from "@core/src/features/orders/application/chat-message-interpreter";
import { resolveVariant } from "@core/src/features/products/application/resolve-variant";
import type { ImageIdentification } from "@core/src/features/products/application/identify-products-in-image";
import type { DecisionAnswers, DecisionRequest, ExtractionRequest, OrchestrateDependencies, ToolCall } from "@core/src/shared/ai-tools/application/orchestrate";
import type { AiError } from "@core/src/shared/ai-tools/application/ai-error";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order";
import type { ChatMessageOutcomes, StoredChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, ContactId, OrderId, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { CatalogItem, MatchConfidence } from "@core/src/features/products/domain/image-identification";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductWithSellableVariants, VariantChoice } from "@core/src/features/products/domain/text-identification";
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
  target?: ChatOrderTarget;
  stored?: StoredChatMessageOutcome;
  readiness?: "ready" | "no_searchable_photos" | "no_active_products";
  interpretationEnabled?: boolean;
  catalog?: readonly ProductWithSellableVariants[];
  overrides?: Partial<ApplyChatMessageDependencies>;
}>;

const answer = (choice: string, confidence = 0.95): DecisionAnswers => ({ action: { choice, confidence }, predicates: {}, choices: {} });
const emptyContext: readonly ChatContextItem[] = [];

type Store = { orders: Map<string, OrderAggregate>; customers: Set<string>; messages: Map<string, string>; outcomes: Map<string, ChatMessageOutcomes> };

/** In-memory ports; `transaction` restores the state when its work fails, like a rollback. */
function harness(options: Options = {}) {
  const calls: string[] = [];
  const decisions: DecisionRequest[] = [];
  const extractions: ExtractionRequest[] = [];
  const variantChoices: string[][] = [];
  const store: Store = { orders: new Map(), customers: new Set(), messages: new Map(), outcomes: new Map() };
  const called = <T>(name: string, value: T): T => { calls.push(name); return value; };
  const target: ChatOrderTarget = options.target ?? { kind: "none" };
  if (target.kind === "open") store.orders.set(target.order.id, target.order);
  const ai: OrchestrateDependencies = {
    minActionConfidence: 0.6, minToolPredicate: 0.5,
    decide: async (request) => {
      decisions.push(request);
      const decided = options.decision ? options.decision(request) : answer("no_intent");
      return "code" in decided ? err(decided) : ok(decided);
    },
    extract: async (request) => { extractions.push(request); return ok(options.extraction ? options.extraction(request) : []); },
  };
  const registry = createChatToolRegistry({
    loadSellableVariants: async () => ok([]),
    resolveVariant: (input, signal) => resolveVariant(input, { minConfidence: 0.8, chooseVariant: async (choice) => {
      variantChoices.push(choice.words.slice());
      return ok(options.variantChoice ?? { variantId: null, confidence: 0 });
    } }, signal),
    identifyProductsInText: async () => ok([]),
    findTopTextCandidate: async () => ok(null),
  });
  const items = (): ChatContextItem[] => target.kind === "open" ? target.order.items.map((item, index) => ({ label: `I${index + 1}`, variantId: item.variantId,
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
  return { calls, decisions, extractions, variantChoices, store, controller, deps, run: () => applyChatMessage({ companyId, messageId }, deps, controller.signal) };
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
      extraction: () => [{ tool: "add_shown_product_with_details", args: { variantWords: [], quantity: null, perEach: false, mentionedPrice: { amount: "20", units: 1, currency: "order_currency" } } }] });
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

  test("reports a missing variant for a photo of a product with several variants and no caption", async () => {
    const h = harness({ identification: visual(productPolo) });
    expect(await succeeded(h.run())).toMatchObject({ kind: "applied", orderId: null, noticeDue: true,
      outcomes: [{ kind: "variant_missing", productId: productPolo, identification: { method: "visual" } }] });
    expect(h.store.orders.size).toBe(0);
    expect(h.calls).not.toContain("ensureCustomerForContact");
    expect(h.calls).not.toContain("allocateNumber");
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
    const down = harness({ overrides: { readImage: async () => err({ code: "IMAGE_STORAGE_UNAVAILABLE", message: "down" }) } });
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
