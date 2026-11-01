import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma, requireActiveTransaction } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import { pendingsSnapshotSchema, type ChatPending } from "@core/src/features/orders/domain/chat-pendings";
import { lineSnapshotSchema, type ChangeSeq, type ChangeVerdict, type MessageChanges, type OrderItemChange, type OrderItemChangeId, type OrderItemChangeKind } from "@core/src/features/orders/domain/message-changes";
import type { CompanyId, OrderId, OrderItemId, UserId } from "@core/src/features/orders/domain/order";
import { doubtReasonSchema } from "@core/src/features/orders/domain/reader/decision";
import type { QuoteId } from "@core/src/features/orders/domain/reader/refs";
import type { EditVerdicts } from "@core/src/features/orders/application/apply-items-edit";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type InvalidStoredData = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

type ChangeRow = Readonly<{ id: string; orderId: string; messageId: string; position: number; seq: number; kind: string; before: unknown; after: unknown; decision: string; doubt: unknown;
  quoteId: number | null; supersededById: string | null; reviewId: string | null; verdict: string | null; verdictAt: Date | null; createdAt: Date }>;

/** A stored change whose JSON does not parse is invalid stored data. */
export function parseChangeRow(row: ChangeRow): Result<OrderItemChange, InvalidStoredData> {
  const before = row.before === null ? null : lineSnapshotSchema.safeParse(row.before);
  const after = row.after === null ? null : lineSnapshotSchema.safeParse(row.after);
  const doubt = row.decision === "doubtful" ? doubtReasonSchema.safeParse(row.doubt) : null;
  if ((before && !before.success) || (after && !after.success) || (doubt && !doubt.success) || (row.verdict === null) !== (row.verdictAt === null)) {
    log.error({ event: "invalid_stored_order_item_change", companyId: getCompanyId(), changeId: row.id }, "invalid_stored_order_item_change");
    return err({ code: "INVALID_STORED_DATA", message: "Invalid stored order item change" });
  }
  return ok({ id: row.id as OrderItemChangeId, orderId: row.orderId as OrderId, messageId: row.messageId as ChatMessageId, position: row.position, seq: row.seq as ChangeSeq,
    kind: row.kind as OrderItemChangeKind, before: before?.success ? before.data : null, after: after?.success ? after.data : null,
    decision: doubt?.success ? { kind: "doubtful", reason: doubt.data } : { kind: "applied" }, quoteId: row.quoteId as QuoteId | null, supersededBy: row.supersededById as OrderItemChangeId | null,
    reviewId: row.reviewId as OrderItemChange["reviewId"], verdict: row.verdict && row.verdictAt ? { kind: row.verdict as ChangeVerdict, at: row.verdictAt } : null, createdAt: row.createdAt });
}

function parseRows(rows: readonly ChangeRow[]): Result<readonly OrderItemChange[], InvalidStoredData> {
  const changes: OrderItemChange[] = [];
  for (const row of rows) {
    const parsed = parseChangeRow(row);
    if (!parsed.success) return parsed;
    changes.push(parsed.data);
  }
  return ok(changes);
}

