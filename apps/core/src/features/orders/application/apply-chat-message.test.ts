import { describe, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ChatSourceMessage } from "@core/src/features/orders/application/chat-source-message";
import { applyChatMessage, type ApplyChatMessageDependencies, type ChatMemory } from "@core/src/features/orders/application/apply-chat-message";
import type { ReadingContextData } from "@core/src/features/orders/application/reader/load-reading-context";
import type { ReaderStages, StageCall } from "@core/src/features/orders/application/reader/stages";
import type { BuiltMessageTrace } from "@core/src/features/orders/application/reader/trace-ports";
import type { ImageIdentification } from "@core/src/features/products/application/identify-products-in-image";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order";
import type { ChatPending, ChatPendingId, ChatPendings } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatMessageOutcomes, StoredChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { MessageChanges, OrderItemChange, OrderItemChangeId } from "@core/src/features/orders/domain/message-changes";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { CompanyId, ContactId, OrderId, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { ContextMessageRef, ExtractedRequest, IntentReading, ItemRef, PendingRef, ProductResolution, ReaderStage, Reading, RequestIntent, RequestRef } from "@core/src/features/orders/domain/reader/readings";
import type { CatalogItem, MatchConfidence } from "@core/src/features/products/domain/image-identification";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";
import type { CatalogSearchReadiness } from "@core/src/features/products/domain/text-identification";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";
import { createReaderStages } from "@core/src/features/orders/infrastructure/reader/runtime/create-stage";
import { createFakeStructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/fake-structured-model";
import { promptRegistry } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";
import type { StructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/structured-model";
import { withAbort } from "@core/src/features/orders/infrastructure/reader/runtime/reading-deadline";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1) as CompanyId;
const messageId = id(2) as ChatMessageId;
const chatId = id(3) as ChatId;
const contactId = id(4) as ContactId;
const sellerId = "uploader" as UserId;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const at = new Date("2026-10-11T12:00:00Z");
const hourBefore = new Date(at.getTime() - 3_600_000);
const productPolo = id(10) as ProductId;
const productCap = id(11) as ProductId;
const variant = (n: number, name: string, attributes: Record<string, string>, amount = 35): CatalogItem =>
  ({ variantId: id(100 + n) as VariantId, productName: name, variantAttributes: attributes, sku: null, unitPrice: money(amount) });
const poloM = variant(1, "Polo básico", { Talla: "M" });
const poloL = variant(2, "Polo básico", { Talla: "L" });
const cap = variant(3, "Gorra", {}, 25);
const forReading = (productId: ProductId, name: string, variants: readonly CatalogItem[], sellable = true): ProductForReading => ({ productId, name, sellable,
  attributes: Object.entries(variants.reduce<Record<string, string[]>>((all, { variantAttributes }) => {
    for (const [attribute, value] of Object.entries(variantAttributes)) all[attribute] = [...new Set([...(all[attribute] ?? []), value])];
    return all;
  }, {})).map(([name, values]) => ({ name, values })), variants });
const polo = forReading(productPolo, "Polo básico", [poloM, poloL]);
const gorra = forReading(productCap, "Gorra", [cap]);

const photoMessage = (over: Partial<ChatSourceMessage> = {}): ChatSourceMessage => ({ id: messageId, companyId, chatId, contactId, direction: "incoming", uploadedByUserId: sellerId,
  imageId: id(5) as ImageId, text: null, caption: null, sentAt: hourBefore, receivedAt: at, ...over });
const textMessage = (text: string | null, over: Partial<ChatSourceMessage> = {}): ChatSourceMessage => photoMessage({ imageId: null, text, ...over });

const visual = (productId: ProductId, confidence = 0.92): ImageIdentification =>
  ({ kind: "found", method: "visual", productId, confidence: confidence as MatchConfidence, candidates: 2, topDistance: 0.1, chosenDistance: 0.1 });


const existingOrder = (items: OrderAggregate["items"] = [{ id: id(60) as OrderItemId, variantId: cap.variantId, productName: "Gorra", variantAttributes: {}, sku: null,
  quantity: 1 as PositiveInteger, unitPrice: money(25), subtotal: money(25), mentionedPrice: null, stockDeductedQuantity: 0 }]): OrderAggregate => ({
  number: 1007 as OrderNumber, id: id(9) as OrderId, companyId, sellerId, chatId, buyer: { contactId, name: null, phone: null },
  fromCatalog: false, checkoutEnabledAt: null, checkoutConfirmedAt: null, createdAt: hourBefore, scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null, cancelled: false, cancelledAt: null,
  items, payments: [], delivery: null, deliveryStatus: "pending", stockDeducted: false, stockDeductedAt: null,
  itemsTotal: money(25), deliveryCost: money(0), deliveryCharge: money(0), total: money(25) });



const pendingSet = (...pendings: ChatPending[]): ChatPendings => ({ pendings, readyRemembered: false });


const current = (text: string) => ({ source: "current" as const, text });
const intent = (id: string, kind: RequestIntent["kind"], quote: string): RequestIntent => ({ id: id as RequestRef, kind, quote: current(quote) });
const extracted = (id: string, kind: ExtractedRequest["kind"], over: Partial<ExtractedRequest> = {}): ExtractedRequest =>
  ({ request: id as RequestRef, kind, target: { kind: "none" }, values: [], quantity: null, price: null, changeVerb: null, ...over });
const chosen = (id: string, productId: ProductId): ProductResolution => ({ request: id as RequestRef, kind: "chosen", productId, values: [] });
const call = (stage: ReaderStage, reading: Reading): StageCall => ({ stage, reading, provider: "fake", model: "m", promptVersion: "v1", usage: null, costUsd: null, durationMs: 1, attempts: 1 });
const requestsOf = (...requests: RequestIntent[]): IntentReading => ({ kind: "requests", requests, language: "es", addresses: [] });

type Script = Readonly<{ intent?: IntentReading | Readonly<{ code: "AI_PROVIDER_UNAVAILABLE" | "INVALID_AI_RESPONSE" }>; extraction?: readonly ExtractedRequest[]; resolutions?: readonly ProductResolution[]; confirms?: boolean }>;

/** Scripted stages: they answer what the test says and log their calls in order. */
function stagesOf(script: Script, log: string[], signals: AbortSignal[]): ReaderStages {
  const failure = (stage: ReaderStage, code: "AI_PROVIDER_UNAVAILABLE" | "INVALID_AI_RESPONSE") => err({ code, stage, call: null, message: code });
  return {
    readIntent: async (_input, reading) => {
      log.push(`intent:${reading}`);
      const answer = script.intent ?? { kind: "no_intent", reason: "other", language: "es", addresses: [] };
      return "code" in answer ? failure("intent", answer.code) : ok({ value: answer, call: call("intent", reading) });
    },
    extractRequests: async (_input, _intents, reading, signal) => { log.push(`extraction:${reading}`); signals.push(signal); return ok({ value: script.extraction ?? [], call: call("extraction", reading) }); },
    chooseProducts: async (_mentions, _candidates, reading) => { log.push(`resolution:${reading}`); return ok({ value: script.resolutions ?? [], call: call("resolution", reading) }); },
    confirms: { intent: false, extraction: script.confirms ?? true, resolution: false },
  };
}

type Options = Readonly<{
  message?: ChatSourceMessage | null;
  identification?: ImageIdentification;
  script?: Script;
  noStages?: boolean;
  target?: ChatOrderTarget;
  pendings?: ChatPendings;
  memory?: ChatMemory;
  stored?: StoredChatMessageOutcome;
  readiness?: CatalogSearchReadiness;
  catalog?: readonly ProductForReading[];
  armed?: boolean;
  shadow?: Promise<{ answer: "actions"; actionKinds: readonly string[]; usage: null; costUsd: null } | null>;
  limits?: Partial<ApplyChatMessageDependencies["limits"]>;
  overrides?: Partial<ApplyChatMessageDependencies>;
}>;

type Store = { changes: OrderItemChange[]; orders: Map<string, OrderAggregate>; pendings: ChatPendings; memory: ChatMemory; customers: Set<string>; messages: Map<string, string>; outcomes: Map<string, ChatMessageOutcomes>; linkNotices: boolean[] };

/** The reading input a context load would build: lines and pendings with short refs. */
function contextOf(message: ChatSourceMessage, target: ChatOrderTarget, pendings: ChatPendings): ReadingContextData {
  const items = target.kind === "open" ? target.order.items.map((item, index) => ({ ref: `I${index + 1}` as ItemRef, itemId: item.id, productId: target.productIds.get(item.variantId) ?? null, variantId: item.variantId,
    productName: item.productName, variantAttributes: item.variantAttributes, quantity: item.quantity })) : [];
  const pendingRefs = pendings.pendings.map((pending, index) => ({ ref: `Q${index + 1}` as PendingRef, pendingId: pending.id, productIds: [productPolo], known: pending.known, quantity: pending.quantity, doubtful: pending.doubt !== null }));
  return { target, life: { alive: pendings.pendings, ended: [] }, contextMessageIds: new Map<ContextMessageRef, ChatMessageId>(), masks: new Map(), photoOutcome: null, cut: { contextDropped: 0, itemsOmitted: 0, pendingsOmitted: 0 },
    input: { current: { messageId: message.id, kind: message.imageId ? "image" : "text", text: message.text ?? message.caption ?? "" }, context: [], items, pendings: pendingRefs, photoMemory: null, photo: null } };
}

/** In-memory ports; `transaction` restores the state when its work fails, like a rollback. */
function harness(options: Options = {}) {
  const calls: string[] = [];
  const stageLog: string[] = [];
  const signals: AbortSignal[] = [];
  const pendingSaves: { set: ChatPendings; memory: ChatMemory }[] = [];
  const changeSaves: MessageChanges[] = [];
  const traces: Parameters<ApplyChatMessageDependencies["buildMessageTrace"]>[0][] = [];
  const outcomeTimes: Date[] = [];
  const store: Store = { changes: [], orders: new Map(), pendings: options.pendings ?? pendingSet(), memory: options.memory ?? { lastIncomingPhoto: null, lastRequestAt: null }, customers: new Set(), messages: new Map(), outcomes: new Map(), linkNotices: [] };
  const called = <T,>(name: string, value: T): T => { calls.push(name); return value; };
  const target: ChatOrderTarget = options.target ?? { kind: "none" };
  if (target.kind === "open") store.orders.set(target.order.id, target.order);
  const catalog = options.catalog ?? [polo, gorra];
  const message = options.message === undefined ? photoMessage() : options.message;
  const deps: ApplyChatMessageDependencies = {
    findOutcome: async (key) => called("findOutcome", ok(options.stored && key === messageId ? options.stored : store.outcomes.has(key) ? { outcomes: store.outcomes.get(key)!, noticeSentAt: null } : null)),
    findSourceMessage: async () => called("findSourceMessage", ok(message)),
    findChatOrderTarget: async () => called("findChatOrderTarget", ok(target.kind === "open" ? { ...target, order: store.orders.get(target.order.id)! } : target)),
    findChatOrdersOpenedSince: async () => called("findChatOrdersOpenedSince", ok([])),
    findChatPendings: async () => called("findChatPendings", ok(store.pendings)),
    findChatPendingsForUpdate: async () => called("findChatPendingsForUpdate", ok(store.pendings)),
    findChatMemory: async () => ok(store.memory),
    saveChatPendings: async (_chat, set, memory) => { calls.push("saveChatPendings"); pendingSaves.push({ set, memory }); store.pendings = set; store.memory = memory; return ok(null); },
    readImage: async () => called("readImage", ok({ bytes: new Uint8Array([1]), contentType: "image/jpeg" })),
    identifyProductsInImage: async () => called("identifyProductsInImage", ok(options.identification ?? visual(productCap))),
    loadReadingContext: async (loaded, loadedTarget, pendings) => called("loadReadingContext", ok(contextOf(loaded, loadedTarget, pendings))),
    findMentionCandidates: async (mentions) => called("findMentionCandidates", ok({ mentions: mentions.map((words) => ({ productIds: [words.includes("gorra") ? productCap : productPolo], unavailableProductIds: [], matchCount: 1, wordsSearched: 2 })), durationMs: 4, timedOut: false })),
    findProductsForReading: async (ids) => called("findProductsForReading", ok(catalog.filter((product) => ids.includes(product.productId)))),
    catalogSearchReadiness: async () => called("catalogSearchReadiness", ok(options.readiness ?? "ready")),
    stages: options.noStages ? null : stagesOf(options.script ?? {}, stageLog, signals),
    readChatMessage: null,
    createDeadline: (_budget, _meta, jobSignal) => jobSignal,
    withAbort,
    transaction: async (_company, work) => {
      calls.push("transaction");
      const snapshot = structuredClone({ orders: store.orders, pendings: store.pendings, memory: store.memory, customers: store.customers, messages: store.messages, outcomes: store.outcomes, linkNotices: store.linkNotices });
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
    recordOrderMessage: async (orderId, key, linkChangeNotice) => { calls.push("recordOrderMessage"); store.messages.set(key, orderId); store.linkNotices.push(linkChangeNotice); return ok(null); },
    findUnverdictedChanges: async () => ok({ open: store.changes.filter((change) => change.verdict === null && change.supersededBy === null), lastSeq: Math.max(0, ...store.changes.map((change) => change.seq)) }),
    findLinkNoticeArming: async () => ok(options.armed ?? false),
    saveMessageChanges: async (saved) => {
      changeSaves.push(saved);
      store.changes = [...store.changes.map((change) => saved.supersedes.includes(change.id) ? { ...change, supersededBy: saved.changes[0]!.id } : change), ...saved.changes];
      return ok(null);
    },
    newChangeId: (() => { let counter = 800; return () => id(counter++) as OrderItemChangeId; })(),
    recordOutcome: async ({ messageId: key, outcomes, createdAt }) => { calls.push("recordOutcome"); store.outcomes.set(key, outcomes); if (createdAt) outcomeTimes.push(createdAt); return ok(null); },
    newOrderId: () => id(500) as OrderId,
    newItemId: (() => { let counter = 300; return () => id(counter++) as OrderItemId; })(),
    newPendingId: (() => { let counter = 700; return () => id(counter++) as ChatPendingId; })(),
    clock: () => at,
    buildMessageTrace: (input) => { traces.push(input); return { trace: { messageId: input.message.id } as never, masks: [] } satisfies BuiltMessageTrace; },
    saveMessageTrace: async () => called("saveMessageTrace", ok(null)),
    shadowReader: options.shadow ? () => options.shadow! : null,
    limits: { maxItemQuantity: 99 as PositiveInteger, pendingTtlMs: 7 * 86_400_000, maxReaderProducts: 24, maxReaderItems: 40, maxReaderTextChars: 2000,
      readingBudgetMs: 60_000, candidatesPerMention: 5, traceRetentionDays: 90, shadowWaitMs: 50, ...options.limits },
    ...options.overrides,
  };
  const controller = new AbortController();
  return { calls, stageLog, signals, pendingSaves, changeSaves, traces, outcomeTimes, store, controller, deps, run: () => applyChatMessage({ companyId, messageId }, deps, controller.signal) };
}

const quantityOf = (store: Store, variantId: VariantId) => [...store.orders.values()].flatMap((order) => order.items).find((item) => item.variantId === variantId)?.quantity;
const succeeded = async <T,>(result: Promise<Result<T, { code: string; message: string }>>) => { const done = await result; if (!done.success) throw new Error(done.error.code); return done.data; };
const outcomeKinds = (store: Store) => [...store.outcomes.values()].flatMap((outcomes) => outcomes.map(({ kind }) => kind));
const poloOrder = () => existingOrder([{ id: id(61) as OrderItemId, variantId: poloL.variantId, productName: "Polo básico", variantAttributes: { Talla: "L" }, sku: null,
  quantity: 1 as PositiveInteger, unitPrice: money(35), subtotal: money(35), mentionedPrice: null, stockDeductedQuantity: 0 }]);
const poloTarget = (): ChatOrderTarget => { const order = poloOrder(); return { kind: "open", order, productIds: new Map(order.items.map((item) => [item.variantId, productPolo])) }; };
const addPolo = (quote = "el polo") => extracted("R1", "add", { target: { kind: "named", words: current(quote) }, values: [{ attributeWords: null, valueWords: current("M") }] });
const poloInM = (): ProductResolution => ({ request: "R1" as RequestRef, kind: "chosen", productId: productPolo, values: [{ attribute: "Talla", value: "M", quote: current("M") }] });

describe("applyChatMessage: the staged pipeline", () => {
  test("applies a message through the three stages and records its changes and trace", async () => {
    const h = harness({ message: textMessage("dame el polo M"), script: { intent: requestsOf(intent("R1", "add", "el polo M")), extraction: [addPolo("el polo")], resolutions: [poloInM()] } });
    const applied = await succeeded(h.run());

    expect(applied).toMatchObject({ kind: "applied", createdOrder: true, outcomes: [{ kind: "added", variantId: poloM.variantId }], trace: { stageCalls: 3, answer: "actions", confirmingRun: false } });
    expect(quantityOf(h.store, poloM.variantId)).toBe(1);
    expect(h.changeSaves[0]!.changes).toMatchObject([{ kind: "added", decision: { kind: "applied" }, quoteId: 0 }]);
    expect(h.stageLog).toEqual(["intent:primary", "extraction:primary", "resolution:primary"]);
    expect(h.traces).toHaveLength(1);
    expect(h.traces[0]!.records.map(({ stage }) => stage)).toEqual(["intent", "extraction", "resolution"]);
    expect(h.calls.indexOf("saveMessageTrace")).toBeGreaterThan(h.calls.lastIndexOf("recordOutcome"));
    expect(h.store.memory.lastRequestAt).toEqual(at);
    expect(h.outcomeTimes).toEqual([at]);
  });

  test("skips extraction and resolution when the intent is no intent", async () => {
    const h = harness({ message: textMessage("hola, buenas tardes") });
    const applied = await succeeded(h.run());

    expect(applied).toMatchObject({ kind: "applied", noticeDue: false, outcomes: [{ kind: "no_intent" }], trace: { answer: "no_intent", stageCalls: 1 } });
    expect(h.stageLog).toEqual(["intent:primary"]);
    expect(h.store.memory.lastRequestAt).toBeNull();
  });

  test("records reader_doubt for an unsure intent and notifies the seller", async () => {
    const h = harness({ message: textMessage("mmm"), script: { intent: { kind: "unsure", language: "es", addresses: [] } } });

    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "reader_doubt" }], noticeDue: true });
  });

  test("skips texts when no stages are configured", async () => {
    const h = harness({ message: textMessage("dame el polo"), noStages: true });

    expect(await succeeded(h.run())).toEqual({ kind: "skipped", reason: "reader_disabled" });
    expect(h.calls).not.toContain("transaction");
  });

  test("skips an outgoing message and an empty text", async () => {
    expect(await succeeded(harness({ message: textMessage("hola", { direction: "outgoing" }) }).run())).toEqual({ kind: "skipped", reason: "outgoing_message" });
    expect(await succeeded(harness({ message: textMessage("   ") }).run())).toEqual({ kind: "skipped", reason: "empty_text" });
  });

  test("reports text too long without calling a stage", async () => {
    const h = harness({ message: textMessage("x".repeat(2001)) });

    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "invalid_action", reason: "text_too_long" }] });
    expect(h.stageLog).toEqual([]);
  });

  test("starts the confirming extraction together with the primary one and aborts it when no action needs it", async () => {
    const change = extracted("R1", "change_quantity", { target: { kind: "context", basis: "only_item", ref: "I1" as ItemRef }, quantity: { value: 3, mode: "set", quote: current("3") } });
    const h = harness({ message: textMessage("mejor 3"), target: poloTarget(), script: { intent: requestsOf(intent("R1", "change_quantity", "mejor 3")), extraction: [change] } });
    await succeeded(h.run());

    expect(h.stageLog).toEqual(["intent:primary", "extraction:primary", "extraction:confirming"]);
    expect(h.signals[1]!.aborted).toBe(true);
    expect(h.signals[0]!.aborted).toBe(false);
  });

  test("starts the intent stage concurrently with the photo cascade on a captioned photo", async () => {
    const h = harness({ message: photoMessage({ caption: "hola" }), identification: visual(productCap) });
    await succeeded(h.run());

    expect(h.calls.indexOf("loadReadingContext")).toBeLessThan(h.calls.indexOf("readImage"));
    expect(h.stageLog[0]).toBe("intent:primary");
    expect(h.calls).toContain("identifyProductsInImage");
  });

  test("adds the photo's only variant without any stage call when it has no caption", async () => {
    const h = harness({ identification: visual(productCap) });

    expect(await succeeded(h.run())).toMatchObject({ kind: "applied", createdOrder: true, outcomes: [{ kind: "added", variantId: cap.variantId, quantity: 1 }], trace: { answer: "fixed", stageCalls: 0 } });
    expect(h.stageLog).toEqual([]);
    expect(h.store.memory.lastIncomingPhoto).toEqual({ left: { kind: "item", orderId: id(500), variantId: cap.variantId, quantity: 1 } });
  });

  test("marks the item added from a photo whose caption could not be read", async () => {
    const h = harness({ message: photoMessage({ caption: "x".repeat(2001) }), identification: visual(productCap) });
    await succeeded(h.run());

    expect(h.changeSaves[0]!.changes).toMatchObject([{ kind: "added", decision: { kind: "doubtful", reason: { kind: "caption_unread" } } }]);
  });

  test("adds the shown product when the caption of a product photo reads as no intent", async () => {
    const h = harness({ message: photoMessage({ caption: "qué linda se ve" }), identification: visual(productCap) });

    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "added", variantId: cap.variantId }], trace: { answer: "fixed" } });
    expect(h.stageLog).toEqual(["intent:primary"]);
  });

  test("leaves a pending for a product photo with several variants when its caption reads as no intent", async () => {
    const h = harness({ message: photoMessage({ caption: "qué linda se ve" }), identification: visual(productPolo) });

    expect(await succeeded(h.run())).toMatchObject({ noticeDue: true, outcomes: [{ kind: "pending_created" }, { kind: "variant_missing" }] });
  });

  test("marks the add of a product photo whose caption the intent was unsure about", async () => {
    const h = harness({ message: photoMessage({ caption: "mmm ese o el otro" }), identification: visual(productCap), script: { intent: { kind: "unsure", language: "es", addresses: [] } } });
    await succeeded(h.run());

    expect(h.changeSaves[0]!.changes).toMatchObject([{ kind: "added", decision: { kind: "doubtful", reason: { kind: "caption_unread" } } }]);
  });

  test("treats a caption of symbols as no caption: no stage runs", async () => {
    const h = harness({ message: photoMessage({ caption: "😍😍 !!" }), identification: visual(productCap) });

    expect(await succeeded(h.run())).toMatchObject({ outcomes: [{ kind: "added", variantId: cap.variantId }], trace: { answer: "fixed", stageCalls: 0 } });
    expect(h.stageLog).toEqual([]);
  });

  test("skips a text of symbols without a stage call", async () => {
    expect(await succeeded(harness({ message: textMessage("👍") }).run())).toEqual({ kind: "skipped", reason: "empty_text" });
  });

  test("adds the shown product next to a payment request in its caption", async () => {
    const h = harness({ message: photoMessage({ caption: "pásame tu yape" }), identification: visual(productCap), script: { intent: requestsOf(intent("R1", "payment_request", "pásame tu yape")),
      extraction: [extracted("R1", "payment_request")] } });

    expect(await succeeded(h.run())).toMatchObject({ outcomes: expect.arrayContaining([expect.objectContaining({ kind: "added", variantId: cap.variantId }), expect.objectContaining({ kind: "payment_requested" })]) });
  });

  test("a caption that declines the product photo adds nothing", async () => {
    const h = harness({ message: photoMessage({ caption: "no la quiero" }), identification: visual(productCap), script: { intent: requestsOf(intent("R1", "decline", "no la quiero")),
      extraction: [extracted("R1", "decline", { target: { kind: "photo_same_message" } })] } });
    await succeeded(h.run());

    expect(quantityOf(h.store, cap.variantId)).toBeUndefined();
  });

  test("records not identified for a photo without a match and keeps it silent while the catalog cannot recognize photos", async () => {
    expect(await succeeded(harness({ identification: { kind: "not_found", topDistance: 0.9 } as ImageIdentification }).run())).toMatchObject({ noticeDue: true, outcomes: [{ kind: "not_identified", source: "photo", silent: false }] });
    expect(await succeeded(harness({ identification: { kind: "not_found", topDistance: 0.9 } as ImageIdentification, readiness: "no_indexed_products" as CatalogSearchReadiness }).run())).toMatchObject({ noticeDue: false });
  });

  test("retries when a stage's provider is unavailable and writes nothing", async () => {
    const h = harness({ message: textMessage("dame el polo"), script: { intent: { code: "AI_PROVIDER_UNAVAILABLE" } } });
    const result = await h.run();

    expect(result).toEqual({ success: false, error: expect.objectContaining({ code: "AI_PROVIDER_UNAVAILABLE" }) });
    expect(h.calls).not.toContain("transaction");
  });

  test("saves a trace with no decision time and the stage's error code when a stage fails, and still returns the error", async () => {
    const h = harness({ message: textMessage("dame el polo"), script: { intent: { code: "AI_PROVIDER_UNAVAILABLE" } } });
    const result = await h.run();

    expect(result).toEqual({ success: false, error: { code: "AI_PROVIDER_UNAVAILABLE", message: "AI_PROVIDER_UNAVAILABLE" } });
    expect(h.traces).toHaveLength(1);
    expect(h.traces[0]).toMatchObject({ decidedAt: null, intent: null, records: [{ stage: "intent", errorCode: "AI_PROVIDER_UNAVAILABLE" }] });
    expect(h.calls).toContain("saveMessageTrace");
    expect(h.calls).not.toContain("transaction");
  });

  test("keeps the intent and the stages that ran when a later stage fails", async () => {
    const h = harness({ message: textMessage("dame el polo"), script: { intent: requestsOf(intent("R1", "add", "el polo")), extraction: [addPolo("el polo")] },
      overrides: { findMentionCandidates: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" }) } });
    const result = await h.run();

    expect(result).toEqual({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "down" } });
    expect(h.traces[0]).toMatchObject({ decidedAt: null, intent: { kind: "requests" }, records: [{ stage: "intent", errorCode: null }, { stage: "extraction", errorCode: null }] });
  });

  test("fails permanently for an invalid stage answer", async () => {
    const result = await harness({ message: textMessage("dame el polo"), script: { intent: { code: "INVALID_AI_RESPONSE" } } }).run();

    expect(result).toEqual({ success: false, error: expect.objectContaining({ code: "INVALID_AI_RESPONSE" }) });
  });

  test("ends as already processed without any work for a message with an outcome", async () => {
    const h = harness({ stored: { outcomes: [{ kind: "no_intent" }], noticeSentAt: null } });

    expect(await succeeded(h.run())).toEqual({ kind: "already_processed", noticeDue: false });
    expect(h.calls).toEqual(["findOutcome"]);
  });

  test("ends as already processed when another run recorded the message first", async () => {
    let reads = 0;
    const winner: StoredChatMessageOutcome = { outcomes: [{ kind: "no_intent" }], noticeSentAt: null };
    const h = harness({ message: textMessage("hola"), overrides: {
      findOutcome: async () => ok(++reads > 2 ? winner : null),
      recordOutcome: async () => err({ code: "MESSAGE_ALREADY_PROCESSED" as const, message: "dup" }) } });

    expect(await succeeded(h.run())).toMatchObject({ kind: "already_processed" });
  });
});

