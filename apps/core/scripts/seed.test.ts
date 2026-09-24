import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import { hashPassword } from "better-auth/crypto";

const email = "demo@yoyos.local";

test("seed is repeatable, preserves edits, and repairs a missing company", async () => {
  if (!process.env.DATABASE_URL?.includes("core_test")) throw new Error("Run sh scripts/run-tests.sh integration");
  process.env.BETTER_AUTH_SECRET = "integration-test-secret-at-least-32-chars";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  const { systemPrisma, prisma, withTenantIsolation } = await import("../src/shared/infrastructure/persistance.ts");
  const { auth } = await import("../src/shared/infrastructure/auth.ts");
  const runSeed = (env: Record<string, string> = {}) => execFileSync("pnpm", ["seed"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const companyIds = new Set<string>();

  try {
    runSeed();
    runSeed();
    let users = await systemPrisma.user.findMany({ where: { email }, include: { accounts: true } });
    expect(users).toHaveLength(1);
    expect(users[0].accounts).toHaveLength(1);
    expect(users[0].accounts[0].providerId).toBe("credential");
    expect(users[0].companyId).toBeTruthy();
    if (!users[0].companyId) throw new Error("Seed company was not linked");
    companyIds.add(users[0].companyId);
    const firstCompanyId = users[0].companyId;
    expect(await withTenantIsolation(firstCompanyId, async () => prisma.company.findMany({ where: { id: firstCompanyId }, select: { name: true, country: true } }))).toEqual([{ name: "Yoyos Demo", country: "PE" }]);
    const login = await auth.api.signInEmail({ body: { email, password: "demo-password-123" } });
    expect(login.user.id).toBe(users[0].id);

    const changedPassword = "changed-password-123";
    const changedHash = await hashPassword(changedPassword);
    await systemPrisma.user.update({ where: { id: users[0].id }, data: { name: "Nombre editado" } });
    await systemPrisma.account.update({ where: { id: users[0].accounts[0].id }, data: { password: changedHash } });
    runSeed();
    users = await systemPrisma.user.findMany({ where: { email }, include: { accounts: true } });
    expect(users[0].name).toBe("Nombre editado");
    expect(users[0].accounts[0].password).toBe(changedHash);
    expect(users[0].companyId).toBe([...companyIds][0]);
    expect((await auth.api.signInEmail({ body: { email, password: changedPassword } })).user.id).toBe(users[0].id);

    await systemPrisma.user.update({ where: { id: users[0].id }, data: { companyId: null } });
    runSeed();
    const repaired = await systemPrisma.user.findUniqueOrThrow({ where: { email }, include: { accounts: true } });
    expect(repaired.companyId).toBeTruthy();
    if (!repaired.companyId) throw new Error("Seed company was not repaired");
    companyIds.add(repaired.companyId);
    expect(repaired.accounts).toHaveLength(1);
    const repairedCompanyId = repaired.companyId;
    expect(await withTenantIsolation(repairedCompanyId, async () => prisma.company.count({ where: { id: repairedCompanyId } }))).toBe(1);

    await systemPrisma.account.delete({ where: { id: repaired.accounts[0].id } });
    expect(() => runSeed()).toThrow(/no password account/);
    expect(() => runSeed({ NODE_ENV: "production" })).toThrow(/Seed is disabled in production/);
  } finally {
    await systemPrisma.user.deleteMany({ where: { email } });
    for (const id of companyIds) await withTenantIsolation(id, async () => prisma.company.deleteMany({ where: { id } }));
    await systemPrisma.$disconnect();
  }
});
