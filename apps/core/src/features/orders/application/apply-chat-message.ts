import { isDeepStrictEqual } from "node:util";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { applyChatActions, needsNewChatOrder, type ChatOrderTarget, type ChatOrderLimits, type ReportOutcome, type ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import { resolveVariant } from "@core/src/features/orders/domain/pending-transitions";
import type { OrderItemChanges } from "@core/src/features/orders/domain/order-edit";
import { pendingLife, type ChatPending, type ChatPendingId, type ChatPendings, type LastIncomingPhoto } from "@core/src/features/orders/domain/chat-pendings";
import { checkReaderAnswer, type ChatReadingContext } from "@core/src/features/orders/domain/chat-reading";
import type { ChatMessageFailureCode, ChatMessageOutcome, ChatMessageOutcomes, StoredChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import { chooseSellerNotice, closesLinkCycle, isNoticeDue } from "@core/src/features/orders/domain/seller-notice";
import type { ChatId, OrderChatSource } from "@core/src/features/orders/domain/message-order";
import { diffMessageChanges, type ChangeSeq, type MessageChanges, type OrderItemChange, type OrderItemChangeId } from "@core/src/features/orders/domain/message-changes";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { OrderAggregate, OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import type { CompanyId, ContactId, OrderId, OrderItem, OrderItemId } from "@core/src/features/orders/domain/order";
import { nextLastIncomingPhoto } from "@core/src/features/orders/domain/photo-just-sent";
import { checkRequests, checkShownPhoto, type CheckedAction } from "@core/src/features/orders/domain/reader/check-requests";
import { lostRequests } from "@core/src/features/orders/domain/reader/silent-guards";
import { decideChanges, pendingQuantityOf, type DecidedChanges } from "@core/src/features/orders/domain/reader/decide-changes";
import { isHighCertainty, riskOfChecked } from "@core/src/features/orders/domain/reader/decide";
import type { DoubtReason } from "@core/src/features/orders/domain/reader/decision";
import { inheritedMark, withDecisionOnPending } from "@core/src/features/orders/domain/reader/pending-doubt";
import type { ContextMessageRef, QuoteId, RequestRef, StageCall } from "@core/src/features/orders/domain/reader/readings";
import type { MaskedText, MessageTrace, TracePhoto, TraceShadow } from "@core/src/features/orders/domain/reader/trace";
import type { ChatSourceMessage } from "@core/src/features/orders/application/chat-source-message";
import type { ReadChatMessage } from "@core/src/features/orders/application/read-chat-message";
import { buildCheckSnapshot, type SnapshotInput } from "@core/src/features/orders/application/reader/build-check-snapshot";
import { legacyAnswerFor, legacyReadingContextOf } from "@core/src/features/orders/application/reader/legacy-reading";
import type { ReadingContextData, ReadingMessage } from "@core/src/features/orders/application/reader/load-reading-context";
import { runReading, traceStagesOf, type ChainResult, type RunReadingDependencies, type StageRecord, type StartedReading } from "@core/src/features/orders/application/reader/run-reading";
import type { ReaderStages } from "@core/src/features/orders/application/reader/stages";
import { awaitShadow } from "@core/src/features/orders/application/reader/legacy-shadow-reader";
import type { BuildMessageTrace, LegacyShadowReader } from "@core/src/features/orders/application/reader/trace-ports";
import type { ShownProduct } from "@core/src/features/orders/application/reading-context";
import type { ImageIdentification } from "@core/src/features/products/application/identify-products-in-image";
import type { MentionCandidates } from "@core/src/features/products/application/find-mention-candidates";
import type { ImageBytes } from "@core/src/features/products/domain/image-identification";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";
import type { CatalogSearchReadiness } from "@core/src/features/products/domain/text-identification";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";
import type { ImageReadError } from "@core/src/shared/images";
import type { IdentifyProductsError } from "@core/src/features/products/application/identify-products-in-image";
import { log } from "@core/src/shared/infrastructure/logger";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type InvalidStoredData = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;
type ContactNotFound = Readonly<{ code: "CONTACT_NOT_FOUND"; message: string }>;
type SellerUnavailable = Readonly<{ code: "SELLER_UNAVAILABLE"; message: string }>;
type MessageAlreadyProcessed = Readonly<{ code: "MESSAGE_ALREADY_PROCESSED"; message: string }>;

export type AppliedChatMessage = Readonly<{ orderId: OrderId | null; createdOrder: boolean; outcomes: ChatMessageOutcomes; pendingsBefore: number; pendingsAfter: number }>;

/** What one reading did, for the handler's log (section 13). Never text. */
export type ReadingTrace = Readonly<{
  answer: "actions" | "no_intent" | "doubt" | "fixed";
  actionKinds: readonly string[];
  stageCalls: number;
  decisionKinds: readonly string[];
  doubtfulCount: number;
  urgentCount: number;
  confirmingRun: boolean;
  contextMessages: number;
  queuedMs: number;
  decidedMs: number;
  costUsd: number | null;
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

/** Every narrow error of the ports a run can fail with; `toApplyError` maps it to the handler's codes. */
type RunFailure = Readonly<{ code: string; message: string; /** Set when a reading stage failed: what the trace of the failed reading is built from. */ trace?: TraceData }>;

/** Narrow errors of the ports become the codes the handler decides on; a lost image is a lost message, and an unknown domain error is an invalid order. */
function toApplyError(error: Readonly<{ code: string; message: string }>): ApplyChatMessageError {
  if (error.code === "IMAGE_NOT_FOUND") return { code: "MESSAGE_NOT_FOUND", message: "The image of the message is not available" };
  if (retryableCodes.has(error.code) || permanentCodes.has(error.code)) return { code: error.code as ApplyChatMessageError["code"], message: error.message };
  return { code: "INVALID_ORDER", message: error.message };
}

export type ChatMessageLimits = ChatOrderLimits & Readonly<{
  /** Pendings without an order expire this long after their last change. */
  pendingTtlMs: number;
  maxReaderProducts: number;
  maxReaderItems: number;
  maxReaderTextChars: number;
}>;

/** What the staged reading adds to the limits: the whole-reading budget, the candidates per mention, the trace retention and the shadow wait. */
export type ReadingLimits = Readonly<{ readingBudgetMs: number; candidatesPerMention: number; traceRetentionDays: number; shadowWaitMs: number }>;

export type UnverdictedChanges = Readonly<{ open: readonly OrderItemChange[]; lastSeq: number }>;
/** What a chat remembers besides its pendings. */
export type ChatMemory = Readonly<{ lastIncomingPhoto: LastIncomingPhoto | null; lastRequestAt: Date | null }>;

export type ApplyChatMessageDependencies = Readonly<{
  findOutcome: (messageId: ChatMessageId) => Promise<Result<StoredChatMessageOutcome | null, PersistenceError | InvalidStoredData>>;
  findSourceMessage: (messageId: ChatMessageId) => Promise<Result<ChatSourceMessage | null, PersistenceError>>;
  /** Same shape as findChatOrderTargetForUpdate, without locks: the context the reader sees. */
  findChatOrderTarget: (chatId: ChatId) => Promise<Result<ChatOrderTarget, PersistenceError | InvalidStoredData>>;
  /** Aggregates of the chat's orders that may have opened for messages after `since`; read only when an orderless pending exists. */
  findChatOrdersOpenedSince: (chatId: ChatId, since: Date) => Promise<Result<readonly OrderAggregate[], PersistenceError | InvalidStoredData>>;
  findChatPendings: (chatId: ChatId) => Promise<Result<ChatPendings, PersistenceError | InvalidStoredData>>;
  findChatPendingsForUpdate: (chatId: ChatId) => Promise<Result<ChatPendings, PersistenceError | InvalidStoredData>>;
  findChatMemory: (chatId: ChatId) => Promise<Result<ChatMemory, PersistenceError | InvalidStoredData>>;
  saveChatPendings: (chatId: ChatId, pendings: ChatPendings, memory: ChatMemory) => Promise<Result<null, PersistenceError | InvalidStoredData>>;
  readImage: (imageId: ImageId, signal: AbortSignal) => Promise<Result<ImageBytes, ImageReadError>>;
  identifyProductsInImage: (image: ImageBytes, signal: AbortSignal) => Promise<Result<ImageIdentification, IdentifyProductsError>>;
  /** The reading input of section 5.1 step 2: three reads, outside the transaction. */
  loadReadingContext: (message: ReadingMessage, target: ChatOrderTarget, pendings: ChatPendings, photoMemory: LastIncomingPhoto | null) => Promise<Result<ReadingContextData, PersistenceError | InvalidStoredData>>;
  /** All the mentions of a message in one statement; a timeout is a result, not an error. */
  findMentionCandidates: (mentions: readonly string[]) => Promise<Result<MentionCandidates, PersistenceError>>;
  findProductsForReading: (productIds: readonly ProductId[]) => Promise<Result<readonly ProductForReading[], PersistenceError | InvalidStoredData>>;
  /** For the photo that matched nothing: silent while the catalog cannot recognize photos at all. */
  catalogSearchReadiness: () => Promise<Result<CatalogSearchReadiness, PersistenceError>>;
  /** Null without a model provider and no fake configured: texts are skipped and captions ignored. */
  stages: ReaderStages | null;
  /** The legacy single reader: only for the fixed answer of a photo with no readable caption, until T17. */
  readChatMessage: ReadChatMessage | null;
  /** The reading deadline: one signal for the whole reading that carries its budget and log ids (`createReadingDeadline`). */
  createDeadline: (budgetMs: number, meta: Readonly<{ companyId: string; messageId: string }>, jobSignal: AbortSignal) => AbortSignal;
  /** A signal that also aborts with `extra` and keeps the reading's budget and ids (`withAbort`). */
  withAbort: (reading: AbortSignal, extra: AbortSignal) => AbortSignal;
  transaction: <T, E extends Readonly<{ code: string; message: string }>>(companyId: CompanyId, work: () => Promise<Result<T, E>>) => Promise<Result<T, E | PersistenceError>>;
  lockContact: (contactId: ContactId) => Promise<Result<null, PersistenceError | ContactNotFound>>;
  ensureCustomerForContact: (contactId: ContactId) => Promise<Result<Readonly<{ customerId: CustomerId }>, PersistenceError | ContactNotFound>>;
  findChatOrderTargetForUpdate: (chatId: ChatId) => Promise<Result<ChatOrderTarget, PersistenceError | InvalidStoredData>>;
  allocateNumber: () => Promise<Result<OrderNumber, PersistenceError>>;
  saveNewOrder: (order: OrderAggregate, link: OrderChatSource) => Promise<Result<null, PersistenceError | SellerUnavailable>>;
  saveItemChanges: (order: OrderAggregate, changes: OrderItemChanges) => Promise<Result<null, PersistenceError>>;
  /** `linkChangeNotice`: the message's notice closes the «Pedido #N cambió» cycle. */
  recordOrderMessage: (orderId: OrderId, messageId: ChatMessageId, linkChangeNotice: boolean) => Promise<Result<null, PersistenceError | MessageAlreadyProcessed>>;
  /** The order's changes that no one judged yet and no message superseded, and its highest change `seq`; plain reads under the order lock. */
  findUnverdictedChanges: (orderId: OrderId) => Promise<Result<UnverdictedChanges, PersistenceError | InvalidStoredData>>;
  /** True when a link action is newer than the last message whose notice closed a cycle; two indexed single-row reads under the order lock. */
  findLinkNoticeArming: (orderId: OrderId) => Promise<Result<boolean, PersistenceError>>;
  /** Writes the change rows, the supersessions and the touched pendings of the message; after `recordOrderMessage`. */
  saveMessageChanges: (changes: MessageChanges) => Promise<Result<null, PersistenceError>>;
  newChangeId: () => OrderItemChangeId;
  recordOutcome: (record: Readonly<{ messageId: ChatMessageId; outcomes: ChatMessageOutcomes; createdAt?: Date }>) => Promise<Result<null, PersistenceError | InvalidStoredData | MessageAlreadyProcessed>>;
  newOrderId: () => OrderId;
  newItemId: () => OrderItemId;
  newPendingId: () => ChatPendingId;
  clock: () => Date;
  /** Pure builder of the trace and the new masked texts (after commit). */
  buildMessageTrace: BuildMessageTrace;
  /** After commit, best effort: a failure logs `reader_trace_save_failed` and never fails the job. */
  saveMessageTrace: (trace: MessageTrace, masks: readonly MaskedText[]) => Promise<Result<null, PersistenceError | InvalidStoredData>>;
  /** Phase 5 only; null when off. */
  shadowReader: LegacyShadowReader | null;
  limits: ChatMessageLimits & ReadingLimits;
}>;

type Input = Readonly<{ companyId: CompanyId; messageId: ChatMessageId }>;
type RunError = PersistenceError | InvalidStoredData | ContactNotFound | SellerUnavailable | MessageAlreadyProcessed | OrderDomainError;

/** Placeholder of `NewChatOrderSeed.number` when `needsNewChatOrder` says no order is created. */
const unusedNumber = 0 as OrderNumber;

const noticeDueOf = (stored: StoredChatMessageOutcome) => isNoticeDue(stored.outcomes, stored.noticeSentAt);
const hasChanges = (changes: OrderItemChanges) => changes.added.length + changes.updated.length + changes.removedItemIds.length > 0;
/** A text or caption the reader can read: with at least one letter or digit; symbols and emoji alone count as no text. */
export const hasReadableText = (text: string | null): text is string => text !== null && /[\p{L}\p{N}]/u.test(text);

/** The chat's order and its alive pendings as the reader sees them: unlocked, and the transaction decides again under lock. */
type ChatState = Readonly<{ target: ChatOrderTarget; pendings: ChatPendings; memory: ChatMemory }>;
/** The locked state the checks and the decision read. */
type Locked = Readonly<{ target: ChatOrderTarget; alive: readonly ChatPending[]; memory: ChatMemory }>;
type Decision = Readonly<{ actions: readonly [ResolvedChatAction, ...ResolvedChatAction[]]; decided: DecidedChanges | null }>;

/** What the transaction applies and how, decided on the locked state. */
type Plan = Readonly<{
  decide: (locked: Locked) => Decision;
  /** The message was read with intent `requests`: it sets `lastRequestAt`. */
  intentRequests: boolean;
  kind: "text" | "photo";
  shownProductIds: readonly ProductId[];
  /** Which request each variant's change belongs to, to point its row at the request's quote. */
  quoteIds: ReadonlyMap<string, QuoteId>;
}>;

/** What the after-commit steps need of the reading. */
type TraceData = Readonly<{
  intent: Parameters<BuildMessageTrace>[0]["intent"];
  context: ReadingContextData | null;
  photo: TracePhoto | null;
  started: StartedReading | null;
  /** Every stage call so far; the confirming chain keeps adding while it runs. */
  records: readonly StageRecord[];
  confirmingRun: boolean;
  startedAt: Date;
  answer: ReadingTrace["answer"];
  actionKinds: readonly string[];
}>;
type Staged = Readonly<{ plan: Plan; data: TraceData }>;
type Applied = Readonly<{ applied: AppliedChatMessage; decided: DecidedChanges | null; commitAt: Date }>;

const emptyData = (startedAt: Date, answer: ReadingTrace["answer"] = "no_intent"): TraceData =>
  ({ intent: null, context: null, photo: null, started: null, records: [], confirmingRun: false, startedAt, answer, actionKinds: [] });

const reportPlan = (outcome: ReportOutcome, kind: Plan["kind"] = "text"): Plan => ({ decide: () => ({ actions: [{ kind: "report", outcome }], decided: null }), intentRequests: false, kind, shownProductIds: [], quoteIds: new Map() });

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
  if (!message.imageId && !deps.stages) return ok({ kind: "skipped", reason: "reader_disabled" });
  const startedAt = deps.clock();
  const reading = deps.createDeadline(deps.limits.readingBudgetMs, { companyId: message.companyId, messageId: message.id }, signal);
  // The shadow starts with the reading, on its own signal, and never applies anything; it is aborted when the call ends.
  const shadowEnd = new AbortController();
  const shadow = deps.shadowReader ? deps.shadowReader(message, AbortSignal.any([signal, AbortSignal.timeout(deps.limits.readingBudgetMs), shadowEnd.signal])) : null;
  try {
    const state = await loadChatState(message.chatId, deps);
    if (!state.success) return err(toApplyError(state.error));
    const staged = message.imageId ? await applyPhoto(message, message.imageId, state.data, deps, reading, startedAt) : await applyText(message, state.data, deps, reading, startedAt);
    if (!staged.success) {
      if (staged.error.trace) await afterCommit(message, staged.error.trace, null, null, shadow, deps);
      return staged.error.code === "MESSAGE_ALREADY_PROCESSED" ? rereadProcessed(input.messageId, deps) : err(toApplyError(staged.error));
    }
    const committed = await deps.transaction(input.companyId, () => applyInTransaction(message, staged.data.plan, deps));
    if (!committed.success) return committed.error.code === "MESSAGE_ALREADY_PROCESSED" ? rereadProcessed(input.messageId, deps) : err(toApplyError(committed.error));
    const { applied, decided, commitAt } = committed.data;
    const trace = await afterCommit(message, staged.data.data, decided, commitAt, shadow, deps);
    return ok({ kind: "applied", orderId: applied.orderId, createdOrder: applied.createdOrder, outcomes: applied.outcomes, noticeDue: chooseSellerNotice(applied.outcomes) !== null,
      pendingsBefore: applied.pendingsBefore, pendingsAfter: applied.pendingsAfter, trace });
  } finally {
    shadowEnd.abort();
  }
}

/** The transaction rolled back because another run recorded the message first. */
async function rereadProcessed(messageId: ChatMessageId, deps: ApplyChatMessageDependencies): Promise<Result<ApplyChatMessageOutcome, ApplyChatMessageError>> {
  const winner = await deps.findOutcome(messageId);
  if (!winner.success) return err(toApplyError(winner.error));
  return winner.data ? ok({ kind: "already_processed", noticeDue: noticeDueOf(winner.data) })
    : err({ code: "PERSISTENCE_UNAVAILABLE", message: "Processed message is not visible" });
}

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
  const memory = await deps.findChatMemory(chatId);
  if (!memory.success) return memory;
  const openedSince = await readOpenedSince(stored.data, chatId, deps);
  if (!openedSince.success) return openedSince;
  const life = pendingLife(stored.data, { target: target.data, openedSince: openedSince.data }, deps.clock(), deps.limits.pendingTtlMs);
  return ok({ target: target.data, pendings: { ...stored.data, pendings: life.alive }, memory: memory.data });
}

const readingMessageOf = (message: ChatSourceMessage): ReadingMessage => message;

const textTooLong = (): ReportOutcome => ({ kind: "invalid_action", orderId: null, reason: "text_too_long" });

async function applyText(message: ChatSourceMessage, state: ChatState, deps: ApplyChatMessageDependencies, signal: AbortSignal, startedAt: Date): Promise<Result<Staged, RunFailure>> {
  const text = message.text ?? "";
  if (text.length > deps.limits.maxReaderTextChars) return ok({ plan: reportPlan(textTooLong()), data: emptyData(startedAt) });
  const context = await deps.loadReadingContext(readingMessageOf(message), state.target, state.pendings, state.memory.lastIncomingPhoto);
  if (!context.success) return context;
  return readStaged({ message, state, deps, signal, startedAt, context: context.data, kind: "text", shown: [], photo: null });
}

type StagedRead = Readonly<{
  message: ChatSourceMessage; state: ChatState; deps: ApplyChatMessageDependencies; signal: AbortSignal; startedAt: Date; context: ReadingContextData;
  kind: "text" | "photo_product" | "photo_not_product"; shown: readonly ShownProduct[]; photo: TracePhoto | null;
  intent?: ReturnType<ReaderStages["readIntent"]>;
}>;

/** Worth the confirming reading: a sure high-risk action, or a sure quantity on a pending (a disagreement makes it «Con duda»). */
const isHigh = (checked: CheckedAction) => isHighCertainty(checked.signals) && (riskOfChecked(checked) === "high" || pendingQuantityOf(checked.action) !== null);

/** The three stages, then the plan the transaction applies: the checks and the decision run again there, on the locked state. */
async function readStaged(read: StagedRead): Promise<Result<Staged, RunFailure>> {
  const { deps, context, state, shown } = read;
  const runDeps: RunReadingDependencies = { stages: deps.stages!, findMentionCandidates: deps.findMentionCandidates, findProductsForReading: deps.findProductsForReading,
    candidatesPerMention: deps.limits.candidatesPerMention, withAbort: deps.withAbort };
  const shownIds = shown.map(({ productId }) => productId);
  const started = await runReading(runDeps, context, shownIds, read.signal, { intent: read.intent });
  if (!started.success) {
    const { records, intent, ...error } = started.error;
    return err({ ...error, trace: { intent, context, photo: read.photo, started: null, records, confirmingRun: false, startedAt: read.startedAt, answer: "no_intent", actionKinds: [] } });
  }
  const { primary } = started.data;
  for (const drop of primary.quoteDrops) log.debug({ event: "reader_quote_dropped", companyId: read.message.companyId, messageId: read.message.id, ...drop }, "reader_quote_dropped");
  const data: TraceData = { intent: primary.intent, context, photo: read.photo, started: started.data, records: started.data.records, confirmingRun: false, startedAt: read.startedAt, answer: "no_intent", actionKinds: [] };
  if (read.kind === "photo_product" && (primary.intent.kind !== "requests" || !primary.chain)) {
    // The photo is the request: a caption that reads as no intent, or that cannot be read, leaves the shown products added (or pending), with a doubt for the unreadable one.
    const fixed = await fixedPhoto(read.message, shown, primary.intent.kind !== "no_intent", state, deps, read.signal, read.startedAt, read.photo!);
    return fixed.success ? ok({ plan: fixed.data.plan, data: { ...data, answer: "fixed", actionKinds: fixed.data.data.actionKinds } }) : fixed;
  }
  if (primary.intent.kind === "no_intent") return ok({ plan: reportPlan({ kind: "no_intent" }, read.kind === "text" ? "text" : "photo"), data });
  if (primary.intent.kind === "unsure" || !primary.chain) return ok({ plan: reportPlan({ kind: "reader_doubt", orderId: null }, read.kind === "text" ? "text" : "photo"), data: { ...data, answer: "doubt" } });
  const chain = primary.chain;
  const language = primary.intent.language;
  const snapshotOf = (locked: Pick<Locked, "target" | "alive" | "memory">) => buildCheckSnapshot({ kind: read.kind, language, reading: context.input, products: primary.catalog.products, shown,
    target: locked.target, alive: locked.alive, memory: locked.memory.lastIncomingPhoto, photo: context.photoOutcome ? { ref: context.photoOutcome.ref as ContextMessageRef, outcome: context.photoOutcome.outcome } : null } satisfies SnapshotInput);
  // Early look on the unlocked state: the confirming chain is only worth waiting for when some high-risk action is otherwise sure.
  const early = checkRequests(chain.requests, chain.resolutions, snapshotOf({ target: state.target, alive: state.pendings.pendings, memory: state.memory }));
  let confirming: ChainResult | null = null;
  if (started.data.confirming) {
    if (early.some(isHigh)) confirming = await started.data.confirming.result;
    else started.data.confirming.abort();
  }
  const confirmingRun = confirming !== null;
  const quoteIds = new Map<string, QuoteId>();
  chain.requests.forEach(({ request }, index) => quoteIds.set(request.request, index as QuoteId));
  const plan: Plan = { intentRequests: true, kind: read.kind === "text" ? "text" : "photo", shownProductIds: shownIds, quoteIds,
    decide: (locked) => {
      const snapshot = snapshotOf(locked);
      const checks = checkRequests(chain.requests, chain.resolutions, snapshot);
      const confirmed = confirming ? checkRequests(confirming.requests, confirming.resolutions, snapshot) : null;
      const lost = read.kind === "photo_not_product" ? [] : lostRequests(primary.droppedRequests, primary.intents.map(({ id }) => id), checks, chain.absorbed);
      const decided = decideChanges([...checks, ...lost, ...checkShownPhoto(snapshot, chain.requests, chain.resolutions), ...tooManyActions(primary.overflow)], confirmed, { captionUnread: false });
      return { actions: nonEmpty(decided.actions, { kind: "report", outcome: { kind: "no_intent" } }), decided };
    } };
  return ok({ plan, data: { ...data, confirmingRun, answer: "actions", actionKinds: chain.requests.map(({ request }) => request.kind) } });
}

/** The requests beyond `maxReaderActions` are cut; the message reports `too_many_actions` for them, urgent like any invalid action. */
const tooManyActions = (overflow: RequestRef | null): readonly CheckedAction[] => overflow === null ? [] : [{ request: overflow,
  action: { kind: "report", outcome: { kind: "invalid_action", orderId: null, reason: "too_many_actions" } },
  signals: { quotesComplete: true, targetNamed: "named", variantChangeVerb: "not_applicable", candidates: "single" }, doubt: null, urgent: { problem: "invalid_action", question: null }, blocked: null }];

const nonEmpty = (actions: readonly ResolvedChatAction[], fallback: ResolvedChatAction): readonly [ResolvedChatAction, ...ResolvedChatAction[]] => {
  const [first, ...rest] = actions;
  return first ? [first, ...rest] : [fallback];
};

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

function photoTrace(identified: ImageIdentification, products: readonly IdentifiedProduct[] | "not_product" | "not_found", durationMs: number): TracePhoto {
  const method = identified.kind === "found" || identified.kind === undefined ? identified.method : "none";
  const only = Array.isArray(products) && products.length === 1 ? products[0]! : null;
  const result = products === "not_found" ? "not_found" : products === "not_product" ? "not_product" : Array.isArray(products) && products.length > 1 ? "several" : "matched";
  return { method: method === "qr" || method === "visual" ? method : "none", result, productId: only?.productId ?? null,
    confidence: only?.identification.confidence ?? null, usage: null, costUsd: null, durationMs };
}

async function applyPhoto(message: ChatSourceMessage, imageId: ImageId, state: ChatState, deps: ApplyChatMessageDependencies, signal: AbortSignal, startedAt: Date): Promise<Result<Staged, RunFailure>> {
  const caption = hasReadableText(message.caption) && deps.stages ? message.caption : null;
  const readable = caption !== null && caption.length <= deps.limits.maxReaderTextChars;
  // A captioned photo reads its intent while the cascade runs: intent reads only the message kind and the caption.
  const context = await deps.loadReadingContext(readingMessageOf(message), state.target, state.pendings, state.memory.lastIncomingPhoto);
  if (!context.success) return context;
  const intent = readable ? deps.stages!.readIntent({ ...context.data.input, photo: null }, "primary", signal) : undefined;
  const cascadeStarted = performance.now();
  const image = await deps.readImage(imageId, signal);
  if (!image.success) return image;
  const identified = await deps.identifyProductsInImage(image.data, signal);
  if (!identified.success) return identified;
  if (signal.aborted) return err({ code: "DEADLINE_EXCEEDED", message: "The attempt deadline passed" });
  const products = productsOf(identified.data);
  const photo = photoTrace(identified.data, products, Math.round(performance.now() - cascadeStarted));
  if (products === "not_found") return ok({ plan: await missPlan(deps), data: { ...emptyData(startedAt), photo } });
  if (products === "not_product" && !caption) return ok({ plan: reportPlan({ kind: "no_intent" }, "photo"), data: { ...emptyData(startedAt), photo } });
  const shown = products === "not_product" ? [] : products;
  if (shown.length && (!readable || caption === null)) return fixedPhoto(message, shown, caption !== null && !readable, state, deps, signal, startedAt, photo);
  if (!deps.stages || caption === null) return ok({ plan: reportPlan({ kind: "no_intent" }, "photo"), data: { ...emptyData(startedAt), photo } });
  return readStaged({ message, state, deps, signal, startedAt, context: context.data, kind: products === "not_product" ? "photo_not_product" : "photo_product", shown, photo, intent });
}

/** A photo that matched nothing is a miss; it stays silent while the catalog cannot recognize photos at all. */
async function missPlan(deps: ApplyChatMessageDependencies): Promise<Plan> {
  const readiness = await deps.catalogSearchReadiness();
  const silent = !readiness.success || readiness.data !== "ready";
  return reportPlan({ kind: "not_identified", source: "photo", identification: null, silent }, "photo");
}

/** A product photo with no readable caption: the shown products are added with their QR values and no model is called; an unreadable caption marks the add «Con duda». */
async function fixedPhoto(message: ChatSourceMessage, shown: readonly IdentifiedProduct[], captionDoubt: boolean, state: ChatState, deps: ApplyChatMessageDependencies, signal: AbortSignal,
  startedAt: Date, photo: TracePhoto): Promise<Result<Staged, RunFailure>> {
  // Only a product photo with no caption reaches the fixed answer, so no text is searched.
  const legacy = { findMessageCandidates: async () => ok({ productIds: [] as readonly ProductId[], matchCount: 0, durationMs: 0, timedOut: false }), findProductsForReading: deps.findProductsForReading,
    readChatMessage: null, limits: deps.limits };
  const read = await legacyReadingContextOf({ kind: "photo_product", text: null, shown }, { target: state.target, pendings: state.pendings }, legacy);
  if (!read.success) return read;
  const { context } = read.data;
  // A product that left the catalog since it was matched is a miss that still names its identification.
  const present = new Set(context.products.map(({ productId }) => productId));
  const missing = shown.filter(({ productId }) => !present.has(productId))
    .map((entry): ResolvedChatAction => ({ kind: "report", outcome: { kind: "not_identified", source: "photo", identification: entry.identification, silent: false } }));
  const shownIds = shown.map(({ productId }) => productId);
  if (missing.length === shown.length) return ok({ plan: { ...reportPlan((missing[0] as Extract<ResolvedChatAction, { kind: "report" }>).outcome, "photo"), shownProductIds: shownIds }, data: { ...emptyData(startedAt, "fixed"), photo } });
  const answered = await legacyAnswerFor({ ...context, text: null }, legacy, { companyId: message.companyId, messageId: message.id }, signal,
    { candidateMs: null, candidateMatchCount: null, candidatesTimedOut: false });
  if (!answered.success) return answered;
  const resolved = checkReaderAnswer(answered.data.answer, context as ChatReadingContext, { captionDoubt });
  const checked = [...missing, ...resolved].map((action): CheckedAction => ({ request: "R0" as never, action,
    signals: { quotesComplete: true, targetNamed: "named", variantChangeVerb: "not_applicable", candidates: "single" }, doubt: null, urgent: null, blocked: null }));
  const plan: Plan = { intentRequests: false, kind: "photo", shownProductIds: shownIds, quoteIds: new Map(),
    decide: () => {
      const decided = decideChanges(checked, null, { captionUnread: captionDoubt });
      return { actions: nonEmpty(decided.actions, { kind: "report", outcome: { kind: "no_intent" } }), decided };
    } };
  return ok({ plan, data: { ...emptyData(startedAt, "fixed"), photo, actionKinds: resolved.map(({ kind }) => kind) } });
}

/** The change rows of the message, with `seq` after the order's highest, the decision of each line, its quote and the earlier changes it supersedes. */
async function diffChanges(orderId: OrderId, messageId: ChatMessageId, items: Readonly<{ before: readonly OrderItem[]; after: readonly OrderItem[] }>,
  pendings: Readonly<{ before: readonly ChatPending[]; after: readonly ChatPending[] }>, at: Date, decisionOf: (variantId: OrderItem["variantId"]) => OrderItemChange["decision"],
  quoteOf: (variantId: OrderItem["variantId"]) => QuoteId | null, deps: ApplyChatMessageDependencies): Promise<Result<MessageChanges, PersistenceError | InvalidStoredData>> {
  const linesChanged = items.before.length !== items.after.length || items.after.some((line, index) => !isDeepStrictEqual(line, items.before[index]));
  const unverdicted = linesChanged ? await deps.findUnverdictedChanges(orderId) : ok<UnverdictedChanges>({ open: [], lastSeq: 0 });
  if (!unverdicted.success) return unverdicted;
  const diffed = diffMessageChanges({ orderId, messageId, before: items.before, after: items.after, decision: decisionOf,
    openChanges: unverdicted.data.open, pendingsBefore: pendings.before, pendingsAfter: pendings.after, newChangeId: deps.newChangeId, at, nextSeq: (unverdicted.data.lastSeq + 1) as ChangeSeq });
  return ok({ ...diffed, changes: diffed.changes.map((change) => ({ ...change, quoteId: quoteOf((change.after ?? change.before)!.variantId) })) });
}

/** True when a pending attached to the order is new or differs from what it was before the message. */
function pointsChanged(before: readonly ChatPending[], after: readonly ChatPending[], orderId: OrderId): boolean {
  const previous = new Map(before.map((pending) => [pending.id, pending]));
  return after.some((pending) => pending.order?.orderId === orderId && !isDeepStrictEqual(pending, previous.get(pending.id)));
}

/**
 * The mark each item created from a doubtful pending carries, by variant: the pending's unacknowledged doubt, for every completion of this message,
 * full or partial (a partial completion leaves the remainder under the same pending id, so the pending outliving the message proves nothing).
 */
function completionMarks(decided: DecidedChanges | null, alive: readonly ChatPending[]): ReadonlyMap<OrderItem["variantId"], DoubtReason> {
  const marks = new Map<OrderItem["variantId"], DoubtReason>();
  for (const { checked, decision } of decided?.decided ?? []) {
    const { action } = checked;
    if (action.kind !== "advance_pending" || decision.kind === "doubtful" || !action.request.product) continue;
    const pending = alive.find(({ id }) => id === action.request.pendingId);
    if (!pending) continue;
    const resolution = resolveVariant(action.request.product, pending.known, action.request.values);
    const mark = resolution.kind === "resolved" ? inheritedMark(pending, { quantity: action.request.quantity, values: action.request.values }) : null;
    if (resolution.kind === "resolved" && mark && !marks.has(resolution.item.variantId)) marks.set(resolution.item.variantId, mark);
  }
  return marks;
}

async function applyInTransaction(message: ChatSourceMessage, plan: Plan, deps: ApplyChatMessageDependencies): Promise<Result<Applied, RunError>> {
  const locked = await deps.lockContact(message.contactId);
  if (!locked.success) return locked;
  const again = await deps.findOutcome(message.id);
  if (!again.success) return again;
  if (again.data) return err({ code: "MESSAGE_ALREADY_PROCESSED", message: "Message already processed" });
  const target = await deps.findChatOrderTargetForUpdate(message.chatId);
  if (!target.success) return target;
  const stored = await deps.findChatPendingsForUpdate(message.chatId);
  if (!stored.success) return stored;
  const memory = await deps.findChatMemory(message.chatId);
  if (!memory.success) return memory;
  const openedSince = await readOpenedSince(stored.data, message.chatId, deps);
  if (!openedSince.success) return openedSince;
  const now = deps.clock();
  const life = pendingLife(stored.data, { target: target.data, openedSince: openedSince.data }, now, deps.limits.pendingTtlMs);
  const alive: ChatPendings = { ...stored.data, pendings: life.alive };
  const { actions, decided } = plan.decide({ target: target.data, alive: alive.pendings, memory: memory.data });
  const customer = needsNewChatOrder(target.data, alive, actions, deps.limits) ? await deps.ensureCustomerForContact(message.contactId) : null;
  if (customer && !customer.success) return customer;
  const number = customer ? await deps.allocateNumber() : ok(unusedNumber);
  if (!number.success) return number;
  const applied = applyChatActions(target.data, alive, actions, { newOrderId: deps.newOrderId, newItemId: deps.newItemId, newPendingId: deps.newPendingId }, now, deps.limits,
    { number: number.data, companyId: message.companyId, sellerId: message.uploadedByUserId, chatId: message.chatId, contactId: message.contactId, messageId: message.id });
  if (!applied.success) return applied;
  const { createdOrder, changes } = applied.data;
  // A doubtful change to a pending leaves its doubt and an unacknowledged «Por resolver» point on it.
  const pendingsAfter: ChatPendings = { ...applied.data.pendings, pendings: applied.data.pendings.pendings.map((pending) => {
    const doubt = decided?.pendingDoubts.get(pending.id);
    return doubt ? withDecisionOnPending(pending, doubt, now) : pending;
  }) };
  const marks = completionMarks(decided, alive.pendings);
  // Pendings that ended with their order or by age are recorded first, silently.
  const ended = life.ended.map(({ id, reason }): ChatMessageOutcome => ({ kind: "pending_ended", pendingId: id, reason }));
  const changedOrder = target.data.kind === "open" && hasChanges(changes) && applied.data.target.kind === "open" ? applied.data.target.order : null;
  const openOrder = createdOrder ?? (applied.data.target.kind === "open" ? applied.data.target.order : null);
  const openOrderId = openOrder?.id ?? null;
  // A message that only creates or changes a «Por resolver» point of the open order still belongs to that order: it is recorded and can arm «Pedido #N cambió».
  const pointChanged = openOrderId !== null && pointsChanged(alive.pendings, pendingsAfter.pendings, openOrderId);
  const orderId = createdOrder?.id ?? changedOrder?.id ?? (pointChanged ? openOrderId : null);
  let rows: MessageChanges | null = null;
  const outcomes: ChatMessageOutcome[] = [...ended, ...applied.data.outcomes];
  if (orderId) {
    const items = { before: target.data.kind === "open" ? target.data.order.items : [], after: openOrder?.items ?? [] };
    const quoteOf = (variantId: OrderItem["variantId"]) => {
      const owner = decided?.decided.find(({ checked }) => decided.doubtful.has(variantId) && checked.action.kind !== "report" && variantsTouch(checked.action, variantId))
        ?? decided?.decided.find(({ checked }) => variantsTouch(checked.action, variantId));
      return owner ? plan.quoteIds.get(owner.checked.request) ?? null : null;
    };
    const decisionOf = (variantId: OrderItem["variantId"]): OrderItemChange["decision"] => {
      const mark = marks.get(variantId);
      return decided?.doubtful.get(variantId) ?? (mark ? { kind: "doubtful", reason: mark } : { kind: "applied" });
    };
    const diffed = await diffChanges(orderId, message.id, items, { before: alive.pendings, after: pendingsAfter.pendings }, now, decisionOf, quoteOf, deps);
    if (!diffed.success) return diffed;
    rows = diffed.data;
    // Any change after the seller took the link arms «Pedido #N cambió»: an applied one, a «Con duda» mark or a new or changed «Por resolver» point.
    if (rows.changes.length > 0 || pointChanged) {
      const armed = await deps.findLinkNoticeArming(orderId);
      if (!armed.success) return armed;
      if (armed.data) outcomes.push({ kind: "changed_after_link", orderId });
    }
  }
  if (decided && decided.questions.length > 0) outcomes.push({ kind: "questions", questions: decided.questions });
  const [first, ...rest] = outcomes;
  if (!first) return err({ code: "INVALID_ORDER", message: "A message needs at least one outcome" });
  const finalOutcomes: ChatMessageOutcomes = [first, ...rest];
  const linkNotice = closesLinkCycle(chooseSellerNotice(finalOutcomes));
  if (createdOrder && customer?.success) {
    const saved = await deps.saveNewOrder(createdOrder, { chatId: message.chatId, customerId: customer.data.customerId });
    if (!saved.success) return saved;
  } else if (changedOrder) {
    const saved = await deps.saveItemChanges(changedOrder, changes);
    if (!saved.success) return saved;
  }
  const photoAfter = nextLastIncomingPhoto({ kind: plan.kind, previous: memory.data.lastIncomingPhoto, shownProductIds: plan.shownProductIds, applied: { ...applied.data, pendings: pendingsAfter } });
  const memoryAfter: ChatMemory = { lastIncomingPhoto: photoAfter, lastRequestAt: plan.intentRequests ? now : memory.data.lastRequestAt };
  if (!isDeepStrictEqual(pendingsAfter, stored.data) || !isDeepStrictEqual(memoryAfter, memory.data)) {
    const savedPendings = await deps.saveChatPendings(message.chatId, pendingsAfter, memoryAfter);
    if (!savedPendings.success) return savedPendings;
  }
  if (orderId) {
    const recorded = await deps.recordOrderMessage(orderId, message.id, linkNotice);
    if (!recorded.success) return recorded;
    if (rows && (rows.changes.length > 0 || rows.pendingsBefore.length > 0 || rows.pendingsAfter.length > 0)) {
      const savedChanges = await deps.saveMessageChanges(rows);
      if (!savedChanges.success) return savedChanges;
    }
  }
  const recordedOutcome = await deps.recordOutcome({ messageId: message.id, outcomes: finalOutcomes, createdAt: now });
  if (!recordedOutcome.success) return recordedOutcome;
  return ok({ applied: { orderId, createdOrder: createdOrder !== null, outcomes: finalOutcomes, pendingsBefore: stored.data.pendings.length, pendingsAfter: pendingsAfter.pendings.length },
    decided, commitAt: deps.clock() });
}

function variantsTouch(action: ResolvedChatAction, variantId: OrderItem["variantId"]): boolean {
  switch (action.kind) {
    case "add": return action.item.variantId === variantId;
    case "remove": case "set_quantity": case "increase_quantity": case "lower_quantity": case "set_mentioned_price": return action.target.kind === "variant" && action.target.variantId === variantId;
    case "change_variant": return (action.target.kind === "variant" && action.target.variantId === variantId) || (action.to.kind === "resolved" && action.to.item.variantId === variantId);
    case "set_photo_item_quantity": return action.variantId === variantId;
    default: return false;
  }
}

/** After commit (or after a stage failure, with `decidedAt` null): waits for the shadow at most `min(shadowWaitMs, time left)`, builds and saves the trace and the new masks. A failure never fails the job. */
async function afterCommit(message: ChatSourceMessage, data: TraceData, decided: DecidedChanges | null, decidedAt: Date | null, shadow: Promise<TraceShadow | null> | null,
  deps: ApplyChatMessageDependencies): Promise<ReadingTrace> {
  // The wait holds the chat's queue slot: at most `shadowWaitMs`, and never past the reading budget.
  const endedAt = decidedAt ?? deps.clock();
  const left = Math.max(0, deps.limits.readingBudgetMs - (endedAt.getTime() - data.startedAt.getTime()));
  const waited = shadow ? await awaitShadow(shadow, Math.min(deps.limits.shadowWaitMs, left)) : null;
  const shadowResult = waited?.shadow ?? null;
  const shadowWaitMs = waited ? waited.waitedMs : null;
  const { records } = data;
  const stages = traceStagesOf(records);
  const calls: readonly StageCall[] = stages.map(({ call }) => call);
  const costUsd = [...calls.map(({ costUsd: cost }) => cost), data.photo?.costUsd ?? null].reduce<number | null>((sum, cost) => (cost === null ? sum : (sum ?? 0) + cost), null);
  const queuedMs = Math.max(0, data.startedAt.getTime() - message.receivedAt.getTime());
  try {
    const primary = data.started?.primary;
    const built = deps.buildMessageTrace({ message: { id: message.id, companyId: message.companyId, receivedAt: message.receivedAt, text: message.text, caption: message.caption },
      retentionDays: deps.limits.traceRetentionDays, startedAt: data.startedAt, decidedAt, queuedMs, shadowWaitMs, intent: data.intent, context: data.context, photo: data.photo, records,
      requests: primary?.chain?.requests ?? [], intents: primary?.intents ?? [], decisions: decided?.decided ?? [], shadow: shadowResult });
    const saved = await deps.saveMessageTrace(built.trace, built.masks);
    if (!saved.success) log.warn({ event: "reader_trace_save_failed", companyId: message.companyId, messageId: message.id, errorCode: saved.error.code }, "reader_trace_save_failed");
  } catch (cause) {
    log.warn({ event: "reader_trace_save_failed", companyId: message.companyId, messageId: message.id, errorCode: "TRACE_BUILD_FAILED", err: cause }, "reader_trace_save_failed");
  }
  const decisions = decided?.decided.map(({ decision }) => decision.kind) ?? [];
  return { answer: data.answer, actionKinds: data.actionKinds, stageCalls: calls.length, decisionKinds: decisions, doubtfulCount: decisions.filter((kind) => kind === "doubtful").length,
    urgentCount: decisions.filter((kind) => kind === "urgent").length, confirmingRun: data.confirmingRun, contextMessages: data.context?.contextMessageIds.size ?? 0, queuedMs,
    decidedMs: Math.max(0, endedAt.getTime() - data.startedAt.getTime()), costUsd, candidateMs: data.started?.primary.catalog.searchMs ?? null,
    candidateMatchCount: data.started?.primary.catalog.matchCount ?? null, candidatesTimedOut: data.started?.primary.catalog.timedOut ?? false };
}