describe("applyChatMessage: decisions", () => {
  test("applies «la quiero en M» on the only item as a doubtful variant change with no notice", async () => {
    const change = extracted("R1", "change_variant", { target: { kind: "context", basis: "only_item", ref: "I1" as ItemRef }, values: [{ attributeWords: null, valueWords: current("M") }] });
    const h = harness({ message: textMessage("la quiero en M"), target: poloTarget(), script: { intent: requestsOf(intent("R1", "change_variant", "la quiero en M")), extraction: [change], resolutions: [] } });
    const applied = await succeeded(h.run());

    expect(applied.kind === "applied" && applied.noticeDue).toBe(false);
    expect(h.traces[0]!.records).toHaveLength(3);
    expect(h.changeSaves[0]!.changes.length).toBeGreaterThan(0);
    expect(h.changeSaves[0]!.changes.every((row) => row.decision.kind === "doubtful")).toBe(true);
    expect(h.changeSaves[0]!.changes).toContainEqual(expect.objectContaining({ kind: "added", decision: { kind: "doubtful", reason: { kind: "variant_changed", attribute: "Talla", from: "L", to: "M" } } }));
    expect(quantityOf(h.store, poloM.variantId)).toBe(1);
  });

  test("decides a payment request as urgent with the open order and writes no change", async () => {
    const h = harness({ message: textMessage("¿cómo te pago?"), target: poloTarget(), script: { intent: requestsOf(intent("R1", "payment_request", "cómo te pago")), extraction: [extracted("R1", "payment_request")] } });
    const applied = await succeeded(h.run());

    expect(applied).toMatchObject({ kind: "applied", noticeDue: true, outcomes: [{ kind: "payment_requested", order: { kind: "open" } }] });
    expect(h.changeSaves).toHaveLength(0);
    expect(quantityOf(h.store, poloL.variantId)).toBe(1);
  });

  test("applies the doubtful changes and notifies only the urgent ones of one message", async () => {
    const doubtful = extracted("R1", "change_variant", { target: { kind: "context", basis: "only_item", ref: "I1" as ItemRef }, values: [{ attributeWords: null, valueWords: current("M") }] });
    const h = harness({ message: textMessage("en M, y cómo te pago"), target: poloTarget(), script: { intent: requestsOf(intent("R1", "change_variant", "en M"), intent("R2", "payment_request", "cómo te pago")),
      extraction: [doubtful, extracted("R2", "payment_request")] } });
    const applied = await succeeded(h.run());

    expect(applied.kind === "applied" && applied.trace.doubtfulCount).toBe(1);
    expect(applied).toMatchObject({ noticeDue: true, outcomes: expect.arrayContaining([expect.objectContaining({ kind: "payment_requested" })]) });
    expect(h.changeSaves[0]!.changes.every((row) => row.decision.kind === "doubtful")).toBe(true);
  });
});

