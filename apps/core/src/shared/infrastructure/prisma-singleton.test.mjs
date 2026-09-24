import { expect, test } from "vitest";

test("separate module copies share the Prisma client and company context", async () => {
  const api = await import("./persistance.ts?api");
  const ssr = await import("./persistance.ts?ssr");

  expect(api.withTenantIsolation).not.toBe(ssr.withTenantIsolation);
  expect(api.prisma._originalClient).toBe(ssr.prisma._originalClient);
  expect(api.systemPrisma).toBe(ssr.systemPrisma);
  await api.withTenantIsolation("company-a", async () => {
    await Promise.resolve();
    expect(ssr.getCompanyId()).toBe("company-a");
  });
  expect(() => ssr.getCompanyId()).toThrow(/Company context is required/);
  await api.prisma.$disconnect();
});
