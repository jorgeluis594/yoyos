import { isDeepStrictEqual } from "node:util";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { applyChatActions, needsNewChatOrder, type ChatOrderTarget, type ChatOrderLimits, type ReportOutcome, type ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import type { OrderItemChanges } from "@core/src/features/orders/domain/order-edit";
import { pendingLife, type ChatPendingId, type ChatPendings } from "@core/src/features/orders/domain/chat-pendings";
import { nextLastIncomingPhoto, photoJustSentOf } from "@core/src/features/orders/domain/photo-just-sent";
import { checkReaderAnswer, fixedShownAnswer, type ChatReadingContext, type ReaderAnswer } from "@core/src/features/orders/domain/chat-reading";
import type { ChatMessageFailureCode, ChatMessageOutcome, ChatMessageOutcomes, StoredChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import { chooseSellerNotice, isNoticeDue } from "@core/src/features/orders/domain/seller-notice";
import type { ChatId, OrderChatSource } from "@core/src/features/orders/domain/message-order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { OrderAggregate, OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import type { CompanyId, ContactId, OrderId, OrderItemId, UserId } from "@core/src/features/orders/domain/order";
import type { ContextTooLarge, FittedReadingContext, ReadChatMessage, ReaderError, ReaderUsage } from "@core/src/features/orders/application/read-chat-message";
import { buildReadingContext, listedItems, selectReadingProducts, type ShownProduct } from "@core/src/features/orders/application/reading-context";
import type { IdentifyProductsError, ImageIdentification } from "@core/src/features/products/application/identify-products-in-image";
import type { ImageBytes } from "@core/src/features/products/domain/image-identification";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";
import type { CatalogSearchReadiness } from "@core/src/features/products/domain/text-identification";
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
  imageId: ImageId | null; // null for text messages
  text: string | null;
  caption: string | null;
}>;

export type AppliedChatMessage = Readonly<{ orderId: OrderId | null; createdOrder: boolean; outcomes: ChatMessageOutcomes; pendingsBefore: number; pendingsAfter: number }>;

/** What one reading did, for the handler's log. */
export type ReadingTrace = Readonly<{
  readerCalls: 0 | 1;
  answer: "actions" | "no_intent" | "doubt" | "fixed";
  actionKinds: readonly string[];
  usage: ReaderUsage | null;
  contextTruncated: boolean;
  /** The message was read with a photo just sent marker. */
  photoJustSent: boolean;
  /** The o200k count of the fitted request; null when no reader call was fitted. */
  countedInputTokens: number | null;
  /** Products the input-token budget cut from the context. */
  droppedForBudget: number;
  candidateMs: number | null;
  candidateMatchCount: number | null;
  candidatesTimedOut: boolean;
}>;

export type ApplyChatMessageOutcome =
  | Readonly<{ kind: "applied"; orderId: OrderId | null; createdOrder: boolean; outcomes: ChatMessageOutcomes; noticeDue: boolean; pendingsBefore: number; pendingsAfter: number; trace: ReadingTrace }>
  | Readonly<{ kind: "already_processed"; noticeDue: boolean }>
  | Readonly<{ kind: "skipped"; reason: "outgoing_message" | "empty_text" | "reader_disabled" }>;

export type PermanentChatMessageErrorCode = Exclude<ChatMessageFailureCode, "RETRIES_EXHAUSTED">;
export type RetryableChatMessageErrorCode = "PERSISTENCE_UNAVAILABLE" | "IMAGE_STORAGE_UNAVAILABLE" | "QR_READER_UNAVAILABLE" | "EMBEDDER_UNAVAILABLE"
  | "PRODUCT_MATCHER_UNAVAILABLE" | "AI_PROVIDER_UNAVAILABLE" | "DEADLINE_EXCEEDED";
export type ApplyChatMessageError = Readonly<{ code: PermanentChatMessageErrorCode | RetryableChatMessageErrorCode; message: string }>;

const retryableCodes: ReadonlySet<string> = new Set<RetryableChatMessageErrorCode>(["PERSISTENCE_UNAVAILABLE", "IMAGE_STORAGE_UNAVAILABLE", "QR_READER_UNAVAILABLE",
  "EMBEDDER_UNAVAILABLE", "PRODUCT_MATCHER_UNAVAILABLE", "AI_PROVIDER_UNAVAILABLE", "DEADLINE_EXCEEDED"]);
const permanentCodes: ReadonlySet<string> = new Set<PermanentChatMessageErrorCode>(["MESSAGE_NOT_FOUND", "CONTACT_NOT_FOUND", "SELLER_UNAVAILABLE", "CURRENCY_MISMATCH",
  "INVALID_ORDER", "INVALID_STORED_DATA", "INVALID_MATCHER_RESPONSE", "INVALID_EMBEDDING", "INVALID_AI_RESPONSE"]);

export const isRetryableChatMessageError = (error: ApplyChatMessageError) => retryableCodes.has(error.code);

type StageError = ReaderError | IdentifyProductsError | ImageReadError | PersistenceError | InvalidStoredData | ContactNotFound | SellerUnavailable | MessageAlreadyProcessed | OrderDomainError;

/** Narrow errors of the ports become the codes the handler decides on; a lost image is a lost message, and an unknown domain error is an invalid order. */
function toApplyError(error: Readonly<{ code: string; message: string }>): ApplyChatMessageError {
  if (error.code === "IMAGE_NOT_FOUND") return { code: "MESSAGE_NOT_FOUND", message: "The image of the message is not available" };
  if (retryableCodes.has(error.code) || permanentCodes.has(error.code)) return error as ApplyChatMessageError;
  return { code: "INVALID_ORDER", message: error.message };
}

export type ChatMessageLimits = ChatOrderLimits & Readonly<{
  /** Pendings without an order expire this long after their last change. */
  pendingTtlMs: number;
  maxReaderProducts: number;
  maxReaderItems: number;
  maxReaderTextChars: number;
}>;

export type ApplyChatMessageDependencies = Readonly<{
  findOutcome: (messageId: ChatMessageId) => Promise<Result<StoredChatMessageOutcome | null, PersistenceError | InvalidStoredData>>;
  findSourceMessage: (messageId: ChatMessageId) => Promise<Result<ChatSourceMessage | null, PersistenceError>>;
  /** Same shape as findChatOrderTargetForUpdate, without locks: the context the reader sees. */
  findChatOrderTarget: (chatId: ChatId) => Promise<Result<ChatOrderTarget, PersistenceError | InvalidStoredData>>;
  /** Aggregates of the chat's orders that may have opened for messages after `since`; read only when an orderless pending exists. */
  findChatOrdersOpenedSince: (chatId: ChatId, since: Date) => Promise<Result<readonly OrderAggregate[], PersistenceError | InvalidStoredData>>;
  findChatPendings: (chatId: ChatId) => Promise<Result<ChatPendings, PersistenceError | InvalidStoredData>>;
  findChatPendingsForUpdate: (chatId: ChatId) => Promise<Result<ChatPendings, PersistenceError | InvalidStoredData>>;
  saveChatPendings: (chatId: ChatId, pendings: ChatPendings) => Promise<Result<null, PersistenceError | InvalidStoredData>>;
  readImage: (imageId: ImageId, signal: AbortSignal) => Promise<Result<ImageBytes, ImageReadError>>;
  identifyProductsInImage: (image: ImageBytes, signal: AbortSignal) => Promise<Result<ImageIdentification, IdentifyProductsError>>;
  findProductsForReading: (productIds: readonly ProductId[]) => Promise<Result<readonly ProductForReading[], PersistenceError | InvalidStoredData>>;
  /** A statement timeout is not an error: it returns no ids with timedOut true. */
  findMessageCandidates: (text: string) => Promise<Result<Readonly<{ productIds: readonly ProductId[]; unavailableProductIds: readonly ProductId[]; matchCount: number; durationMs: number; timedOut: boolean }>, PersistenceError>>;
  /** Reader infrastructure: the context whose whole request fits the input-token budget of its kind (a photo's is smaller by the photo stages' reserve), keeping products in priority order. */
  fitReadingContext: (context: ChatReadingContext) => Result<FittedReadingContext, ContextTooLarge>;
  /** The whole photo stage (image read, QR, description, candidate reads, chooser) ends at this deadline: `2 × PRODUCT_MATCH_TIMEOUT_MS`. */
  photoStageTimeoutMs: number;
  catalogSearchReadiness: () => Promise<Result<CatalogSearchReadiness, PersistenceError>>; // miss paths only
  /** Null without a model provider: captions are ignored and texts are skipped. */
  readChatMessage: ReadChatMessage | null;
  transaction: <T, E extends Readonly<{ code: string; message: string }>>(companyId: CompanyId, work: () => Promise<Result<T, E>>) => Promise<Result<T, E | PersistenceError>>;
  lockContact: (contactId: ContactId) => Promise<Result<null, PersistenceError | ContactNotFound>>;
  ensureCustomerForContact: (contactId: ContactId) => Promise<Result<Readonly<{ customerId: CustomerId }>, PersistenceError | ContactNotFound>>;
  findChatOrderTargetForUpdate: (chatId: ChatId) => Promise<Result<ChatOrderTarget, PersistenceError | InvalidStoredData>>;
  allocateNumber: () => Promise<Result<OrderNumber, PersistenceError>>;
  saveNewOrder: (order: OrderAggregate, link: OrderChatSource) => Promise<Result<null, PersistenceError | SellerUnavailable>>;
  saveItemChanges: (order: OrderAggregate, changes: OrderItemChanges) => Promise<Result<null, PersistenceError>>;
  recordOrderMessage: (orderId: OrderId, messageId: ChatMessageId) => Promise<Result<null, PersistenceError | MessageAlreadyProcessed>>;
  recordOutcome: (record: Readonly<{ messageId: ChatMessageId; outcomes: ChatMessageOutcomes }>) => Promise<Result<null, PersistenceError | InvalidStoredData | MessageAlreadyProcessed>>;
  newOrderId: () => OrderId;
  newItemId: () => OrderItemId;
  newPendingId: () => ChatPendingId;
  clock: () => Date;
  limits: ChatMessageLimits;
}>;

type Input = Readonly<{ companyId: CompanyId; messageId: ChatMessageId }>;
type RunError = PersistenceError | InvalidStoredData | ContactNotFound | SellerUnavailable | MessageAlreadyProcessed | OrderDomainError;
/** Runs the actions in the message transaction; `shownProductIds` are the products a photo showed (none for a text). */
type Run = (actions: readonly ResolvedChatAction[], shownProductIds?: readonly ProductId[]) => Promise<Result<AppliedChatMessage, RunError>>;
type Staged = Readonly<{ applied: AppliedChatMessage; trace: ReadingTrace }>;
type Stage = Result<Staged, StageError>;

/** Placeholder of `NewChatOrderSeed.number` when `needsNewChatOrder` says no order is created. */
const unusedNumber = 0 as OrderNumber;
const noReading: ReadingTrace = { readerCalls: 0, answer: "no_intent", actionKinds: [], usage: null, contextTruncated: false, photoJustSent: false, countedInputTokens: null, droppedForBudget: 0, candidateMs: null, candidateMatchCount: null, candidatesTimedOut: false };
const fixedReading: ReadingTrace = { ...noReading, answer: "fixed" };

const noticeDueOf = (stored: StoredChatMessageOutcome) => isNoticeDue(stored.outcomes, stored.noticeSentAt);
const hasChanges = (changes: OrderItemChanges) => changes.added.length + changes.updated.length + changes.removedItemIds.length > 0;
/** A text or caption the reader can read: it has at least one letter or digit. Emoji and punctuation only are not a message. */
export const hasReadableText = (text: string | null): text is string => text !== null && /[\p{L}\p{N}]/u.test(text);

/** Reads one message of a chat, decides what it asks of the chat's order and pendings and applies it in one transaction. */
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
  if (!message.imageId && !deps.readChatMessage) return ok({ kind: "skipped", reason: "reader_disabled" });
  const state = await loadChatState(message.chatId, deps);
  if (!state.success) return err(toApplyError(state.error));
  const run: Run = (actions, shownProductIds = []) => deps.transaction(input.companyId, () => applyInTransaction(message, actions, shownProductIds, deps));
  const staged = message.imageId ? await applyPhoto(message, message.imageId, state.data, run, deps, signal) : await applyText(message, state.data, run, deps, signal);
  if (!staged.success) return staged.error.code === "MESSAGE_ALREADY_PROCESSED" ? rereadProcessed(input.messageId, deps) : err(toApplyError(staged.error));
  const { applied, trace } = staged.data;
  return ok({ kind: "applied", orderId: applied.orderId, createdOrder: applied.createdOrder, outcomes: applied.outcomes, noticeDue: chooseSellerNotice(applied.outcomes) !== null,
    pendingsBefore: applied.pendingsBefore, pendingsAfter: applied.pendingsAfter, trace });
}