describe("applyChatMessage: too many requests", () => {
  test("cuts the requests beyond the tenth and reports too_many_actions as urgent", async () => {
    const ids = Array.from({ length: 11 }, (_, index) => `R${index + 1}`);
    const h = harness({ message: textMessage("cómo te pago"), target: poloTarget(), script: { intent: requestsOf(...ids.map((request) => intent(request, "payment_request", "cómo te pago"))),
      extraction: ids.slice(0, 10).map((request) => extracted(request, "payment_request")) } });
    const applied = await succeeded(h.run());

    expect(applied).toMatchObject({ kind: "applied", noticeDue: true, outcomes: expect.arrayContaining([expect.objectContaining({ kind: "invalid_action", reason: "too_many_actions" })]) });
    expect(applied.kind === "applied" && applied.trace.actionKinds).toHaveLength(10);
  });
});

const pointOf = (over: Partial<ChatPending> = {}): ChatPending => ({ id: id(700) as ChatPendingId, subject: { kind: "variant", productId: productPolo }, known: {}, quantity: 3 as PositiveInteger, price: null,
  order: { orderId: id(9) as OrderId, attachedAt: hourBefore }, lastChangedAt: hourBefore, sourceMessageId: id(70) as ChatMessageId, requestId: id(700) as ChatPendingId,
  doubt: { reason: { kind: "quantity_set", quantity: 3 as PositiveInteger } }, pointSince: hourBefore, acknowledgedAt: null, ...over });
