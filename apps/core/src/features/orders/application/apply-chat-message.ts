import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { AiError } from "@core/src/shared/ai-tools/application/ai-error";
import { applyChatActions, needsNewChatOrder, type ChatOrderTarget, type ChatOrderItemChanges, type ChatOrderLimits, type ReportOutcome, type ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import type { ChatMessageFailureCode, ChatMessageOutcomes, StoredChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import { chooseSellerNotice, isNoticeDue } from "@core/src/features/orders/domain/seller-notice";
import type { ChatId, OrderChatSource } from "@core/src/features/orders/domain/message-order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { OrderAggregate, OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import type { CompanyId, ContactId, OrderId, OrderItemId, UserId } from "@core/src/features/orders/domain/order";
import { hasReadableText, type ChatContextItem, type ChatToolContext, type ShownProduct, type ToolResolveError } from "@core/src/features/orders/application/chat-message-tools";
import type { InterpretAndApply, Interpreted, InterpretationTrace } from "@core/src/features/orders/application/chat-message-interpreter";
import type { IdentifyProductsError, ImageIdentification } from "@core/src/features/products/application/identify-products-in-image";
import type { ImageBytes } from "@core/src/features/products/domain/image-identification";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import type { CatalogSearchReadiness, ProductWithSellableVariants } from "@core/src/features/products/domain/text-identification";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";
import type { ImageReadError } from "@core/src/shared/images";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type InvalidStoredData = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;
type ContactNotFound = Readonly<{ code: "CONTACT_NOT_FOUND"; message: string }>;
type SellerUnavailable = Readonly<{ code: "SELLER_UNAVAILABLE"; message: string }>;
type MessageAlreadyProcessed = Readonly<{ code: "MESSAGE_ALREADY_PROCESSED"; message: string }>;

export type ChatSourceMessage = Readonly<{
  id: ChatMessageId;
  companyId: CompanyId;
  chatId: ChatId;
  contactId: ContactId;
  direction: "incoming" | "outgoing";
  /** The seller of the orders this message creates. */
  uploadedByUserId: UserId;
  imageId: ImageId | null; // null en mensajes de texto
  text: string | null;
  caption: string | null;
}>;

/** The chat's open order as the models see it. Unlocked: the transaction re-reads the order under lock. */
export type ChatOrderContext = Readonly<{ items: readonly ChatContextItem[] }>;

export type AppliedChatMessage = Readonly<{ orderId: OrderId | null; createdOrder: boolean; outcomes: ChatMessageOutcomes }>;

export type ApplyChatMessageOutcome =
  | Readonly<{ kind: "applied"; orderId: OrderId | null; createdOrder: boolean; outcomes: ChatMessageOutcomes; noticeDue: boolean; trace: InterpretationTrace }>
  | Readonly<{ kind: "already_processed"; noticeDue: boolean }>
  | Readonly<{ kind: "skipped"; reason: "outgoing_message" | "empty_text" | "interpretation_disabled" }>;

export type PermanentChatMessageErrorCode = Exclude<ChatMessageFailureCode, "RETRIES_EXHAUSTED">;
export type RetryableChatMessageErrorCode = "PERSISTENCE_UNAVAILABLE" | "IMAGE_STORAGE_UNAVAILABLE" | "QR_READER_UNAVAILABLE" | "EMBEDDER_UNAVAILABLE"
  | "PRODUCT_MATCHER_UNAVAILABLE" | "AI_PROVIDER_UNAVAILABLE" | "DEADLINE_EXCEEDED";
export type ApplyChatMessageError = Readonly<{ code: PermanentChatMessageErrorCode | RetryableChatMessageErrorCode; message: string }>;

const retryableCodes: ReadonlySet<string> = new Set<RetryableChatMessageErrorCode>(["PERSISTENCE_UNAVAILABLE", "IMAGE_STORAGE_UNAVAILABLE", "QR_READER_UNAVAILABLE",
  "EMBEDDER_UNAVAILABLE", "PRODUCT_MATCHER_UNAVAILABLE", "AI_PROVIDER_UNAVAILABLE", "DEADLINE_EXCEEDED"]);
const permanentCodes: ReadonlySet<string> = new Set<PermanentChatMessageErrorCode>(["MESSAGE_NOT_FOUND", "CONTACT_NOT_FOUND", "SELLER_UNAVAILABLE", "CURRENCY_MISMATCH",
  "INVALID_ORDER", "INVALID_STORED_DATA", "INVALID_MATCHER_RESPONSE", "INVALID_EMBEDDING", "INVALID_AI_RESPONSE"]);

export const isRetryableChatMessageError = (error: ApplyChatMessageError) => retryableCodes.has(error.code);

type StageError = AiError | ToolResolveError | IdentifyProductsError | ImageReadError | PersistenceError | InvalidStoredData | ContactNotFound | SellerUnavailable | MessageAlreadyProcessed | OrderDomainError;

/** Narrow errors of the ports become the codes the handler decides on; a lost image is a lost message, and an unknown domain error is an invalid order. */
function toApplyError(error: Readonly<{ code: string; message: string }>): ApplyChatMessageError {
  if (error.code === "IMAGE_NOT_FOUND") return { code: "MESSAGE_NOT_FOUND", message: "The image of the message is not available" };
  if (retryableCodes.has(error.code) || permanentCodes.has(error.code)) return error as ApplyChatMessageError;
  return { code: "INVALID_ORDER", message: error.message };
}

export type ApplyChatMessageDependencies = Readonly<{
  findOutcome: (messageId: ChatMessageId) => Promise<Result<StoredChatMessageOutcome | null, PersistenceError | InvalidStoredData>>;
  findSourceMessage: (messageId: ChatMessageId) => Promise<Result<ChatSourceMessage | null, PersistenceError>>;
  findChatOrderContext: (chatId: ChatId) => Promise<Result<ChatOrderContext, PersistenceError>>;
  readImage: (imageId: ImageId, signal: AbortSignal) => Promise<Result<ImageBytes, ImageReadError>>;
  identifyProductsInImage: (image: ImageBytes, signal: AbortSignal) => Promise<Result<ImageIdentification, IdentifyProductsError>>;
  /** Active variants of the active products, grouped by product; a product without a sellable variant is absent. */
  loadSellableProducts: (productIds: readonly ProductId[]) => Promise<Result<readonly ProductWithSellableVariants[], PersistenceError>>;
  catalogSearchReadiness: () => Promise<Result<CatalogSearchReadiness, PersistenceError>>; // miss paths only
  /** False without a model provider: captions are ignored and texts are skipped. */
  interpretationEnabled: boolean;
  interpretAndApply: InterpretAndApply;
  transaction: <T, E extends Readonly<{ code: string; message: string }>>(companyId: CompanyId, work: () => Promise<Result<T, E>>) => Promise<Result<T, E | PersistenceError>>;
  lockContact: (contactId: ContactId) => Promise<Result<null, PersistenceError | ContactNotFound>>;
  ensureCustomerForContact: (contactId: ContactId) => Promise<Result<Readonly<{ customerId: CustomerId }>, PersistenceError | ContactNotFound>>;
  findChatOrderTargetForUpdate: (chatId: ChatId) => Promise<Result<ChatOrderTarget, PersistenceError | InvalidStoredData>>;
  allocateNumber: () => Promise<Result<OrderNumber, PersistenceError>>;
  saveNewOrder: (order: OrderAggregate, link: OrderChatSource) => Promise<Result<null, PersistenceError | SellerUnavailable>>;
  saveItemChanges: (order: OrderAggregate, changes: ChatOrderItemChanges) => Promise<Result<null, PersistenceError>>;
  recordOrderMessage: (orderId: OrderId, messageId: ChatMessageId) => Promise<Result<null, PersistenceError | MessageAlreadyProcessed>>;
  recordOutcome: (record: Readonly<{ messageId: ChatMessageId; outcomes: ChatMessageOutcomes }>) => Promise<Result<null, PersistenceError | InvalidStoredData | MessageAlreadyProcessed>>;
  newOrderId: () => OrderId;
  newItemId: () => OrderItemId;
  clock: () => Date;
  limits: ChatOrderLimits;
}>;

type Input = Readonly<{ companyId: CompanyId; messageId: ChatMessageId }>;
type Run = (actions: readonly ResolvedChatAction[]) => Promise<Result<AppliedChatMessage, PersistenceError | InvalidStoredData | ContactNotFound | SellerUnavailable | MessageAlreadyProcessed | OrderDomainError>>;
type Stage = Result<Interpreted<AppliedChatMessage>, StageError>;

/** Placeholder of `NewChatOrderSeed.number` when `needsNewChatOrder` says no order is created. */
const unusedNumber = 0 as OrderNumber;
const noTools: InterpretationTrace = { tools: [], extraction: false, decisionCalls: 0 };
const deadline = (): AiError => ({ code: "DEADLINE_EXCEEDED", message: "The attempt deadline passed" });

const noticeDueOf = (stored: StoredChatMessageOutcome) => isNoticeDue(stored.outcomes, stored.noticeSentAt);
const hasChanges = (changes: ChatOrderItemChanges) => changes.added.length + changes.updated.length + changes.removedItemIds.length > 0;

/** Reads one message of a chat, decides what it asks of the chat's order and applies it in one transaction. */
export async function applyChatMessage(input: Input, deps: ApplyChatMessageDependencies, signal: AbortSignal): Promise<Result<ApplyChatMessageOutcome, ApplyChatMessageError>> {
  const processed = await deps.findOutcome(input.messageId);
  if (!processed.success) return err(toApplyError(processed.error));
  if (processed.data) return ok({ kind: "already_processed", noticeDue: noticeDueOf(processed.data) });
  const found = await deps.findSourceMessage(input.messageId);
  if (!found.success) return err(toApplyError(found.error));
  const message = found.data;
  if (!message || message.companyId !== input.companyId) return err({ code: "MESSAGE_NOT_FOUND", message: "Message is not available" });
  if (message.direction === "outgoing") return ok({ kind: "skipped", reason: "outgoing_message" });
  if (!message.imageId && !hasReadableText(message.text)) return ok({ kind: "skipped", reason: "empty_text" });
  if (!message.imageId && !deps.interpretationEnabled) return ok({ kind: "skipped", reason: "interpretation_disabled" });
  const order = await deps.findChatOrderContext(message.chatId);
  if (!order.success) return err(toApplyError(order.error));
  const run: Run = (actions) => deps.transaction(input.companyId, () => applyInTransaction(message, actions, deps));
  const staged = message.imageId ? await applyPhoto(message, message.imageId, order.data, run, deps, signal) : await applyText(message, order.data, run, deps, signal);
  if (!staged.success) return staged.error.code === "MESSAGE_ALREADY_PROCESSED" ? rereadProcessed(input.messageId, deps) : err(toApplyError(staged.error));
  const { applied, trace } = staged.data;
  return ok({ kind: "applied", orderId: applied.orderId, createdOrder: applied.createdOrder, outcomes: applied.outcomes, noticeDue: chooseSellerNotice(applied.outcomes) !== null, trace });
}

/** The transaction rolled back because another run recorded the message first. */
async function rereadProcessed(messageId: ChatMessageId, deps: ApplyChatMessageDependencies): Promise<Result<ApplyChatMessageOutcome, ApplyChatMessageError>> {
  const winner = await deps.findOutcome(messageId);
  if (!winner.success) return err(toApplyError(winner.error));
  return winner.data ? ok({ kind: "already_processed", noticeDue: noticeDueOf(winner.data) })
    : err({ code: "PERSISTENCE_UNAVAILABLE", message: "Processed message is not visible" });
}

const itemLine = (item: ChatContextItem) => `${item.label}: ${item.productName}${variantText(item.variantAttributes)}, quantity ${item.quantity}, unit price ${item.unitPrice.amount} ${item.unitPrice.currency}`;
const variantText = (attributes: Readonly<Record<string, string>>) => Object.keys(attributes).length ? ` (${Object.entries(attributes).map(([name, value]) => `${name}: ${value}`).join(", ")})` : "";

/** The only context the models get besides the message: the open order and, for a photo, the product it shows as text. */
function contextTextOf(items: readonly ChatContextItem[], shown: readonly ShownProduct[]): string {
  const order = items.length ? items.map(itemLine).join("\n") : "The chat has no open order.";
  const photo = shown.map(({ product }) => `The photo shows ${product.name}. Variants: ${product.variants.map((variant) => Object.values(variant.variantAttributes).join(" ") || "single variant").join("; ")}.`);
  return ["Open order items:", order, ...photo].join("\n");
}

function applyText(message: ChatSourceMessage, order: ChatOrderContext, run: Run, deps: ApplyChatMessageDependencies, signal: AbortSignal): Promise<Stage> {
  const context: ChatToolContext = { kind: "text", caption: null, items: order.items, shown: [] };
  return deps.interpretAndApply({ context, messageText: message.text, contextText: contextTextOf(order.items, []), plan: { kind: "decide", fallbackTool: null } }, signal, run);
}

async function reportOnly(outcome: ReportOutcome, run: Run): Promise<Stage> {
  const applied = await run([{ kind: "report", outcome }]);
  return applied.success ? ok({ applied: applied.data, trace: noTools }) : applied;
}

type IdentifiedProduct = Readonly<{ productId: ProductId; preselectedVariantId: ShownProduct["preselectedVariantId"]; identification: ShownProduct["identification"] }>;

/** The products a photo shows, or why it shows none. */
function productsOf(identified: ImageIdentification): readonly IdentifiedProduct[] | "not_product" | "not_found" {
  if (identified.kind === "not_product") return "not_product";
  if (identified.kind === "not_found") return "not_found";
  if (identified.method === "visual") {
    return [{ productId: identified.productId, preselectedVariantId: null, identification: { method: "visual", productId: identified.productId, confidence: identified.confidence } }];
  }
  return identified.items.map((item) => ({ productId: item.productId, preselectedVariantId: item.variantId,
    identification: { method: "qr", productId: item.productId, confidence: null } }));
}

async function applyPhoto(message: ChatSourceMessage, imageId: ImageId, order: ChatOrderContext, run: Run, deps: ApplyChatMessageDependencies, signal: AbortSignal): Promise<Stage> {
  const image = await deps.readImage(imageId, signal);
  if (!image.success) return image;
  const identified = await deps.identifyProductsInImage(image.data, signal);
  if (!identified.success) return identified;
  if (signal.aborted) return err(deadline());
  const caption = hasReadableText(message.caption) ? message.caption : null;
  const products = productsOf(identified.data);
  if (products === "not_product") return caption && deps.interpretationEnabled ? interpretCaption("photo_not_product", caption, order, [], run, deps, signal) : reportOnly({ kind: "no_intent" }, run);
  if (products === "not_found") return reportMiss(run, deps);
  const loaded = await deps.loadSellableProducts([...new Set(products.map(({ productId }) => productId))]);
  if (!loaded.success) return loaded;
  const byId = new Map(loaded.data.map((product) => [product.productId, product]));
  const shown = products.flatMap((entry): ShownProduct[] => { const product = byId.get(entry.productId); return product ? [{ product, ...entry }] : []; });
  // A product that left the catalog since it was matched is a miss that still names its identification.
  const missing = products.filter(({ productId }) => !byId.has(productId))
    .map((entry): ResolvedChatAction => ({ kind: "report", outcome: { kind: "not_identified", source: "photo", identification: entry.identification, silent: false } }));
  if (!shown.length) return reportActions(missing, run);
  const withMissing: Run = (actions) => run([...missing, ...actions]);
  if (!caption || !deps.interpretationEnabled) return interpretShown(shown, order, withMissing, deps, signal, { kind: "tool", tool: "add_shown_product" }, null);
  return interpretCaption("photo_product", caption, order, shown, withMissing, deps, signal);
}

async function reportActions(actions: readonly ResolvedChatAction[], run: Run): Promise<Stage> {
  const applied = await run(actions);
  return applied.success ? ok({ applied: applied.data, trace: noTools }) : applied;
}

/** A photo that matched nothing is a miss; it stays silent while the catalog cannot recognize photos at all. */
async function reportMiss(run: Run, deps: ApplyChatMessageDependencies): Promise<Stage> {
  const readiness = await deps.catalogSearchReadiness();
  if (!readiness.success) return readiness;
  return reportOnly({ kind: "not_identified", source: "photo", identification: null, silent: readiness.data !== "ready" }, run);
}

function interpretCaption(kind: "photo_product" | "photo_not_product", caption: string, order: ChatOrderContext, shown: readonly ShownProduct[], run: Run, deps: ApplyChatMessageDependencies, signal: AbortSignal): Promise<Stage> {
  // A caption the models cannot place adds the product the buyer showed, as a photo without caption does.
  return interpretShown(shown, order, run, deps, signal, { kind: "decide", fallbackTool: kind === "photo_product" ? "add_shown_product" : null }, caption, kind);
}

function interpretShown(shown: readonly ShownProduct[], order: ChatOrderContext, run: Run, deps: ApplyChatMessageDependencies, signal: AbortSignal,
  plan: Parameters<ApplyChatMessageDependencies["interpretAndApply"]>[0]["plan"], caption: string | null, kind: "photo_product" | "photo_not_product" = "photo_product"): Promise<Stage> {
  const context: ChatToolContext = { kind, caption, items: order.items, shown };
  return deps.interpretAndApply({ context, messageText: caption, contextText: contextTextOf(order.items, shown), plan }, signal, run);
}

async function applyInTransaction(message: ChatSourceMessage, actions: readonly ResolvedChatAction[], deps: ApplyChatMessageDependencies): Promise<Result<AppliedChatMessage, PersistenceError | InvalidStoredData | ContactNotFound | SellerUnavailable | MessageAlreadyProcessed | OrderDomainError>> {
  const locked = await deps.lockContact(message.contactId);
  if (!locked.success) return locked;
  const again = await deps.findOutcome(message.id);
  if (!again.success) return again;
  if (again.data) return err({ code: "MESSAGE_ALREADY_PROCESSED", message: "Message already processed" });
  const target = await deps.findChatOrderTargetForUpdate(message.chatId);
  if (!target.success) return target;
  const customer = needsNewChatOrder(target.data, actions, deps.limits) ? await deps.ensureCustomerForContact(message.contactId) : null;
  if (customer && !customer.success) return customer;
  const number = customer ? await deps.allocateNumber() : ok(unusedNumber);
  if (!number.success) return number;
  const applied = applyChatActions(target.data, actions, { newOrderId: deps.newOrderId, newItemId: deps.newItemId }, deps.clock(), deps.limits,
    { number: number.data, companyId: message.companyId, sellerId: message.uploadedByUserId, chatId: message.chatId, contactId: message.contactId });
  if (!applied.success) return applied;
  const { createdOrder, changes, outcomes } = applied.data;
  const changedOrder = target.data.kind === "open" && hasChanges(changes) && applied.data.target.kind === "open" ? applied.data.target.order : null;
  if (createdOrder && customer?.success) {
    const saved = await deps.saveNewOrder(createdOrder, { chatId: message.chatId, customerId: customer.data.customerId });
    if (!saved.success) return saved;
  } else if (changedOrder) {
    const saved = await deps.saveItemChanges(changedOrder, changes);
    if (!saved.success) return saved;
  }
  const orderId = createdOrder?.id ?? changedOrder?.id ?? null;
  if (orderId) {
    const recorded = await deps.recordOrderMessage(orderId, message.id);
    if (!recorded.success) return recorded;
  }
  const recorded = await deps.recordOutcome({ messageId: message.id, outcomes });
  if (!recorded.success) return recorded;
  return ok({ orderId, createdOrder: createdOrder !== null, outcomes });
}