/** The transaction rolled back because another run recorded the message first. */
async function rereadProcessed(messageId: ChatMessageId, deps: ApplyChatMessageDependencies): Promise<Result<ApplyChatMessageOutcome, ApplyChatMessageError>> {
  const winner = await deps.findOutcome(messageId);
  if (!winner.success) return err(toApplyError(winner.error));
  return winner.data ? ok({ kind: "already_processed", noticeDue: noticeDueOf(winner.data) })
    : err({ code: "PERSISTENCE_UNAVAILABLE", message: "Processed message is not visible" });
}

/** The chat's order and its alive pendings as the reader sees them: unlocked, and the transaction decides again under lock. */
type ChatState = Readonly<{ target: ChatOrderTarget; pendings: ChatPendings }>;

/** The chat orders that may have opened after the oldest orderless pending changed; read only when such a pending exists. */
async function readOpenedSince(set: ChatPendings, chatId: ChatId, deps: ApplyChatMessageDependencies): Promise<Result<readonly OrderAggregate[], PersistenceError | InvalidStoredData>> {
  const orderless = set.pendings.filter((pending) => !pending.order);
  if (!orderless.length) return ok([]);
  return deps.findChatOrdersOpenedSince(chatId, new Date(Math.min(...orderless.map((pending) => pending.lastChangedAt.getTime()))));
}

