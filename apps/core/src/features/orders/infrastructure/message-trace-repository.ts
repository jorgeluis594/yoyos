import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { Prisma } from "@prisma/client";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma, requireActiveTransaction, systemPrisma } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CompanyId } from "@core/src/features/orders/domain/order";
import {
  traceDecisionsSchema, tracePhotoSchema, traceQuotesSchema, traceShadowSchema, traceStagesSchema,
  type MaskedText, type MessageTrace, type TraceQuote,
} from "@core/src/features/orders/domain/reader/trace";
import type { DeletedBatch } from "@core/src/features/orders/application/delete-expired-message-traces";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type InvalidStoredData = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;

const json = (value: unknown) => JSON.stringify(value);

/**
 * Upserts the trace by (company, message) and inserts the masks that are new, in one statement; a reprocess replaces the trace.
 * Every JSON column is parsed through its strict schema before it is written.
 */
export async function saveMessageTrace(trace: MessageTrace, masks: readonly MaskedText[]): Promise<Result<null, PersistenceError | InvalidStoredData>> {
  const companyId = getCompanyId();
  const photo = trace.photo === null ? ok(null) : parse(tracePhotoSchema, trace.photo);
  const shadow = trace.shadow === null ? ok(null) : parse(traceShadowSchema, trace.shadow);
  const stages = parse(traceStagesSchema, trace.stages);
  const quotes = parse(traceQuotesSchema, trace.quotes);
  const decisions = parse(traceDecisionsSchema, trace.decisions);
  if (!photo.success || !shadow.success || !stages.success || !quotes.success || !decisions.success)
    return err({ code: "INVALID_STORED_DATA", message: "Invalid message trace" });
  try {
    await prisma.$executeRaw`WITH saved AS (
        INSERT INTO "MessageTrace" ("companyId", "messageId", "messageReceivedAt", "expiresAt", "startedAt", "decidedAt", "queuedMs", "shadowWaitMs", "textState",
          "contextMessageIds", "photo", "stages", "quotes", "decisions", "shadow", "costUsd")
        VALUES (${companyId}::uuid, ${trace.messageId}::uuid, ${trace.messageReceivedAt}::timestamptz, ${trace.expiresAt}::timestamptz, ${trace.startedAt}::timestamptz,
          ${trace.decidedAt}::timestamptz, ${trace.queuedMs}, ${trace.shadowWaitMs}, ${trace.textState}::"MessageTraceTextState",
          ${trace.contextMessageIds as string[]}::uuid[], ${photo.data === null ? null : json(photo.data)}::jsonb, ${json(stages.data)}::jsonb, ${json(quotes.data)}::jsonb,
          ${json(decisions.data)}::jsonb, ${shadow.data === null ? null : json(shadow.data)}::jsonb, ${trace.costUsd})
        ON CONFLICT ("companyId", "messageId") DO UPDATE SET
          "messageReceivedAt" = EXCLUDED."messageReceivedAt", "expiresAt" = EXCLUDED."expiresAt", "startedAt" = EXCLUDED."startedAt", "decidedAt" = EXCLUDED."decidedAt",
          "queuedMs" = EXCLUDED."queuedMs", "shadowWaitMs" = EXCLUDED."shadowWaitMs", "textState" = EXCLUDED."textState", "contextMessageIds" = EXCLUDED."contextMessageIds",
          "photo" = EXCLUDED."photo", "stages" = EXCLUDED."stages", "quotes" = EXCLUDED."quotes", "decisions" = EXCLUDED."decisions", "shadow" = EXCLUDED."shadow",
          "costUsd" = EXCLUDED."costUsd", "createdAt" = now()
        RETURNING 1
      )
      INSERT INTO "MessageMaskedText" ("companyId", "messageId", "text", "expiresAt")
      SELECT ${companyId}::uuid, mask."messageId", mask."text", mask."expiresAt"
      FROM unnest(${masks.map((mask) => mask.messageId) as string[]}::uuid[], ${masks.map((mask) => mask.text)}::text[], ${masks.map((mask) => mask.expiresAt)}::timestamptz[])
        AS mask("messageId", "text", "expiresAt")
      ON CONFLICT ("companyId", "messageId") DO NOTHING`;
    return ok(null);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_message_trace", messageId: trace.messageId, err: cause }, "unable_to_save_message_trace");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to save message trace" });
  }
}

function parse<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }, value: unknown): Result<T, null> {
  const parsed = schema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err(null);
}

/** Reads only the `quotes` column, so a review request never loads stage outputs. A missing trace answers null. */
export async function findTraceQuotes(messageId: ChatMessageId): Promise<Result<readonly TraceQuote[] | null, PersistenceError | InvalidStoredData>> {
  try {
    const row = await prisma.messageTrace.findFirst({ where: { companyId: getCompanyId(), messageId }, select: { quotes: true } });
    if (!row) return ok(null);
    const quotes = traceQuotesSchema.safeParse(row.quotes);
    if (!quotes.success) {
      log.error({ event: "invalid_stored_message_trace", messageId }, "invalid_stored_message_trace");
      return err({ code: "INVALID_STORED_DATA", message: "Invalid stored message trace" });
    }
    return ok(quotes.data);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_find_trace_quotes", messageId, err: cause }, "unable_to_find_trace_quotes");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read message trace" });
  }
}