const inheritedFromQuantity = { kind: "inherited", from: { kind: "quantity_set", quantity: 3 } };

describe("applyChatMessage: pendings with a doubt", () => {
  const completeWithM = (quantity: number | null) => ({ message: textMessage(quantity === null ? "el polo en M" : "uno en M"), target: poloTarget(), script: { intent: requestsOf(intent("R1", quantity === null ? "add" : "complete_pending", quantity === null ? "el polo en M" : "uno en M")),
    extraction: [quantity === null ? addPolo("el polo") : extracted("R1", "complete_pending", { target: { kind: "pending", ref: "Q1" as PendingRef, named: null }, values: [{ attributeWords: null, valueWords: current("M") }],
      quantity: { value: quantity, mode: "set", quote: current("uno") } })], resolutions: quantity === null ? [poloInM()] : [] } });

  test("applies a doubtful quantity change on a pending with its doubt and an unacknowledged point", async () => {
    const more = extracted("R1", "change_quantity", { target: { kind: "pending", ref: "Q1" as PendingRef, named: null }, quantity: { value: 2, mode: "add", quote: current("2 más") } });
    const h = harness({ message: textMessage("2 más de esas"), target: poloTarget(), pendings: pendingSet(pointOf({ doubt: null, quantity: 2 as PositiveInteger, acknowledgedAt: hourBefore })),
      script: { intent: requestsOf(intent("R1", "change_quantity", "2 más")), extraction: [more] } });
    await succeeded(h.run());

    expect(h.store.pendings.pendings[0]).toMatchObject({ quantity: 4, doubt: { reason: { kind: "quantity_set", quantity: 4 } }, pointSince: at, acknowledgedAt: null });
    expect(h.changeSaves[0]!.changes).toHaveLength(0);
  });

  test("gives the item created by a full completion the pending's «Con duda»", async () => {
    const h = harness({ ...completeWithM(null), pendings: pendingSet(pointOf()) });
    await succeeded(h.run());

    expect(h.store.pendings.pendings).toHaveLength(0);
    expect(h.changeSaves[0]!.changes).toContainEqual(expect.objectContaining({ kind: "added", after: expect.objectContaining({ variantId: poloM.variantId }), decision: { kind: "doubtful", reason: inheritedFromQuantity } }));
  });

  test("gives the item created by a split completion the pending's «Con duda» while the remainder keeps the pending id", async () => {
    const h = harness({ ...completeWithM(1), pendings: pendingSet(pointOf()) });
    await succeeded(h.run());

    expect(h.store.pendings.pendings).toMatchObject([{ id: id(700), quantity: 2 }]);
    expect(h.changeSaves[0]!.changes).toContainEqual(expect.objectContaining({ kind: "added", after: expect.objectContaining({ variantId: poloM.variantId, quantity: 1 }), decision: { kind: "doubtful", reason: inheritedFromQuantity } }));
  });

  test("marks only the variant a completion created, not the other lines the message changes", async () => {
    const both = harness({ message: textMessage("el polo en M y una gorra"), target: poloTarget(), pendings: pendingSet(pointOf()), script: { intent: requestsOf(intent("R1", "add", "el polo en M"), intent("R2", "add", "una gorra")),
      extraction: [addPolo("el polo"), extracted("R2", "add", { target: { kind: "named", words: current("una gorra") } })], resolutions: [poloInM(), chosen("R2", productCap)] } });
    await succeeded(both.run());
    const rows = both.changeSaves[0]!.changes;

    expect(rows.find((row) => row.after?.variantId === cap.variantId)?.decision).toEqual({ kind: "applied" });
    expect(rows.find((row) => row.after?.variantId === poloM.variantId)?.decision).toMatchObject({ kind: "doubtful" });
  });

  test("gives no mark when the doubt was acknowledged", async () => {
    const h = harness({ ...completeWithM(null), pendings: pendingSet(pointOf({ acknowledgedAt: at })) });
    await succeeded(h.run());

    expect(h.changeSaves[0]!.changes).toContainEqual(expect.objectContaining({ kind: "added", decision: { kind: "applied" } }));
  });
});

