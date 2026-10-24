import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { app } from "@core/src/app";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Dispatch sender server did not bind");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const fixtures: { companyId: string; userId: string }[] = [];

async function call(cookie?: string, sender?: unknown) {
  return fetch(`${base}/api/company/dispatch-sender`, { method: sender === undefined ? "GET" : "PUT",
    headers: { origin, ...(cookie ? { cookie } : {}), ...(sender === undefined ? {} : { "content-type": "application/json" }) },
    ...(sender === undefined ? {} : { body: JSON.stringify(sender) }) });
}

async function seller() {
  const companyId = randomUUID();
  const email = `dispatch-sender-${randomUUID()}@example.test`;
  const password = "test-password-123";
  await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name: "Mi Negocio", country: "PE" } }));
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
  if (!cookie) throw new Error("Dispatch sender test session missing");
  return { companyId, cookie };
}

afterAll(async () => {
  for (const { companyId, userId } of fixtures.reverse()) await withTenantIsolation(companyId, async () => {
    await prisma.companyDispatchSender.deleteMany();
    await systemPrisma.user.delete({ where: { id: userId } });
    await prisma.company.delete({ where: { id: companyId } });
  });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("seller saves the sender, another company and anonymous users cannot see it, and delivery settings stay untouched", async () => {
  expect((await call()).status).toBe(401);
  const first = await seller();
  const second = await seller();
  expect(await (await call(first.cookie)).json()).toEqual({ configured: { name: null, phone: null }, effective: { name: "Mi Negocio", phone: null } });
  const saved = await call(first.cookie, { name: " Fantastidog ", phone: " 977 000 111 " });
  expect(saved.status).toBe(200);
  const expected = { configured: { name: "Fantastidog", phone: "977 000 111" }, effective: { name: "Fantastidog", phone: "977 000 111" } };
  expect(await saved.json()).toEqual(expected);
  expect(await (await call(first.cookie)).json()).toEqual(expected);
  expect(await (await call(second.cookie)).json()).toEqual({ configured: { name: null, phone: null }, effective: { name: "Mi Negocio", phone: null } });
  expect((await call(first.cookie, { name: "n".repeat(121), phone: null })).status).toBe(400);
  expect((await call(second.cookie, { name: "", phone: "" })).status).toBe(200);
  expect(await (await call(first.cookie)).json()).toEqual(expected);
  const delivery = await fetch(`${base}/api/delivery-settings`, { headers: { origin, cookie: first.cookie } });
  expect((await delivery.json()).version).toBe(0);
});
