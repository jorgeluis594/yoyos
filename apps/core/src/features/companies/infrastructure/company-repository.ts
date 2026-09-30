import { logFailure } from "@core/src/shared/infrastructure/logger";
import { companyDtoSchema } from "@shared/contracts/registration";
import { err, ok } from "@shared/functional";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { CompanyRegistrationRepository, CreateCompanyError } from "@core/src/features/companies/application/create-company-for-user";
import type { Company } from "@core/src/features/companies/domain/company";
import type { Result } from "@shared/result";

type CompanyReadError = Readonly<{ code: "INVALID_STORED_DATA" | "PERSISTENCE_UNAVAILABLE"; message: string }>;

export const companyRepository = {
  async findCompany(companyId: string): Promise<Result<Company | null, CompanyReadError>> {
    try {
      const company = await withTenantIsolation(companyId, async () =>
        await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, country: true } }),
      );
      if (!company) return ok(null);
      const parsed = companyDtoSchema.safeParse(company);
      if (!parsed.success) return err({ code: "INVALID_STORED_DATA", message: "Invalid stored company" });
      return ok(parsed.data);
    } catch (cause) {
      logFailure("unable_to_load_linked_company", cause);
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to load company" });
    }
  },
  async findLink(userId: string) {
    try {
      const user = await systemPrisma.user.findUnique({ where: { id: userId }, select: { emailVerified: true, companyId: true } });
      if (!user) return ok({ status: "user_missing" as const });
      if (!user.emailVerified) return ok({ status: "verification_required" as const });
      return ok(user.companyId ? { status: "linked" as const, companyId: user.companyId } : { status: "unlinked" as const });
    } catch (cause) {
      logFailure("unable_to_read_company_link", cause);
      return err<CreateCompanyError>({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read company link" });
    }
  },
  async createAndLink({ userId, name, country }: Parameters<CompanyRegistrationRepository["createAndLink"]>[0]) {
    const companyId = crypto.randomUUID();
    const alreadyLinked = new Error("Company was linked concurrently");
    try {
      await systemPrisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
        await tx.company.create({ data: { id: companyId, name, country } });
        const linked = await tx.user.updateMany({ where: { id: userId, companyId: null }, data: { companyId } });
        if (linked.count !== 1) throw alreadyLinked;
      });
      return ok({ status: "created" as const, companyId });
    } catch (cause) {
      if (cause === alreadyLinked) return ok({ status: "link_changed" as const });
      logFailure("unable_to_create_company", cause);
      return err<CreateCompanyError>({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to create company" });
    }
  },
} satisfies CompanyRegistrationRepository & { findCompany: (companyId: string) => Promise<Result<Company | null, CompanyReadError>> };