describe("applyChatMessage: questions and noted prices", () => {
  test("adds the suggested question of an urgent decision as the questions outcome", async () => {
    const order = existingOrder([...poloOrder().items, ...existingOrder().items]);
    const target: ChatOrderTarget = { kind: "open", order, productIds: new Map([[poloL.variantId, productPolo], [cap.variantId, productCap]]) };
    const h = harness({ message: textMessage("quita uno"), target, script: { intent: requestsOf(intent("R1", "remove", "quita uno")), extraction: [extracted("R1", "remove")] } });
    const applied = await succeeded(h.run());

    expect(applied).toMatchObject({ kind: "applied", noticeDue: true, outcomes: expect.arrayContaining([{ kind: "questions", questions: [expect.objectContaining({ kind: "which_item_to_remove" })] }]) });
  });

  test("applies a price noted from context as «Con duda» with price_noted", async () => {
    const price = extracted("R1", "mention_price", { target: { kind: "item", ref: "I1" as ItemRef, named: null }, price: { amount: 30, currency: "order", basis: "unit", quote: current("a 30") } });
    const h = harness({ message: textMessage("a 30"), target: poloTarget(), script: { intent: requestsOf(intent("R1", "mention_price", "a 30")), extraction: [price] } });
    await succeeded(h.run());

    expect(h.changeSaves[0]!.changes).toMatchObject([{ kind: "mentioned_price_set", decision: { kind: "doubtful", reason: { kind: "price_noted" } } }]);
  });
});

