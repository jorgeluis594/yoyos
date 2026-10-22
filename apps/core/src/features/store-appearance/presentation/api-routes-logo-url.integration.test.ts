import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { storeAppearanceResponseSchema } from "@shared/contracts/store-appearance";

// Own file without R2_PUBLIC_BASE_URL: Vitest isolates files, and the images module reads it at import time.
process.env.R2_PUBLIC_BASE_URL = "";
const { app } = await import("@core/src/app");
const { prisma, systemPrisma, withTenantIsolation } = await import("@core/src/shared/infrastructure/persistance");

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Store appearance server did not bind");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
let fixture: { companyId: string; userId: string } | null = null;

afterAll(async () => {
  if (fixture) await withTenantIsolation(fixture.companyId, async () => {
    await prisma.companyCheckoutAppearance.deleteMany();
    await prisma.image.deleteMany();
    await systemPrisma.user.delete({ where: { id: fixture!.userId } });
    await prisma.company.delete({ where: { id: fixture!.companyId } });
  });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("PUT store appearance keeps the stored logo and answers 200 with a logo without url when the storage url cannot be built", async () => {
  const companyId = randomUUID();
  const email = `store-appearance-url-${randomUUID()}@example.test`;
  const password = "test-password-123";
  await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name: "Appearance", country: "PE" } }));
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ name: "Seller", email, password }) });
  const userId = (await signup.json()).user.id as string;
  fixture = { companyId, userId };
  await systemPrisma.user.update({ where: { id: userId }, data: { emailVerified: true, companyId } });
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email, password }) });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const logoId = randomUUID();
  await withTenantIsolation(companyId, async () => await prisma.image.create({ data: { id: logoId, storageKey: `images/${logoId}.png` } }));

  const response = await fetch(`${base}/api/store-appearance`, { method: "PUT", headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify({ theme: "suave", logoImageId: logoId }) });
  expect(response.status).toBe(200);
  expect(storeAppearanceResponseSchema.parse(await response.json())).toEqual({ kind: "readable", appearance: { theme: "suave", logo: { id: logoId, url: null } } });
  const rows = await withTenantIsolation(companyId, async () => await prisma.companyCheckoutAppearance.findMany());
  expect(rows.map((row) => [row.theme, row.logoImageId])).toEqual([["suave", logoId]]);
});
