import assert from "node:assert/strict";
import { test } from "node:test";

test("separate module copies share the Prisma client and company context", async () => {
  const api = await import("./prisma.ts?api");
  const ssr = await import("./prisma.ts?ssr");

  assert.notEqual(api.withCompanyContext, ssr.withCompanyContext);
  assert.equal(api.prisma._originalClient, ssr.prisma._originalClient);
  assert.equal(api.authPrisma._originalClient, ssr.authPrisma._originalClient);
  assert.equal(api.prisma._originalClient, api.authPrisma._originalClient);
  await api.withCompanyContext("company-a", async () => {
    await Promise.resolve();
    assert.equal(ssr.getCompanyId(), "company-a");
  });
  assert.throws(() => ssr.getCompanyId(), /Company context is required/);
  await api.prisma.$disconnect();
});
