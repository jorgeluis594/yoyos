import type { Country } from "@shared/country";
import { authPrisma, systemPrisma } from "@core/src/shared/infrastructure/persistance";

export const companyRepository = {
  async getCompanyIdForUser(userId: string): Promise<string | null> {
    const user = await authPrisma.user.findUnique({ where: { id: userId }, select: { companyId: true } });
    if (!user) throw new Error("Authenticated user no longer exists");
    return user.companyId;
  },

  async createAndLinkCompany(userId: string, name: string, country: Country): Promise<string | null> {
    const companyId = crypto.randomUUID();
    const alreadyLinked = new Error("Company was linked concurrently");
    try {
      await systemPrisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
        await tx.company.create({ data: { id: companyId, name, country } });
        const linked = await tx.user.updateMany({ where: { id: userId, companyId: null }, data: { companyId } });
        if (linked.count !== 1) throw alreadyLinked;
      });
      return companyId;
    } catch (error) {
      if (error === alreadyLinked) return null;
      throw error;
    }
  },
};