describe("applyChatMessage: link notice", () => {
  const sureAdd = () => ({ message: textMessage("dame una gorra"), target: poloTarget(), script: { intent: requestsOf(intent("R1", "add", "una gorra")),
    extraction: [extracted("R1", "add", { target: { kind: "named", words: current("una gorra") } })], resolutions: [chosen("R1", productCap)] } });

  test("sends «Pedido #N cambió» once per cycle after a recorded link action", async () => {
    const armed = harness({ ...sureAdd(), armed: true });
    const applied = await succeeded(armed.run());

    expect(applied).toMatchObject({ noticeDue: true, outcomes: expect.arrayContaining([{ kind: "changed_after_link", orderId: id(9) }]) });
    expect(armed.store.linkNotices).toEqual([true]);
    // The next message finds the arming read false (the notice closed the cycle) and sends nothing for that reason.
    const second = await succeeded(harness({ ...sureAdd(), armed: false }).run());
    expect(second.kind === "applied" && second.outcomes.some(({ kind }) => kind === "changed_after_link")).toBe(false);
  });

  test("sends no «Pedido #N cambió» before any recorded link action", async () => {
    const h = harness({ ...sureAdd(), armed: false });
    const applied = await succeeded(h.run());

    expect(applied).toMatchObject({ noticeDue: false });
    expect(h.store.linkNotices).toEqual([false]);
  });

  test("appends the changed-after-link sentence to an urgent problem and closes the cycle", async () => {
    const h = harness({ message: textMessage("dame una gorra y cómo te pago"), target: poloTarget(), armed: true, script: { intent: requestsOf(intent("R1", "add", "una gorra"), intent("R2", "payment_request", "cómo te pago")),
      extraction: [extracted("R1", "add", { target: { kind: "named", words: current("una gorra") } }), extracted("R2", "payment_request")], resolutions: [chosen("R1", productCap)] } });
    await succeeded(h.run());

    expect(h.store.linkNotices).toEqual([true]);
  });

  test("sends «Pedido #N cambió» for a doubtful change and closes the cycle", async () => {
    const change = extracted("R1", "change_variant", { target: { kind: "context", basis: "only_item", ref: "I1" as ItemRef }, values: [{ attributeWords: null, valueWords: current("M") }] });
    const h = harness({ message: textMessage("la quiero en M"), target: poloTarget(), armed: true, script: { intent: requestsOf(intent("R1", "change_variant", "la quiero en M")), extraction: [change] } });
    const applied = await succeeded(h.run());

    expect(applied.kind === "applied" && applied.outcomes.some(({ kind }) => kind === "changed_after_link")).toBe(true);
    expect(h.store.linkNotices).toEqual([true]);
  });

  test("sends «Pedido #N cambió» for a message that only creates a «Por resolver» point of the open order", async () => {
    const poloNoValue = extracted("R1", "add", { target: { kind: "named", words: current("el polo") } });
    const h = harness({ message: textMessage("dame el polo"), target: poloTarget(), armed: true, script: { intent: requestsOf(intent("R1", "add", "el polo")), extraction: [poloNoValue],
      resolutions: [{ request: "R1" as RequestRef, kind: "chosen", productId: productPolo, values: [] }] } });
    const applied = await succeeded(h.run());

    expect(h.changeSaves[0]!.changes).toHaveLength(0);
    expect(h.changeSaves[0]!.pendingsAfter).toHaveLength(1);
    expect(applied).toMatchObject({ kind: "applied", pendingsAfter: 1, outcomes: expect.arrayContaining([{ kind: "changed_after_link", orderId: id(9) }]) });
    expect(h.store.linkNotices).toEqual([true]);
  });

  test("sends nothing for a message that changes neither the lines nor the points", async () => {
    const h = harness({ message: textMessage("hola"), target: poloTarget(), armed: true });
    const applied = await succeeded(h.run());

    expect(applied.kind === "applied" && applied.outcomes.some(({ kind }) => kind === "changed_after_link")).toBe(false);
    expect(h.store.linkNotices).toEqual([]);
  });
});