/** Definer function: returns only company ids, so each delete still runs under RLS. */
export async function listCompaniesWithExpiredMessageTraces(cutoff: Date): Promise<Result<readonly CompanyId[], PersistenceError>> {
  try {
    const rows = await systemPrisma.$queryRaw<{ companyId: string }[]>`SELECT public.companies_with_expired_message_traces(${cutoff}::timestamptz) AS "companyId"`;
    return ok(rows.map((row) => row.companyId as CompanyId));
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to list companies with expired message traces" });
  }
}

/** One batch of the company's expired traces and, apart, one of its expired masked texts: neither table depends on the other. */
export async function deleteExpiredMessageTraces(companyId: CompanyId, cutoff: Date, limit: number): Promise<Result<DeletedBatch, PersistenceError>> {
  requireActiveTransaction(companyId);
  try {
    const traces = await prisma.$executeRaw`DELETE FROM "MessageTrace" WHERE "companyId" = ${companyId}::uuid AND "messageId" IN (
        SELECT "messageId" FROM "MessageTrace" WHERE "companyId" = ${companyId}::uuid AND "expiresAt" < ${cutoff}::timestamptz ORDER BY "expiresAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)`;
    const texts = await prisma.$executeRaw`DELETE FROM "MessageMaskedText" WHERE "companyId" = ${companyId}::uuid AND "messageId" IN (
        SELECT "messageId" FROM "MessageMaskedText" WHERE "companyId" = ${companyId}::uuid AND "expiresAt" < ${cutoff}::timestamptz ORDER BY "expiresAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)`;
    return ok({ traces, texts });
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_delete_message_traces", companyId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "Unable to delete message traces");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to delete message traces" });
  }
}

export type MessageChangeVerdict = Readonly<{
  messageId: ChatMessageId; orderId: string; kind: string; decision: string; doubtKind: string | null; verdict: string | null; verdictAt: Date | null;
}>;
export type StoredMessageTraceRead = Readonly<{
  traces: readonly MessageTrace[];
  /** Masked texts that still exist, for the requested messages and for the context messages their traces reference. */
  texts: readonly MaskedText[];
  verdicts: readonly MessageChangeVerdict[];
}>;

export type TraceReadAudit = Readonly<{ readerName: string; osUser: string; messageIds: readonly ChatMessageId[] }>;

/** Part of one tenant transaction: the audit row is written first, so a failed audit reads nothing. */
export async function readAuditedMessageTraces(audit: TraceReadAudit): Promise<Result<StoredMessageTraceRead, PersistenceError | InvalidStoredData>> {
  const companyId = getCompanyId();
  requireActiveTransaction(companyId);
  try {
    await prisma.messageTraceRead.create({ data: { companyId, readerName: audit.readerName, osUser: audit.osUser, messageIds: [...audit.messageIds] } });
    const rows = await prisma.messageTrace.findMany({ where: { companyId, messageId: { in: [...audit.messageIds] } } });
    const traces: MessageTrace[] = [];
    for (const row of rows) {
      const photo = row.photo === null ? ok(null) : parse(tracePhotoSchema, row.photo);
      const shadow = row.shadow === null ? ok(null) : parse(traceShadowSchema, row.shadow);
      const stages = parse(traceStagesSchema, row.stages);
      const quotes = parse(traceQuotesSchema, row.quotes);
      const decisions = parse(traceDecisionsSchema, row.decisions);
      if (!photo.success || !shadow.success || !stages.success || !quotes.success || !decisions.success) {
        log.error({ event: "invalid_stored_message_trace", messageId: row.messageId }, "invalid_stored_message_trace");
        return err({ code: "INVALID_STORED_DATA", message: "Invalid stored message trace" });
      }
      traces.push({ companyId: row.companyId as CompanyId, messageId: row.messageId as ChatMessageId, messageReceivedAt: row.messageReceivedAt, expiresAt: row.expiresAt,
        startedAt: row.startedAt, decidedAt: row.decidedAt, queuedMs: row.queuedMs, shadowWaitMs: row.shadowWaitMs, textState: row.textState,
        contextMessageIds: row.contextMessageIds as ChatMessageId[], photo: photo.data, stages: stages.data, quotes: quotes.data, decisions: decisions.data,
        shadow: shadow.data, costUsd: row.costUsd === null ? null : row.costUsd.toNumber() });
    }
    const textIds = [...new Set([...audit.messageIds, ...traces.flatMap((trace) => trace.contextMessageIds)])];
    const texts = await prisma.messageMaskedText.findMany({ where: { companyId, messageId: { in: textIds } } });
    const changes = await prisma.orderItemChange.findMany({ where: { companyId, messageId: { in: [...audit.messageIds] } },
      select: { messageId: true, orderId: true, kind: true, decision: true, doubt: true, verdict: true, verdictAt: true }, orderBy: [{ orderId: "asc" }, { seq: "asc" }] });
    return ok({ traces, texts: texts.map((row) => ({ messageId: row.messageId as ChatMessageId, text: row.text, expiresAt: row.expiresAt })),
      verdicts: changes.map((change) => ({ messageId: change.messageId as ChatMessageId, orderId: change.orderId, kind: change.kind, decision: change.decision,
        doubtKind: doubtKindOf(change.doubt), verdict: change.verdict, verdictAt: change.verdictAt })) });
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_message_traces", companyId, err: cause }, "unable_to_read_message_traces");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read message traces" });
  }
}

/** The change's `doubt` is a `DoubtReason`, whose `kind` is the only part the trace reader shows. */
function doubtKindOf(doubt: Prisma.JsonValue | null): string | null {
  if (doubt === null || typeof doubt !== "object" || Array.isArray(doubt)) return null;
  const kind = (doubt as Prisma.JsonObject).kind;
  return typeof kind === "string" ? kind : null;
}