async function loadChatState(chatId: ChatId, deps: ApplyChatMessageDependencies): Promise<Result<ChatState, PersistenceError | InvalidStoredData>> {
  const target = await deps.findChatOrderTarget(chatId);
  if (!target.success) return target;
  const stored = await deps.findChatPendings(chatId);
  if (!stored.success) return stored;
  const openedSince = await readOpenedSince(stored.data, chatId, deps);
  if (!openedSince.success) return openedSince;
  const life = pendingLife(stored.data, { target: target.data, openedSince: openedSince.data }, deps.clock(), deps.limits.pendingTtlMs);
  return ok({ target: target.data, pendings: { ...stored.data, pendings: life.alive } });
}

type IdentifiedProduct = ShownProduct;

/** The products a photo shows, or why it shows none. A product shown by several QR labels counts once, with its first label. */
function productsOf(identified: ImageIdentification): readonly IdentifiedProduct[] | "not_product" | "not_found" {
  if (identified.kind === "not_product") return "not_product";
  if (identified.kind === "not_found") return "not_found";
  if (identified.method === "visual") {
    return [{ productId: identified.productId, preselectedVariantId: null, identification: { method: "visual", productId: identified.productId, confidence: identified.confidence } }];
  }
  const labels = identified.items.map((item): IdentifiedProduct => ({ productId: item.productId, preselectedVariantId: item.variantId,
    identification: { method: "qr", productId: item.productId, confidence: null } }));
  return labels.filter((label, index) => labels.findIndex(({ productId }) => productId === label.productId) === index);
}

