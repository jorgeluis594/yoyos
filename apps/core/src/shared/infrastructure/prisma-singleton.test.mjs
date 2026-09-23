import assert from "node:assert/strict";
import { test } from "vitest";

test("separate module copies share the Prisma client and company context", async () => {
  const api = await import("./persistance.ts?api");
  const ssr = await import("./persistance.ts?ssr");

  assert.notEqual(api.withTenantIsolation, ssr.withTenantIsolation);
  assert.equal(api.prisma._originalClient, ssr.prisma._originalClient);
  assert.equal(api.systemPrisma, ssr.systemPrisma);
  await api.withTenantIsolation("company-a", async () => {
    await Promise.resolve();
    assert.equal(ssr.getCompanyId(), "company-a");
  });
  assert.throws(() => ssr.getCompanyId(), /Company context is required/);
  await api.prisma.$disconnect();
});