describe("applyChatMessage: trace and shadow", () => {
  test("saves the order even when the trace cannot be saved", async () => {
    const h = harness({ message: textMessage("hola"), overrides: { saveMessageTrace: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" }) } });

    expect(await succeeded(h.run())).toMatchObject({ kind: "applied" });
    expect(h.store.outcomes.size).toBe(1);
  });

  test("saves the order even when the trace builder throws", async () => {
    const h = harness({ message: textMessage("hola"), overrides: { buildMessageTrace: () => { throw new Error("boom"); } } });

    expect(await succeeded(h.run())).toMatchObject({ kind: "applied" });
  });

  test("hands the shadow reader's kinds to the trace and never applies them", async () => {
    const shadow = { answer: "actions" as const, actionKinds: ["add"], usage: null, costUsd: null };
    const h = harness({ message: textMessage("hola"), shadow: Promise.resolve(shadow) });
    await succeeded(h.run());

    expect(h.traces[0]!.shadow).toEqual(shadow);
    expect(outcomeKinds(h.store)).toEqual(["no_intent"]);
  });

  test("bounds the wait for the shadow after commit", async () => {
    const h = harness({ message: textMessage("hola"), shadow: new Promise(() => undefined), limits: { shadowWaitMs: 20 } });
    const started = performance.now();
    await succeeded(h.run());

    expect(performance.now() - started).toBeLessThan(1000);
    expect(h.traces[0]!.shadow).toBeNull();
    expect(h.traces[0]!.shadowWaitMs).toBeGreaterThanOrEqual(15);
  });

  test("never calls the stages, the catalog or the model inside the transaction", async () => {
    const h = harness({ message: textMessage("dame el polo M"), script: { intent: requestsOf(intent("R1", "add", "el polo M")), extraction: [addPolo()], resolutions: [chosen("R1", productPolo)] } });
    await succeeded(h.run());
    const tx = h.calls.indexOf("transaction");

    for (const name of ["loadReadingContext", "findMentionCandidates", "findProductsForReading"]) expect(h.calls.lastIndexOf(name)).toBeLessThan(tx);
  });
});

describe("applyChatMessage: persistence", () => {
  test("rolls the order and the pendings back together when saving the outcome fails", async () => {
    const h = harness({ message: textMessage("dame el polo M"), script: { intent: requestsOf(intent("R1", "add", "el polo M")), extraction: [addPolo()], resolutions: [poloInM()] },
      overrides: { recordOutcome: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" }) } });
    const result = await h.run();

    expect(result.success).toBe(false);
    expect(h.store.orders.size).toBe(0);
    expect(h.store.messages.size).toBe(0);
  });

  test("writes the pendings row only when the pendings or the memory changed", async () => {
    const h = harness({ message: textMessage("hola"), memory: { lastIncomingPhoto: null, lastRequestAt: null } });
    await succeeded(h.run());

    expect(h.pendingSaves).toHaveLength(0);
  });
});

describe("applyChatMessage: founder decision 5", () => {
  const intentJson = { outcome: "requests", noIntentReason: null, language: "es", addresses: [], requests: [{ kind: "add", quote: { message: "current", text: "el polo M" } }] };
  const extractionJson = { requests: [{ request: "R1", target: { kind: "named", ref: null, named: { message: "current", text: "el polo" }, basis: null },
    values: [{ attribute: null, value: { message: "current", text: "M" } }], quantity: null, price: null, changeVerb: null }] };
  const resolutionJson = { results: [{ request: "R1", kind: "chosen", products: ["P1"], values: [{ attribute: "Talla", value: "M", quote: "M" }] }] };

  test("configuring the extraction stage with the fake model leaves intent and resolution on their configured models and yields the same decisions", async () => {
    const openaiStages: string[] = [];
    const openai: StructuredModel = async (request) => {
      openaiStages.push(request.stage);
      return { success: true, data: { json: request.stage === "intent" ? intentJson : resolutionJson, usage: null } };
    };
    const fake = createFakeStructuredModel({ extraction: [{ json: extractionJson }] });
    const real = createReaderStages({ READER_EXTRACTION_PROVIDER: "fake" }, promptRegistry, { openai, fake });
    const h = harness({ message: textMessage("dame el polo M"), overrides: { stages: real } });
    const applied = await succeeded(h.run());

    const scripted = harness({ message: textMessage("dame el polo M"), script: { intent: requestsOf(intent("R1", "add", "el polo M")), extraction: [addPolo()], resolutions: [poloInM()] } });
    const baseline = await succeeded(scripted.run());
    expect(applied.kind === "applied" && applied.outcomes).toEqual(baseline.kind === "applied" ? baseline.outcomes : null);
    expect(applied).toMatchObject({ outcomes: [{ kind: "added", variantId: poloM.variantId }] });
    expect(fake.requests.map(({ stage }) => stage)).toEqual(["extraction"]);
    expect(openaiStages).toEqual(["intent", "resolution"]);
    expect(h.traces[0]!.records.map(({ call }) => `${call?.stage}:${call?.provider}`)).toEqual(["intent:openai", "extraction:fake", "resolution:openai"]);
  });
});
