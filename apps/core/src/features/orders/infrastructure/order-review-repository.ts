import { z } from "zod";
import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma, requireActiveTransaction } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import { pendingsSnapshotSchema, type ChatPending } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { ChangeSeq, OrderItemChange, OrderItemChangeId, OrderReviewId } from "@core/src/features/orders/domain/message-changes";
import type { OrderId, UserId } from "@core/src/features/orders/domain/order";
import type { MessageRowSource, OrderLinkActionId, PointKey } from "@core/src/features/orders/domain/order-review";
import type { StoredReview } from "@core/src/features/orders/application/confirm-order-review";
import type { OrderChanges } from "@core/src/features/orders/application/load-order-review";
import { parseChangeRow } from "@core/src/features/orders/infrastructure/message-change-repository";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type InvalidStoredData = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;
type ReadError = PersistenceError | InvalidStoredData;

/** The newest rows «Cambios por mensajes» shows before «Ver más». */
export const reviewMessageRows = 5;

const unavailable = (event: string, cause: unknown, message: string): Result<never, PersistenceError> => {
  if (!isPersistenceFailure(cause)) throw cause;
  log.error({ event, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, event);
  return err({ code: "PERSISTENCE_UNAVAILABLE", message });
};

const changeColumns = Prisma.sql`id, "orderId", "messageId", position, seq, kind::text AS kind, before, after, decision::text AS decision, doubt, "quoteId", "supersededById", "reviewId",
  verdict::text AS verdict, "verdictAt", "createdAt"`;
type ChangeRow = Parameters<typeof parseChangeRow>[0];

function parseChanges(rows: readonly ChangeRow[]): Result<readonly OrderItemChange[], InvalidStoredData> {
  const changes: OrderItemChange[] = [];
  for (const row of rows) {
    const parsed = parseChangeRow(row);
    if (!parsed.success) return parsed;
    changes.push(parsed.data);
  }
  return ok(changes);
}

const pendingsOf = (value: unknown, messageId: string): Result<readonly ChatPending[], InvalidStoredData> => {
  if (value === null || value === undefined) return ok([]);
  const parsed = pendingsSnapshotSchema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  log.error({ event: "invalid_stored_message_pendings", companyId: getCompanyId(), messageId }, "invalid_stored_message_pendings");
  return err({ code: "INVALID_STORED_DATA", message: "Invalid stored message pendings" });
};

/**
 * Everything a review reads about the order's changes. The unreviewed set comes from the partial index; the message rows are the newest five (or all)
 * `OrderMessage` of the order with change rows or a pending diff, and their JSON snapshots are read only for those.
 */
export async function findOrderChanges(orderId: OrderId, options: Readonly<{ allRows: boolean }>): Promise<Result<OrderChanges, ReadError>> {
  const companyId = getCompanyId();
  try {
    const unreviewedRows = await prisma.$queryRaw<ChangeRow[]>`SELECT ${changeColumns} FROM "OrderItemChange"
      WHERE "companyId" = ${companyId}::uuid AND "orderId" = ${orderId}::uuid AND verdict IS NULL AND "supersededById" IS NULL AND "reviewId" IS NULL ORDER BY seq`;
    const [last] = await prisma.$queryRaw<Array<{ seq: number }>>`SELECT seq FROM "OrderItemChange" WHERE "companyId" = ${companyId}::uuid AND "orderId" = ${orderId}::uuid ORDER BY seq DESC LIMIT 1`;
    const review = await prisma.orderReview.findFirst({ where: { companyId, orderId }, select: { id: true } });
    const hasRows = Prisma.sql`("pendingsBefore" IS NOT NULL OR "pendingsAfter" IS NOT NULL OR EXISTS (SELECT 1 FROM "OrderItemChange" c
      WHERE c."companyId" = m."companyId" AND c."orderId" = m."orderId" AND c."messageId" = m."messageId"))`;
    const messages = await prisma.$queryRaw<Array<{ messageId: string; createdAt: Date; undoneAt: Date | null; pendingsBefore: unknown; pendingsAfter: unknown }>>`
      SELECT "messageId", "createdAt", "undoneAt", "pendingsBefore", "pendingsAfter" FROM "OrderMessage" m
      WHERE "companyId" = ${companyId}::uuid AND "orderId" = ${orderId}::uuid AND ${hasRows} ORDER BY "createdAt" DESC, "messageId" DESC ${options.allRows ? Prisma.empty : Prisma.sql`LIMIT ${reviewMessageRows}`}`;
    const [total] = options.allRows ? [{ count: BigInt(messages.length) }] : await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "OrderMessage" m
      WHERE "companyId" = ${companyId}::uuid AND "orderId" = ${orderId}::uuid AND ${hasRows}`;
    const messageIds = messages.map((message) => message.messageId);
    const rowChanges = messageIds.length === 0 ? [] : await prisma.$queryRaw<ChangeRow[]>`SELECT ${changeColumns} FROM "OrderItemChange"
      WHERE "companyId" = ${companyId}::uuid AND "orderId" = ${orderId}::uuid AND "messageId" = ANY(${messageIds}::uuid[]) ORDER BY seq`;
    const oldest = messages.at(-1);
    const laterRows = !oldest ? [] : await prisma.$queryRaw<ChangeRow[]>`SELECT ${changeColumns} FROM "OrderItemChange" c
      WHERE c."companyId" = ${companyId}::uuid AND c."orderId" = ${orderId}::uuid AND c."createdAt" >= ${oldest.createdAt}::timestamptz
        AND NOT EXISTS (SELECT 1 FROM "OrderMessage" m WHERE m."companyId" = c."companyId" AND m."messageId" = c."messageId" AND m."undoneAt" IS NOT NULL) ORDER BY seq`;
    const [unreviewed, changes, later] = [parseChanges(unreviewedRows), parseChanges(rowChanges), parseChanges(laterRows)];
    if (!unreviewed.success) return unreviewed;
    if (!changes.success) return changes;
    if (!later.success) return later;
    const rows: MessageRowSource[] = [];
    for (const message of messages) {
      const [before, after] = [pendingsOf(message.pendingsBefore, message.messageId), pendingsOf(message.pendingsAfter, message.messageId)];
      if (!before.success) return before;
      if (!after.success) return after;
      rows.push({ messageId: message.messageId as ChatMessageId, at: message.createdAt, undoneAt: message.undoneAt, changes: changes.data.filter((change) => change.messageId === message.messageId),
        pendingsBefore: before.data, pendingsAfter: after.data });
    }
    return ok({ unreviewed: unreviewed.data, lastSeq: (last?.seq ?? 0) as ChangeSeq, hasPreviousReview: review !== null, rows, moreRows: Math.max(0, Number(total?.count ?? 0) - rows.length), laterChanges: later.data });
  } catch (cause) {
    return unavailable("unable_to_read_order_changes", cause, "Unable to read order changes");
  }
}

/** Every change of the order past the high-water mark, whatever its verdict, supersession or undone state. */
export async function findChangesAfter(orderId: OrderId, afterSeq: number): Promise<Result<readonly OrderItemChange[], ReadError>> {
  const companyId = getCompanyId();
  try {
    return parseChanges(await prisma.$queryRaw<ChangeRow[]>`SELECT ${changeColumns} FROM "OrderItemChange"
      WHERE "companyId" = ${companyId}::uuid AND "orderId" = ${orderId}::uuid AND seq > ${afterSeq}::int ORDER BY seq`);
  } catch (cause) {
    return unavailable("unable_to_read_changes_after", cause, "Unable to read order changes");
  }
}

/** The changes with these ids that belong to the order; an id of another order or company is absent. */
export async function findChangesByIds(orderId: OrderId, ids: readonly OrderItemChangeId[]): Promise<Result<readonly OrderItemChange[], ReadError>> {
  const companyId = getCompanyId();
  if (ids.length === 0) return ok([]);
  try {
    return parseChanges(await prisma.$queryRaw<ChangeRow[]>`SELECT ${changeColumns} FROM "OrderItemChange"
      WHERE "companyId" = ${companyId}::uuid AND "orderId" = ${orderId}::uuid AND id = ANY(${[...ids]}::uuid[]) ORDER BY seq`);
  } catch (cause) {
    return unavailable("unable_to_read_changes_by_id", cause, "Unable to read order changes");
  }
}

/** The order of the chat that was created last: a top-1 read of `(companyId, chatId, createdAt DESC)`. */
export async function findLatestChatOrder(chatId: ChatId): Promise<Result<OrderId | null, PersistenceError>> {
  const companyId = getCompanyId();
  try {
    const latest = await prisma.order.findFirst({ where: { companyId, chatId }, orderBy: { createdAt: "desc" }, select: { id: true } });
    return ok((latest?.id ?? null) as OrderId | null);
  } catch (cause) {
    return unavailable("unable_to_read_latest_chat_order", cause, "Unable to read the chat's orders");
  }
}

const shownPointsSchema = z.array(z.strictObject({ pendingId: z.uuid(), since: z.iso.datetime() }));

export function pointsToJson(points: readonly PointKey[]): Prisma.InputJsonValue {
  return points.map((point) => ({ pendingId: point.pendingId, since: point.since.toISOString() }));
}

export async function findReview(reviewId: OrderReviewId): Promise<Result<StoredReview | null, ReadError>> {
  const companyId = getCompanyId();
  try {
    const row = await prisma.orderReview.findFirst({ where: { companyId, id: reviewId } });
    if (!row) return ok(null);
    const shown = shownPointsSchema.safeParse(row.shownPoints);
    if (!shown.success) {
      log.error({ event: "invalid_stored_order_review", companyId, reviewId }, "invalid_stored_order_review");
      return err({ code: "INVALID_STORED_DATA", message: "Invalid stored order review" });
    }
    return ok({ id: row.id as OrderReviewId, orderId: row.orderId as OrderId, origin: row.origin, correctedItems: row.correctedItems, changesThrough: row.changesThrough as ChangeSeq,
      confirmedThrough: row.confirmedThrough as ChangeSeq, confirmedAt: row.confirmedAt,
      shownPoints: shown.data.map((point) => ({ pendingId: point.pendingId as PointKey["pendingId"], since: new Date(point.since) })) });
  } catch (cause) {
    return unavailable("unable_to_read_order_review", cause, "Unable to read the order review");
  }
}

/** A `reviewId` that already belongs to another order or company hits the global primary key: it is invalid input, not an outage. */
export async function saveReview(review: StoredReview, reviewedById: UserId): Promise<Result<null, PersistenceError | Readonly<{ code: "INVALID_INPUT"; message: string }>>> {
  const companyId = getCompanyId();
  requireActiveTransaction(companyId);
  try {
    await prisma.orderReview.create({ data: { id: review.id, companyId, orderId: review.orderId, reviewedById, origin: review.origin, shownPoints: pointsToJson(review.shownPoints),
      correctedItems: review.correctedItems, changesThrough: review.changesThrough, confirmedThrough: review.confirmedThrough, confirmedAt: review.confirmedAt } });
    return ok(null);
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") return err({ code: "INVALID_INPUT", message: "The review id is already used" });
    return unavailable("unable_to_save_order_review", cause, "Unable to save the order review");
  }
}

/** The shown changes get the review and, when nothing judged them yet, `kept`. One statement; a verdict an edit already gave stays. */
export async function markChangesReviewed(orderId: OrderId, reviewId: OrderReviewId, ids: readonly OrderItemChangeId[], at: Date): Promise<Result<null, PersistenceError>> {
  const companyId = getCompanyId();
  requireActiveTransaction(companyId);
  if (ids.length === 0) return ok(null);
  try {
    await prisma.$executeRaw`UPDATE "OrderItemChange" SET "reviewId" = COALESCE("reviewId", ${reviewId}::uuid), verdict = COALESCE(verdict, 'kept'::"OrderItemChangeVerdict"), "verdictAt" = COALESCE("verdictAt", ${at}::timestamptz)
      WHERE "companyId" = ${companyId}::uuid AND "orderId" = ${orderId}::uuid AND id = ANY(${[...ids]}::uuid[])`;
    return ok(null);
  } catch (cause) {
    return unavailable("unable_to_mark_changes_reviewed", cause, "Unable to mark the changes reviewed");
  }
}

/** Completion and cancellation fix `not_reviewed` on whatever nobody judged, superseded rows included: one set-based statement. */
export async function settleUnreviewedChanges(orderId: OrderId, at: Date): Promise<Result<null, PersistenceError>> {
  const companyId = getCompanyId();
  requireActiveTransaction(companyId);
  try {
    await prisma.$executeRaw`UPDATE "OrderItemChange" SET verdict = 'not_reviewed'::"OrderItemChangeVerdict", "verdictAt" = ${at}::timestamptz
      WHERE "companyId" = ${companyId}::uuid AND "orderId" = ${orderId}::uuid AND verdict IS NULL`;
    return ok(null);
  } catch (cause) {
    return unavailable("unable_to_settle_unreviewed_changes", cause, "Unable to settle the order changes");
  }
}

/** A repeated id succeeds without writing. It takes no order lock: the window is accepted (design section 11). */
export async function saveLinkAction(action: Readonly<{ id: OrderLinkActionId; orderId: OrderId; userId: UserId; action: "copy" | "share" | "open"; reviewId: OrderReviewId | null; takenAt: Date }>):
  Promise<Result<null, PersistenceError>> {
  const companyId = getCompanyId();
  try {
    await prisma.orderLinkAction.createMany({ data: [{ id: action.id, companyId, orderId: action.orderId, userId: action.userId, action: action.action, reviewId: action.reviewId, takenAt: action.takenAt }], skipDuplicates: true });
    return ok(null);
  } catch (cause) {
    return unavailable("unable_to_save_link_action", cause, "Unable to save the link action");
  }
}

/** Two single-row reads under the order lock: the order is armed when the latest link action is later than the latest message that already told the seller it changed. */
export async function findLinkNoticeArming(orderId: OrderId): Promise<Result<boolean, PersistenceError>> {
  const companyId = getCompanyId();
  try {
    const action = await prisma.orderLinkAction.findFirst({ where: { companyId, orderId }, orderBy: { takenAt: "desc" }, select: { takenAt: true } });
    if (!action) return ok(false);
    const notice = await prisma.orderMessage.findFirst({ where: { companyId, orderId, linkChangeNotice: true }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    return ok(!notice || action.takenAt.getTime() > notice.createdAt.getTime());
  } catch (cause) {
    return unavailable("unable_to_read_link_notice_arming", cause, "Unable to read the link actions");
  }
}

export type ReviewListFacts = Readonly<{ unreviewed: ReadonlyMap<OrderId, readonly OrderItemChange[]>; pendings: ReadonlyMap<ChatId, readonly ChatPending[]>; latestByChat: ReadonlyMap<ChatId, OrderId>;
  reviewed: ReadonlySet<OrderId> }>;

/**
 * The batched read of the order lists, one query per fact for the whole page: unreviewed changes on the partial index, the chats' pendings,
 * the latest order of each listed chat (a top-1 per chat) and which orders have a review.
 */
export async function findReviewListFacts(orderIds: readonly OrderId[], chatIds: readonly ChatId[]): Promise<Result<ReviewListFacts, ReadError>> {
  const companyId = getCompanyId();
  if (orderIds.length === 0) return ok({ unreviewed: new Map(), pendings: new Map(), latestByChat: new Map(), reviewed: new Set() });
  try {
    const rows = await prisma.$queryRaw<ChangeRow[]>`SELECT ${changeColumns} FROM "OrderItemChange"
      WHERE "companyId" = ${companyId}::uuid AND "orderId" = ANY(${[...orderIds]}::uuid[]) AND verdict IS NULL AND "supersededById" IS NULL AND "reviewId" IS NULL ORDER BY seq`;
    const changes = parseChanges(rows);
    if (!changes.success) return changes;
    const unreviewed = new Map<OrderId, OrderItemChange[]>();
    for (const change of changes.data) unreviewed.set(change.orderId, [...(unreviewed.get(change.orderId) ?? []), change]);
    const stored = chatIds.length === 0 ? [] : await prisma.chatPendings.findMany({ where: { companyId, chatId: { in: [...chatIds] } }, select: { chatId: true, pendings: true } });
    const pendings = new Map<ChatId, readonly ChatPending[]>();
    for (const row of stored) {
      const parsed = pendingsSnapshotSchema.safeParse(row.pendings);
      if (!parsed.success) {
        log.error({ event: "invalid_stored_chat_pendings", companyId, chatId: row.chatId }, "invalid_stored_chat_pendings");
        return err({ code: "INVALID_STORED_DATA", message: "Invalid stored chat pendings" });
      }
      pendings.set(row.chatId as ChatId, parsed.data);
    }
    const latest = chatIds.length === 0 ? [] : await prisma.$queryRaw<Array<{ chatId: string; id: string }>>`SELECT DISTINCT ON ("chatId") "chatId", id FROM "Order"
      WHERE "companyId" = ${companyId}::uuid AND "chatId" = ANY(${[...chatIds]}::uuid[]) ORDER BY "chatId", "createdAt" DESC`;
    const reviews = await prisma.orderReview.findMany({ where: { companyId, orderId: { in: [...orderIds] } }, select: { orderId: true }, distinct: ["orderId"] });
    return ok({ unreviewed, pendings, latestByChat: new Map(latest.map((row) => [row.chatId as ChatId, row.id as OrderId])), reviewed: new Set(reviews.map((row) => row.orderId as OrderId)) });
  } catch (cause) {
    return unavailable("unable_to_read_review_list_facts", cause, "Unable to read the order review facts");
  }
}
