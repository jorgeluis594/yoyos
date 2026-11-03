import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId } from "@core/src/features/orders/domain/order";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type DeleteExpiredMessageTracesInput = Readonly<{ cutoff: Date; batchSize: number }>;
export type DeletedBatch = Readonly<{ traces: number; texts: number }>;
export type DeleteExpiredMessageTracesDependencies = Readonly<{
  listCompaniesWithExpiredMessageTraces: (cutoff: Date) => Promise<Result<readonly CompanyId[], PersistenceError>>;
  /** Own transaction per call; deletes at most `limit` traces and at most `limit` masked texts. */
  deleteExpiredMessageTraces: (companyId: CompanyId, cutoff: Date, limit: number) => Promise<Result<DeletedBatch, PersistenceError>>;
}>;
export type DeleteExpiredMessageTracesOutput = Readonly<{ companies: number; deletedTraces: number; deletedTexts: number; failedCompanies: number }>;

/**
 * Nothing caps the number of batches, so a backlog is always caught up. A failed company is counted and retried on the next run;
 * only a failed listing fails the job.
 */
export async function deleteExpiredMessageTraces(
  input: DeleteExpiredMessageTracesInput,
  dependencies: DeleteExpiredMessageTracesDependencies,
): Promise<Result<DeleteExpiredMessageTracesOutput, PersistenceError>> {
  const companies = await dependencies.listCompaniesWithExpiredMessageTraces(input.cutoff);
  if (!companies.success) return companies;
  let deletedTraces = 0;
  let deletedTexts = 0;
  let failedCompanies = 0;
  for (const companyId of companies.data) {
    for (;;) {
      const batch = await dependencies.deleteExpiredMessageTraces(companyId, input.cutoff, input.batchSize);
      if (!batch.success) { failedCompanies += 1; break; }
      deletedTraces += batch.data.traces;
      deletedTexts += batch.data.texts;
      if (batch.data.traces < input.batchSize && batch.data.texts < input.batchSize) break;
    }
  }
  return ok({ companies: companies.data.length, deletedTraces, deletedTexts, failedCompanies });
}