type ReadingInputs = Readonly<{ kind: ChatReadingContext["kind"]; text: string | null; shown: readonly ShownProduct[] }>;
type CandidateTrace = Pick<ReadingTrace, "candidateMs" | "candidateMatchCount" | "candidatesTimedOut">;

/** The context of one reading: the products wanted by the message, its pendings and its order, within the ceilings. */
async function readingContextOf(inputs: ReadingInputs, state: ChatState, deps: ApplyChatMessageDependencies): Promise<Result<Readonly<{ context: ChatReadingContext; candidates: CandidateTrace }>, PersistenceError | InvalidStoredData>> {
  const candidates = inputs.kind === "text" && inputs.text !== null ? await deps.findMessageCandidates(inputs.text) : null;
  if (candidates && !candidates.success) return candidates;
  const { limits } = deps;
  const selection = selectReadingProducts({ shown: inputs.shown, pendings: state.pendings.pendings,
    itemProductIds: listedItems(state.target, limits.maxReaderItems).flatMap(({ productId }) => (productId ? [productId] : [])),
    candidateIds: candidates?.data.productIds ?? [], unavailableIds: candidates?.data.unavailableProductIds ?? [], maxProducts: limits.maxReaderProducts });
  const loaded = selection.productIds.length ? await deps.findProductsForReading(selection.productIds) : ok<readonly ProductForReading[]>([]);
  if (!loaded.success) return loaded;
  const timedOut = candidates?.data.timedOut ?? false;
  const context = buildReadingContext({ kind: inputs.kind, text: inputs.text, target: state.target, pendings: state.pendings.pendings, shown: inputs.shown,
    productIds: selection.productIds, found: loaded.data, truncated: selection.truncated || timedOut, maxItems: limits.maxReaderItems,
    photoJustSent: photoJustSentOf(inputs.kind === "text" ? "text" : "photo", state.pendings.lastIncomingPhoto, state.target, state.pendings.pendings) });
  return ok({ context, candidates: { candidateMs: candidates?.data.durationMs ?? null, candidateMatchCount: candidates?.data.matchCount ?? null, candidatesTimedOut: timedOut } });
}

