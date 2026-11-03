import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import type { VerdictCountRow } from "@core/src/features/orders/application/report-verdict-labels";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
const countedRowSchema = z.object({
  decision: z.enum(["applied", "doubtful"]),
  doubt_kind: z.string().nullable(),
  verdict: z.enum(["kept", "quantity_changed", "removed", "undone", "not_reviewed"]).nullable(),
  count: z.bigint(),
});

/**
 * Reads the SECURITY DEFINER aggregate, which spans every company and returns counts only. The scan has its own statement timeout
 * (transaction-local), longer than the producers', and Prisma's timer outlasts it so the database limit fires first.
 */
export async function countVerdicts(since: Date, until: Date, statementTimeoutMs: number, onTimeoutApplied?: (setting: string) => void): Promise<Result<readonly VerdictCountRow[], PersistenceError>> {
  try {
    const rows = await systemPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('statement_timeout', ${`${statementTimeoutMs}ms`}, true)`;
      if (onTimeoutApplied) onTimeoutApplied((await tx.$queryRaw<{ setting: string }[]>`SELECT current_setting('statement_timeout') AS setting`)[0]!.setting);
      return tx.$queryRaw<unknown[]>`SELECT decision, doubt_kind, verdict, count FROM public.message_change_verdict_counts(${since}::timestamptz, ${until}::timestamptz)`;
    }, { timeout: statementTimeoutMs + 5000, maxWait: 5000 });
    return ok(z.array(countedRowSchema).parse(rows).map((row) => ({ decision: row.decision, doubtKind: row.doubt_kind, verdict: row.verdict, count: Number(row.count) })));
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_count_verdicts", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "Unable to count verdicts");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to count verdicts" });
  }
}
