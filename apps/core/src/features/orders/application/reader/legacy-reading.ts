import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order-target";
import { fixedShownAnswer, type ChatReadingContext, type ReaderAnswer } from "@core/src/features/orders/domain/chat-reading";
import type { ChatPendings } from "@core/src/features/orders/domain/chat-pendings";
import type { CompanyId } from "@core/src/features/orders/domain/order";
import type { ReadChatMessage, ReaderError, ReaderUsage } from "@core/src/features/orders/application/read-chat-message";
import { buildReadingContext, listedItems, selectReadingProducts, type ShownProduct } from "@core/src/features/orders/application/reading-context";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type InvalidStoredData = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;

/**
 * The single-call reader's context and answer, as they were before the staged reader. They stay for two uses until T17: the photo with no readable
 * caption (a fixed answer with no model call) and the phase-5 shadow reader. Nothing here decides anything about an order.
 */
export type LegacyReadingDependencies = Readonly<{
  /** A statement timeout is not an error: it returns no ids with timedOut true. */
  findMessageCandidates: (text: string) => Promise<Result<Readonly<{ productIds: readonly ProductId[]; matchCount: number; durationMs: number; timedOut: boolean }>, PersistenceError>>;
  findProductsForReading: (productIds: readonly ProductId[]) => Promise<Result<readonly ProductForReading[], PersistenceError | InvalidStoredData>>;
  readChatMessage: ReadChatMessage | null;
  limits: Readonly<{ maxReaderProducts: number; maxReaderItems: number; maxReaderTextChars: number }>;
}>;

export type LegacyChatState = Readonly<{ target: ChatOrderTarget; pendings: ChatPendings }>;
export type LegacyReadingTrace = Readonly<{ readerCalls: 0 | 1; answer: "actions" | "no_intent" | "doubt" | "fixed"; actionKinds: readonly string[]; usage: ReaderUsage | null;
  contextTruncated: boolean; candidateMs: number | null; candidateMatchCount: number | null; candidatesTimedOut: boolean }>;
export type LegacyAnswered = Readonly<{ answer: ReaderAnswer; captionDoubt: boolean; trace: LegacyReadingTrace }>;
type ReadingInputs = Readonly<{ kind: ChatReadingContext["kind"]; text: string | null; shown: readonly ShownProduct[] }>;

const noReading: LegacyReadingTrace = { readerCalls: 0, answer: "no_intent", actionKinds: [], usage: null, contextTruncated: false, candidateMs: null, candidateMatchCount: null, candidatesTimedOut: false };
const fixedReading: LegacyReadingTrace = { ...noReading, answer: "fixed" };

/** The context of one reading: the products wanted by the message, its pendings and its order, within the ceilings. */
export async function legacyReadingContextOf(inputs: ReadingInputs, state: LegacyChatState, deps: LegacyReadingDependencies): Promise<Result<Readonly<{ context: ChatReadingContext; candidates: Pick<LegacyReadingTrace, "candidateMs" | "candidateMatchCount" | "candidatesTimedOut"> }>, PersistenceError | InvalidStoredData>> {
  const candidates = inputs.kind === "text" && inputs.text !== null ? await deps.findMessageCandidates(inputs.text) : null;
  if (candidates && !candidates.success) return candidates;
  const { limits } = deps;
  const selection = selectReadingProducts({ shown: inputs.shown, pendings: state.pendings.pendings,
    itemProductIds: listedItems(state.target, limits.maxReaderItems).flatMap(({ productId }) => (productId ? [productId] : [])),
    candidateIds: candidates?.data.productIds ?? [], maxProducts: limits.maxReaderProducts });
  const loaded = selection.productIds.length ? await deps.findProductsForReading(selection.productIds) : ok<readonly ProductForReading[]>([]);
  if (!loaded.success) return loaded;
  const timedOut = candidates?.data.timedOut ?? false;
  const context = buildReadingContext({ kind: inputs.kind, text: inputs.text, target: state.target, pendings: state.pendings.pendings, shown: inputs.shown,
    productIds: selection.productIds, found: loaded.data, truncated: selection.truncated || timedOut, maxItems: limits.maxReaderItems });
  return ok({ context, candidates: { candidateMs: candidates?.data.durationMs ?? null, candidateMatchCount: candidates?.data.matchCount ?? null, candidatesTimedOut: timedOut } });
}

const actionKindsOf = (answer: ReaderAnswer) => (answer.kind === "actions" ? answer.actions.map(({ kind }) => kind) : []);

/** One reader call, or the photo's fixed answer when there is nothing to read. */
export async function legacyAnswerFor(context: ChatReadingContext, deps: LegacyReadingDependencies, meta: Readonly<{ companyId: CompanyId; messageId: ChatMessageId }>, signal: AbortSignal,
  candidates: Pick<LegacyReadingTrace, "candidateMs" | "candidateMatchCount" | "candidatesTimedOut">): Promise<Result<LegacyAnswered, ReaderError>> {
  const base = { contextTruncated: context.truncated, ...candidates };
  const caption = context.text;
  const reader = deps.readChatMessage;
  const tooLong = caption !== null && caption.length > deps.limits.maxReaderTextChars;
  if (context.kind === "photo_product" && (caption === null || !reader || tooLong)) {
    return ok({ answer: fixedShownAnswer(context), captionDoubt: tooLong && reader !== null, trace: { ...fixedReading, ...base } });
  }
  if (!reader || caption === null || tooLong) return ok({ answer: { kind: "no_intent" }, captionDoubt: false, trace: { ...noReading, ...base } });
  if (signal.aborted) return { success: false, error: { code: "DEADLINE_EXCEEDED", message: "The attempt deadline passed" } };
  const reading = await reader(context, meta, signal);
  if (!reading.success) return reading;
  const { answer, usage } = reading.data;
  return ok({ answer, captionDoubt: false, trace: { readerCalls: 1, answer: answer.kind, actionKinds: actionKindsOf(answer), usage, ...base } });
}