const actionKindsOf = (answer: ReaderAnswer) => (answer.kind === "actions" ? answer.actions.map(({ kind }) => kind) : []);

/** What the message asks, resolved against the context the reader saw. */
type Answered = Readonly<{ actions: readonly ResolvedChatAction[]; trace: ReadingTrace }>;

const contextTooLarge = (): ResolvedChatAction => ({ kind: "report", outcome: { kind: "invalid_action", orderId: null, reason: "context_too_large" } });

/** One reader call, or the photo's fixed answer when there is nothing to read; the check reads the same fitted context the reader saw. */
async function answerFor(context: ChatReadingContext, deps: ApplyChatMessageDependencies, meta: Readonly<{ companyId: CompanyId; messageId: ChatMessageId }>, signal: AbortSignal,
  candidates: CandidateTrace): Promise<Result<Answered, ReaderError>> {
  const base = { contextTruncated: context.truncated, photoJustSent: context.photoJustSent !== null, ...candidates };
  const caption = context.text;
  const reader = deps.readChatMessage;
  const tooLong = caption !== null && caption.length > deps.limits.maxReaderTextChars;
  const fixed = (captionDoubt: boolean, fitted: ChatReadingContext = context): Answered =>
    ({ actions: checkReaderAnswer(fixedShownAnswer(fitted), fitted, { captionDoubt }), trace: { ...fixedReading, ...base } });
  if (context.kind === "photo_product" && (caption === null || !reader || tooLong)) return ok(fixed(tooLong && reader !== null));
  if (!reader || caption === null || tooLong) return ok({ actions: checkReaderAnswer({ kind: "no_intent" }, context, { captionDoubt: false }), trace: { ...noReading, ...base } });
  if (signal.aborted) return err({ code: "DEADLINE_EXCEEDED", message: "The attempt deadline passed" });
  const fitted = deps.fitReadingContext(context);
  if (!fitted.success) {
    // The caption of a product photo that does not fit is doubted like a too-long one; anything else is an invalid action.
    if (context.kind === "photo_product") return ok(fixed(true));
    return ok({ actions: [contextTooLarge()], trace: { ...noReading, ...base } });
  }
  const reading = await reader(fitted.data.context, meta, signal);
  if (!reading.success) return reading;
  const { answer, usage } = reading.data;
  return ok({ actions: checkReaderAnswer(answer, fitted.data.context, { captionDoubt: false }), trace: { readerCalls: 1, answer: answer.kind, actionKinds: actionKindsOf(answer), usage,
    ...base, contextTruncated: fitted.data.context.truncated, countedInputTokens: fitted.data.countedInputTokens, droppedForBudget: fitted.data.droppedProducts } });
}

const textTooLong = (): ResolvedChatAction => ({ kind: "report", outcome: { kind: "invalid_action", orderId: null, reason: "text_too_long" } });

