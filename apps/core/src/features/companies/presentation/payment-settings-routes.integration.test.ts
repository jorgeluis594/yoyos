import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { app } from "@core/src/app";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Payment settings server did not bind");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const fixtures: { companyId: string; userId: string }[] = [];

async function call(cookie?: string, settings?: unknown) {
  return fetch(`${base}/api/company/payment-settings`, { method: settings === undefined ? "GET" : "PUT",
    headers: { origin, ...(cookie ? { cookie } : {}), ...(settings === undefined ? {} : { "content-type": "application/json" }) },
    ...(settings === undefined ? {} : { body: JSON.stringify({ settings }) }) });
}

async function seller() {
  const companyId = randomUUID();
  const email = `payment-settings-${randomUUID()}@example.test`;
  const password = "test-password-123";
  await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name: "Payments", country: "PE" } }));
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ name: "Seller", email, password }) });
  expect(signup.status).toBe(200);
  const userId = (await signup.json()).user.id as string;
  fixtures.push({ companyId, userId });
  await systemPrisma.user.update({ where: { id: userId }, data: { emailVerified: true, companyId } });
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email, password }) });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Payment settings test session missing");
  return { companyId, cookie };
}

afterAll(async () => {
  for (const { companyId, userId } of fixtures.reverse()) await withTenantIsolation(companyId, async () => {
    await prisma.companyPaymentSettings.deleteMany();
    await systemPrisma.user.delete({ where: { id: userId } });
    await prisma.company.delete({ where: { id: companyId } });
  });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("seller saves current payment methods while another company and anonymous users cannot read them", async () => {
  expect((await call()).status).toBe(401);
  const first = await seller();
  const second = await seller();
  expect(await (await call(first.cookie)).json()).toEqual({ settings: [] });
  const wallet = { method: "digital_wallet", provider: "Yape", holder: "Ana", imageId: null };
  const bank = { method: "bank_transfer", bank: "BCP", holder: "Ana", accountNumber: "00123", cci: null, imageId: null };
  const saved = await call(first.cookie, [wallet, bank]);
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ settings: [wallet, bank] });
  expect(await (await call(second.cookie)).json()).toEqual({ settings: [] });
  expect((await call(first.cookie, [{ ...bank, accountNumber: null }])).status).toBe(400);
  expect(await (await call(first.cookie)).json()).toEqual({ settings: [wallet, bank] });
});
