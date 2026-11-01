import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import type { ChatSourceMessage } from "@core/src/features/orders/application/chat-source-message";
import type { ReaderUsage, ReadChatMessage } from "@core/src/features/orders/application/read-chat-message";
import { buildReadingContext, listedItems, selectReadingProducts } from "@core/src/features/orders/application/reading-context";
import type { LegacyShadowReader } from "@core/src/features/orders/application/reader/trace-ports";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order-target";
import { pendingLife, type ChatPendings } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatReadingContext, ReaderAnswer } from "@core/src/features/orders/domain/chat-reading";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { TraceShadow } from "@core/src/features/orders/domain/reader/trace";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type InvalidStoredData = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;
type StateError = PersistenceError | InvalidStoredData;

export type LegacyShadowReaderDependencies = Readonly<{
  /** The legacy single reader; null without a model provider, and then there is no shadow. */
  readChatMessage: ReadChatMessage;
  findChatOrderTarget: (chatId: ChatId) => Promise<Result<ChatOrderTarget, StateError>>;
  findChatOrdersOpenedSince: (chatId: ChatId, since: Date) => Promise<Result<readonly OrderAggregate[], StateError>>;
  findChatPendings: (chatId: ChatId) => Promise<Result<ChatPendings, StateError>>;
  findProductsForReading: (productIds: readonly ProductId[]) => Promise<Result<readonly ProductForReading[], StateError>>;
  /** A statement timeout is not an error: it returns no ids with timedOut true. */
  findMessageCandidates: (text: string) => Promise<Result<Readonly<{ productIds: readonly ProductId[]; matchCount: number; durationMs: number; timedOut: boolean }>, PersistenceError>>;
  /** Dollars of one call's usage; null when the model has no price. */
  costOf: (usage: ReaderUsage) => number | null;
  clock: () => Date;
  limits: Readonly<{ pendingTtlMs: number; maxReaderProducts: number; maxReaderItems: number; maxReaderTextChars: number }>;
}>;

type ChatState = Readonly<{ target: ChatOrderTarget; pendings: ChatPendings }>;
type Failure = Readonly<{ code: string; message: string }>;

/** The chat's order and its alive pendings as the reader sees them, read without locks. */
async function loadChatState(chatId: ChatId, deps: LegacyShadowReaderDependencies): Promise<Result<ChatState, StateError>> {
  const target = await deps.findChatOrderTarget(chatId);
  if (!target.success) return target;
  const stored = await deps.findChatPendings(chatId);
  if (!stored.success) return stored;
  const orderless = stored.data.pendings.filter((pending) => !pending.order);
  const opened = orderless.length
    ? await deps.findChatOrdersOpenedSince(chatId, new Date(Math.min(...orderless.map((pending) => pending.lastChangedAt.getTime())))) : ok<readonly OrderAggregate[]>([]);
  if (!opened.success) return opened;
  const life = pendingLife(stored.data, { target: target.data, openedSince: opened.data }, deps.clock(), deps.limits.pendingTtlMs);
  return ok({ target: target.data, pendings: { ...stored.data, pendings: life.alive } });
}

/** The context of one text reading: the products wanted by the message, its pendings and its order, within the ceilings. */
async function readingContextOf(text: string, state: ChatState, deps: LegacyShadowReaderDependencies): Promise<Result<ChatReadingContext, StateError>> {
  const candidates = await deps.findMessageCandidates(text);
  if (!candidates.success) return candidates;
  const { limits } = deps;
  const selection = selectReadingProducts({ shown: [], pendings: state.pendings.pendings,
    itemProductIds: listedItems(state.target, limits.maxReaderItems).flatMap(({ productId }) => (productId ? [productId] : [])),
    candidateIds: candidates.data.productIds, maxProducts: limits.maxReaderProducts });
  const loaded = selection.productIds.length ? await deps.findProductsForReading(selection.productIds) : ok<readonly ProductForReading[]>([]);
  if (!loaded.success) return loaded;
  return ok(buildReadingContext({ kind: "text", text, target: state.target, pendings: state.pendings.pendings, shown: [], productIds: selection.productIds, found: loaded.data,
    truncated: selection.truncated || candidates.data.timedOut, maxItems: limits.maxReaderItems }));
}

const actionKindsOf = (answer: ReaderAnswer) => (answer.kind === "actions" ? answer.actions.map(({ kind }) => kind) : []);

/** Photos have no shadow (it would repeat the image reading), and neither do texts the legacy path never read. */
const isShadowed = (message: ChatSourceMessage, maxChars: number): message is ChatSourceMessage & Readonly<{ text: string }> =>
  message.imageId === null && message.text !== null && message.text.trim() !== "" && message.text.length <= maxChars;

/**
 * The legacy single reader beside the staged one, for the trace only. It reads the chat's state itself (unlocked), makes one legacy model call
 * and answers its answer kind, action kinds and usage; it never applies anything. It never rejects: a failure, or an abort of `signal`, logs
 * `reader_shadow_failed` and answers null. T17 deletes it.
 */
export function createLegacyShadowReader(deps: LegacyShadowReaderDependencies): LegacyShadowReader {
  return async (message, signal) => {
    const started = Date.now();
    const failed = (errorCode: string, cause?: unknown): null => {
      log.warn({ event: "reader_shadow_failed", companyId: message.companyId, messageId: message.id, errorCode, durationMs: Date.now() - started, ...(cause ? { err: cause } : {}) }, "reader_shadow_failed");
      return null;
    };
    const failure = (error: Failure): null => failed(error.code);
    try {
      if (!isShadowed(message, deps.limits.maxReaderTextChars)) return null;
      if (signal.aborted) return failed("DEADLINE_EXCEEDED");
      const state = await loadChatState(message.chatId, deps);
      if (!state.success) return failure(state.error);
      const context = await readingContextOf(message.text, state.data, deps);
      if (!context.success) return failure(context.error);
      if (signal.aborted) return failed("DEADLINE_EXCEEDED");
      const reading = await deps.readChatMessage(context.data, { companyId: message.companyId, messageId: message.id }, signal);
      if (!reading.success) return failure(reading.error);
      const { answer, usage } = reading.data;
      return { answer: answer.kind, actionKinds: actionKindsOf(answer), usage, costUsd: deps.costOf(usage) } satisfies TraceShadow;
    } catch (cause) {
      return failed("SHADOW_THREW", cause);
    }
  };
}

/** The wait after commit: the shadow's result, or null once `waitMs` passed (the shadow is then abandoned). Never rejects. */
export async function awaitShadow(shadow: Promise<TraceShadow | null>, waitMs: number): Promise<Readonly<{ shadow: TraceShadow | null; waitedMs: number }>> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, waitMs)); });
  const result = await Promise.race([shadow.catch((): null => null), bound]);
  clearTimeout(timer);
  return { shadow: result, waitedMs: Date.now() - started };
}