async function applyText(message: ChatSourceMessage, state: ChatState, run: Run, deps: ApplyChatMessageDependencies, signal: AbortSignal): Promise<Stage> {
  const text = message.text ?? "";
  if (text.length > deps.limits.maxReaderTextChars) return reportActions([textTooLong()], run, noReading);
  const read = await readingContextOf({ kind: "text", text, shown: [] }, state, deps);
  if (!read.success) return read;
  const answered = await answerFor(read.data.context, deps, { companyId: message.companyId, messageId: message.id }, signal, read.data.candidates);
  if (!answered.success) return answered;
  const silenced = await silenceTextMisses(answered.data.actions, deps);
  if (!silenced.success) return silenced;
  return reportActions(silenced.data, run, answered.data.trace);
}

const isTextMiss = (action: ResolvedChatAction) => action.kind === "report" && (action.outcome.kind === "not_identified" || action.outcome.kind === "not_clear");

/** A company without active products cannot match any text, so its misses stay silent. The readiness is read only when a text missed. */
async function silenceTextMisses(actions: readonly ResolvedChatAction[], deps: ApplyChatMessageDependencies): Promise<Result<readonly ResolvedChatAction[], PersistenceError>> {
  if (!actions.some(isTextMiss)) return ok(actions);
  const readiness = await deps.catalogSearchReadiness();
  if (!readiness.success) return readiness;
  if (readiness.data !== "no_active_products") return ok(actions);
  return ok(actions.map((action) => action.kind === "report" && (action.outcome.kind === "not_identified" || action.outcome.kind === "not_clear")
    ? { ...action, outcome: { ...action.outcome, silent: true } } : action));
}

async function reportActions(actions: readonly ResolvedChatAction[], run: Run, trace: ReadingTrace, shownProductIds: readonly ProductId[] = []): Promise<Stage> {
  const applied = await run(actions, shownProductIds);
  return applied.success ? ok({ applied: applied.data, trace }) : applied;
}

async function reportOnly(outcome: ReportOutcome, run: Run, shownProductIds: readonly ProductId[] = []): Promise<Stage> {
  return reportActions([{ kind: "report", outcome }], run, noReading, shownProductIds);
}

/** A stage cut by its own deadline reports the deadline, not the provider or storage failure the abort looks like. */
const deadlineOr = <T extends Readonly<{ code: string; message: string }>>(error: T, stageSignal: AbortSignal): T | ReaderError =>
  stageSignal.aborted && retryableCodes.has(error.code) ? { code: "DEADLINE_EXCEEDED", message: "The photo stage deadline passed" } : error;

async function applyPhoto(message: ChatSourceMessage, imageId: ImageId, state: ChatState, run: Run, deps: ApplyChatMessageDependencies, signal: AbortSignal): Promise<Stage> {
  const stageSignal = AbortSignal.any([signal, AbortSignal.timeout(deps.photoStageTimeoutMs)]);
  const image = await deps.readImage(imageId, stageSignal);
  if (!image.success) return err(deadlineOr(image.error, stageSignal));
  const identified = await deps.identifyProductsInImage(image.data, stageSignal);
  if (!identified.success) return err(deadlineOr(identified.error, stageSignal));
  if (signal.aborted) return err({ code: "DEADLINE_EXCEEDED", message: "The attempt deadline passed" });
  const caption = hasReadableText(message.caption) && deps.readChatMessage ? message.caption : null;
  const products = productsOf(identified.data);
  if (products === "not_found") return reportMiss(run, deps);
  if (products === "not_product" && !caption) return reportOnly({ kind: "no_intent" }, run);
  const shown = products === "not_product" ? [] : products;
  const shownProductIds = shown.map(({ productId }) => productId);
  const read = await readingContextOf({ kind: products === "not_product" ? "photo_not_product" : "photo_product", text: caption, shown }, state, deps);
  if (!read.success) return read;
  const { context } = read.data;
  // A product that left the catalog since it was matched is a miss that still names its identification.
  const present = new Set(context.products.map(({ productId }) => productId));
  const missing = shown.filter(({ productId }) => !present.has(productId))
    .map((entry): ResolvedChatAction => ({ kind: "report", outcome: { kind: "not_identified", source: "photo", identification: entry.identification, silent: false } }));
  if (shown.length && missing.length === shown.length) return reportActions(missing, run, noReading, shownProductIds);
  const answered = await answerFor(context, deps, { companyId: message.companyId, messageId: message.id }, signal, read.data.candidates);
  if (!answered.success) return answered;
  return reportActions([...missing, ...answered.data.actions], run, answered.data.trace, shownProductIds);
}