function unavailable(event: string, cause: unknown, message: string): Result<never, PersistenceError> {
  if (!isPersistenceFailure(cause)) throw cause;
  log.error({ event, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, event);
  return err({ code: "PERSISTENCE_UNAVAILABLE", message });
}

/** Part of the message transaction, after the `OrderMessage` row exists: the change rows in one insert, the supersessions in one update and the pendings the message touched. */
export async function saveMessageChanges(changes: MessageChanges): Promise<Result<null, PersistenceError>> {
  const companyId = getCompanyId();
  requireActiveTransaction(companyId);
  try {
    if (changes.changes.length > 0) {
      await prisma.orderItemChange.createMany({ data: changes.changes.map((change) => ({ id: change.id, companyId, orderId: change.orderId, messageId: change.messageId,
        position: change.position, seq: change.seq, kind: change.kind, itemId: (change.after ?? change.before)!.itemId,
        before: change.before ? json(change.before) : Prisma.DbNull, after: change.after ? json(change.after) : Prisma.DbNull,
        decision: change.decision.kind, doubt: change.decision.kind === "doubtful" ? json(change.decision.reason) : Prisma.DbNull,
        quoteId: change.quoteId, createdAt: change.createdAt })) });
    }
    if (changes.supersedes.length > 0) {
      await prisma.$executeRaw`UPDATE "OrderItemChange" old SET "supersededById" = n.id
        FROM "OrderItemChange" n
        WHERE old."companyId" = ${companyId}::uuid AND old."orderId" = ${changes.orderId}::uuid AND old.id = ANY(${[...changes.supersedes]}::uuid[])
          AND n."companyId" = old."companyId" AND n."orderId" = old."orderId" AND n."messageId" = ${changes.messageId}::uuid AND n."itemId" = old."itemId"`;
    }
    if (changes.pendingsBefore.length > 0 || changes.pendingsAfter.length > 0) {
      await prisma.orderMessage.update({ where: { companyId_messageId: { companyId, messageId: changes.messageId } },
        data: { pendingsBefore: json(changes.pendingsBefore), pendingsAfter: json(changes.pendingsAfter) } });
    }
    return ok(null);
  } catch (cause) {
    return unavailable("unable_to_save_message_changes", cause, "Unable to save message changes");
  }
}

const changeColumns = Prisma.sql`id, "orderId", "messageId", position, seq, kind::text AS kind, before, after, decision::text AS decision, doubt, "quoteId", "supersededById", "reviewId",
  verdict::text AS verdict, "verdictAt", "createdAt"`;

/** The order's changes that no one judged and no message superseded (the partial index), and its highest `seq`. Plain reads: their writers hold the order lock. */
export async function findUnverdictedChanges(orderId: OrderId): Promise<Result<Readonly<{ open: readonly OrderItemChange[]; lastSeq: number }>, PersistenceError | InvalidStoredData>> {
  const companyId = getCompanyId();
  try {
    const rows = await prisma.$queryRaw<ChangeRow[]>`SELECT ${changeColumns} FROM "OrderItemChange"
      WHERE "companyId" = ${companyId}::uuid AND "orderId" = ${orderId}::uuid AND verdict IS NULL AND "supersededById" IS NULL ORDER BY seq`;
    const [last] = await prisma.$queryRaw<Array<{ seq: number }>>`SELECT seq FROM "OrderItemChange" WHERE "companyId" = ${companyId}::uuid AND "orderId" = ${orderId}::uuid ORDER BY seq DESC LIMIT 1`;
    const parsed = parseRows(rows);
    return parsed.success ? ok({ open: parsed.data, lastSeq: last?.seq ?? 0 }) : parsed;
  } catch (cause) {
    return unavailable("unable_to_read_unverdicted_changes", cause, "Unable to read order changes");
  }
}

export type StoredMessageChanges = Readonly<{ messageId: ChatMessageId; at: Date; undoneAt: Date | null; changes: readonly OrderItemChange[];
  pendingsBefore: readonly ChatPending[]; pendingsAfter: readonly ChatPending[] }>;

function parsePendings(value: unknown, messageId: string): Result<readonly ChatPending[], InvalidStoredData> {
  if (value === null || value === undefined) return ok([]);
  const parsed = pendingsSnapshotSchema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  log.error({ event: "invalid_stored_message_pendings", companyId: getCompanyId(), messageId }, "invalid_stored_message_pendings");
  return err({ code: "INVALID_STORED_DATA", message: "Invalid stored message pendings" });
}

/** The message of the order, its change rows and the pendings it touched; null when the order has no such message. */
export async function findMessageChanges(orderId: OrderId, messageId: ChatMessageId): Promise<Result<StoredMessageChanges | null, PersistenceError | InvalidStoredData>> {
  const companyId = getCompanyId();
  try {
    const message = await prisma.orderMessage.findFirst({ where: { companyId, orderId, messageId } });
    if (!message) return ok(null);
    const rows = await prisma.$queryRaw<ChangeRow[]>`SELECT ${changeColumns} FROM "OrderItemChange"
      WHERE "companyId" = ${companyId}::uuid AND "orderId" = ${orderId}::uuid AND "messageId" = ${messageId}::uuid ORDER BY seq`;
    const changes = parseRows(rows);
    if (!changes.success) return changes;
    const [before, after] = [parsePendings(message.pendingsBefore, messageId), parsePendings(message.pendingsAfter, messageId)];
    if (!before.success) return before;
    if (!after.success) return after;
    return ok({ messageId, at: message.createdAt, undoneAt: message.undoneAt, changes: changes.data, pendingsBefore: before.data, pendingsAfter: after.data });
  } catch (cause) {
    return unavailable("unable_to_read_message_changes", cause, "Unable to read message changes");
  }
}

/** The order's changes with `seq` after the given one, whatever their message or verdict. */
export async function findLaterChanges(orderId: OrderId, afterSeq: number): Promise<Result<readonly OrderItemChange[], PersistenceError | InvalidStoredData>> {
  const companyId = getCompanyId();
  try {
    const rows = await prisma.$queryRaw<ChangeRow[]>`SELECT ${changeColumns} FROM "OrderItemChange"
      WHERE "companyId" = ${companyId}::uuid AND "orderId" = ${orderId}::uuid AND seq > ${afterSeq}::int ORDER BY seq`;
    return parseRows(rows);
  } catch (cause) {
    return unavailable("unable_to_read_later_changes", cause, "Unable to read order changes");
  }
}

/** Undo is idempotent through `undoneAt`: only a message that is not undone yet is marked. */
export async function markMessageUndone(orderId: OrderId, messageId: ChatMessageId, userId: UserId, at: Date): Promise<Result<null, PersistenceError>> {
  const companyId = getCompanyId();
  requireActiveTransaction(companyId);
  try {
    const marked = await prisma.orderMessage.updateMany({ where: { companyId, orderId, messageId, undoneAt: null }, data: { undoneAt: at, undoneById: userId } });
    if (marked.count !== 1) throw new Error("Locked message was not available for undo");
    return ok(null);
  } catch (cause) {
    return unavailable("unable_to_mark_message_undone", cause, "Unable to mark the message undone");
  }
}

/** `undone` replaces `kept`, `quantity_changed` and `removed`, and fills an empty verdict; `not_reviewed` and an earlier `undone` stay. One statement. */
export async function setUndoneVerdicts(orderId: OrderId, messageId: ChatMessageId, at: Date): Promise<Result<null, PersistenceError>> {
  const companyId = getCompanyId();
  requireActiveTransaction(companyId);
  try {
    await prisma.$executeRaw`UPDATE "OrderItemChange" SET verdict = 'undone', "verdictAt" = ${at}::timestamptz
      WHERE "companyId" = ${companyId}::uuid AND "orderId" = ${orderId}::uuid AND "messageId" = ${messageId}::uuid
        AND (verdict IS NULL OR verdict IN ('kept', 'quantity_changed', 'removed'))`;
    return ok(null);
  } catch (cause) {
    return unavailable("unable_to_set_undone_verdicts", cause, "Unable to set the undo verdicts");
  }
}

/** An edit gives its verdict to the unverdicted changes of the edited items, superseded ones included, one statement per verdict kind. The first verdict of a change stays. */
export async function setVerdictsForEdit(orderId: OrderId, companyId: CompanyId, verdicts: EditVerdicts, at: Date): Promise<Result<null, PersistenceError>> {
  requireActiveTransaction(companyId);
  try {
    for (const { verdict, itemIds } of verdicts) {
      await prisma.$executeRaw`UPDATE "OrderItemChange" SET verdict = ${verdict}::"OrderItemChangeVerdict", "verdictAt" = ${at}::timestamptz
        WHERE "companyId" = ${companyId}::uuid AND "orderId" = ${orderId}::uuid AND "itemId" = ANY(${[...itemIds] as OrderItemId[]}::uuid[]) AND verdict IS NULL`;
    }
    return ok(null);
  } catch (cause) {
    return unavailable("unable_to_set_edit_verdicts", cause, "Unable to set the edit verdicts");
  }
}

/** The last items edit, undo or confirmed review of the order, for the open questions. */
export async function saveSellerActedAt(orderId: OrderId, companyId: CompanyId, at: Date): Promise<Result<null, PersistenceError>> {
  requireActiveTransaction(companyId);
  try {
    await prisma.order.updateMany({ where: { id: orderId, companyId }, data: { sellerActedAt: at } });
    return ok(null);
  } catch (cause) {
    return unavailable("unable_to_save_seller_acted_at", cause, "Unable to save the seller action");
  }
}
