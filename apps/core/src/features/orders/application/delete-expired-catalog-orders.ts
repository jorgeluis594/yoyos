import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId } from "@core/src/features/orders/domain/order";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type DeleteExpiredCatalogOrdersInput = Readonly<{ cutoff: Date }>;
export type DeleteExpiredCatalogOrdersDependencies = Readonly<{
  listCompaniesWithExpiredCatalogOrders: (cutoff: Date) => Promise<Result<readonly CompanyId[], PersistenceError>>;
  /** Own transaction per call. */
  deleteExpiredCatalogOrders: (companyId: CompanyId, cutoff: Date, limit: number) => Promise<Result<number, PersistenceError>>;
}>;
export type DeleteExpiredCatalogOrdersOutput = Readonly<{ companies: number; deleted: number; failedCompanies: number }>;

const batchSize = 500;

/** A failed company is counted and skipped until the next run; only a failed listing fails the job. */
export async function deleteExpiredCatalogOrders(
  input: DeleteExpiredCatalogOrdersInput,
  dependencies: DeleteExpiredCatalogOrdersDependencies,
): Promise<Result<DeleteExpiredCatalogOrdersOutput, PersistenceError>> {
  const companies = await dependencies.listCompaniesWithExpiredCatalogOrders(input.cutoff);
  if (!companies.success) return companies;
  let deleted = 0;
  let failedCompanies = 0;
  for (const companyId of companies.data) {
    for (;;) {
      const batch = await dependencies.deleteExpiredCatalogOrders(companyId, input.cutoff, batchSize);
      if (!batch.success) { failedCompanies += 1; break; }
      deleted += batch.data;
      if (batch.data < batchSize) break;
    }
  }
  return ok({ companies: companies.data.length, deleted, failedCompanies });
}
