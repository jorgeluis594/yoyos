import type { Country } from "@shared/country";

type CompanyRepository = {
  getCompanyIdForUser(userId: string): Promise<string | null>;
  createAndLinkCompany(userId: string, name: string, country: Country): Promise<string | null>;
};

export async function createCompanyForUser(
  userId: string,
  name: string,
  country: Country,
  repository: CompanyRepository,
): Promise<{ companyId: string; created: boolean }> {
  const existingId = await repository.getCompanyIdForUser(userId);
  if (existingId) return { companyId: existingId, created: false };

  const companyId = await repository.createAndLinkCompany(userId, name, country);
  if (companyId) return { companyId, created: true };

  const linkedId = await repository.getCompanyIdForUser(userId);
  if (!linkedId) throw new Error("Company link was lost after a concurrent request");
  return { companyId: linkedId, created: false };
}
