import { auth } from "@core/src/shared/infrastructure/auth";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";
import { createCompanyForUser } from "@core/src/features/companies/application/create-company-for-user";
import { companyRepository } from "@core/src/features/companies/infrastructure/company-repository";

const email = "demo@yoyos.local";
const password = "demo-password-123";

export async function seed() {
  if (process.env.NODE_ENV === "production") throw new Error("Seed is disabled in production");

  let user = await systemPrisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    const result = await auth.api.signUpEmail({ body: { name: "Usuario Demo", email, password } });
    user = { id: result.user.id };
  }

  const credential = await systemPrisma.account.findFirst({
    where: { userId: user.id, providerId: "credential", accountId: user.id, password: { not: null } },
    select: { id: true },
  });
  if (!credential) throw new Error(`Seed user ${email} has no password account`);

  await createCompanyForUser(user.id, "Yoyos Demo", "PE", companyRepository);
  console.log(`Seed ready: ${email}`);
}

try {
  await seed();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await systemPrisma.$disconnect();
}