/** A photo that matched nothing is a miss; it stays silent while the catalog cannot recognize photos at all. */
async function reportMiss(run: Run, deps: ApplyChatMessageDependencies): Promise<Stage> {
  const readiness = await deps.catalogSearchReadiness();
  if (!readiness.success) return readiness;
  return reportOnly({ kind: "not_identified", source: "photo", identification: null, silent: readiness.data !== "ready" }, run);
}

async function applyInTransaction(message: ChatSourceMessage, actions: readonly ResolvedChatAction[], shownProductIds: readonly ProductId[], deps: ApplyChatMessageDependencies): Promise<Result<AppliedChatMessage, RunError>> {
  const locked = await deps.lockContact(message.contactId);
  if (!locked.success) return locked;
  const again = await deps.findOutcome(message.id);
  if (!again.success) return again;
  if (again.data) return err({ code: "MESSAGE_ALREADY_PROCESSED", message: "Message already processed" });
  const target = await deps.findChatOrderTargetForUpdate(message.chatId);
  if (!target.success) return target;
  const stored = await deps.findChatPendingsForUpdate(message.chatId);
  if (!stored.success) return stored;
  const openedSince = await readOpenedSince(stored.data, message.chatId, deps);
  if (!openedSince.success) return openedSince;
  const now = deps.clock();
  const life = pendingLife(stored.data, { target: target.data, openedSince: openedSince.data }, now, deps.limits.pendingTtlMs);
  const alive: ChatPendings = { ...stored.data, pendings: life.alive };
  const customer = needsNewChatOrder(target.data, alive, actions, deps.limits) ? await deps.ensureCustomerForContact(message.contactId) : null;
  if (customer && !customer.success) return customer;
  const number = customer ? await deps.allocateNumber() : ok(unusedNumber);
  if (!number.success) return number;
  const applied = applyChatActions(target.data, alive, actions, { newOrderId: deps.newOrderId, newItemId: deps.newItemId, newPendingId: deps.newPendingId }, now, deps.limits,
    { number: number.data, companyId: message.companyId, sellerId: message.uploadedByUserId, chatId: message.chatId, contactId: message.contactId, messageId: message.id });
  if (!applied.success) return applied;
  const { createdOrder, changes } = applied.data;
  // Pendings that ended with their order or by age are recorded first, silently.
  const ended = life.ended.map(({ id, reason }): ChatMessageOutcome => ({ kind: "pending_ended", pendingId: id, reason }));
  const [first, ...rest] = [...ended, ...applied.data.outcomes];
  const outcomes: ChatMessageOutcomes = [first!, ...rest];
  const changedOrder = target.data.kind === "open" && hasChanges(changes) && applied.data.target.kind === "open" ? applied.data.target.order : null;
  if (createdOrder && customer?.success) {
    const saved = await deps.saveNewOrder(createdOrder, { chatId: message.chatId, customerId: customer.data.customerId });
    if (!saved.success) return saved;
  } else if (changedOrder) {
    const saved = await deps.saveItemChanges(changedOrder, changes);
    if (!saved.success) return saved;
  }
  // A photo stores what it left; a read text clears it.
  const lastIncomingPhoto = nextLastIncomingPhoto({ kind: message.imageId ? "photo" : "text", previous: stored.data.lastIncomingPhoto, shownProductIds, applied: applied.data });
  const nextPendings: ChatPendings = { ...applied.data.pendings, lastIncomingPhoto };
  if (!isDeepStrictEqual(nextPendings, stored.data)) {
    const savedPendings = await deps.saveChatPendings(message.chatId, nextPendings);
    if (!savedPendings.success) return savedPendings;
  }
  const orderId = createdOrder?.id ?? changedOrder?.id ?? null;
  if (orderId) {
    const recorded = await deps.recordOrderMessage(orderId, message.id);
    if (!recorded.success) return recorded;
  }
  const recorded = await deps.recordOutcome({ messageId: message.id, outcomes });
  if (!recorded.success) return recorded;
  return ok({ orderId, createdOrder: createdOrder !== null, outcomes, pendingsBefore: stored.data.pendings.length, pendingsAfter: nextPendings.pendings.length });
}
