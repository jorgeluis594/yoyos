import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { app } from "@core/src/app";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { pushDeviceRepository } from "@core/src/features/notifications/infrastructure/push-device-repository";

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Push device server did not bind");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const fixtures: { companyIds: string[]; userId: string }[] = [];
const password = "test-password-123";

const json = { origin, "content-type": "application/json" };
const token = () => `ExponentPushToken[${randomUUID()}]`;

async function signIn(email: string) {
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: json, body: JSON.stringify({ email, password }) });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Push device test session missing");
  return cookie;
}

async function seller() {
  const companyId = randomUUID();
  const email = `push-device-${randomUUID()}@example.test`;
  await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name: "Push", country: "PE" } }));
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: json, body: JSON.stringify({ name: "Seller", email, password }) });
  expect(signup.status).toBe(200);
  const userId = (await signup.json()).user.id as string;
  const fixture = { companyIds: [companyId], userId };
  fixtures.push(fixture);
  await systemPrisma.user.update({ where: { id: userId }, data: { emailVerified: true, companyId } });
  return { companyId, userId, email, fixture, signIn: () => signIn(email) };
}

const register = (cookie: string, body: unknown) => fetch(`${base}/api/push-devices/current`, { method: "PUT", headers: { ...json, cookie }, body: JSON.stringify(body) });
const sessionIdOf = async (cookie: string) => {
  const value = decodeURIComponent(cookie.split("=")[1] ?? "").split(".")[0];
  const session = await systemPrisma.session.findUniqueOrThrow({ where: { token: value } });
  return session.id;
};

afterAll(async () => {
  for (const { companyIds, userId } of fixtures.reverse()) {
    await systemPrisma.user.delete({ where: { id: userId } });
    for (const companyId of companyIds) await withTenantIsolation(companyId, async () => await prisma.company.delete({ where: { id: companyId } }));
  }
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("PUT /api/push-devices/current moves a token registered by another session", async () => {
  const user = await seller();
  const [a, b] = [await user.signIn(), await user.signIn()];
  const value = token();
  const body = { version: 1, token: value, platform: "ios", locale: "es" };
  expect((await register(a, body)).status).toBe(204);
  expect((await register(b, { ...body, locale: "pt-BR" })).status).toBe(204);
  const rows = await systemPrisma.pushDevice.findMany({ where: { token: value } });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ sessionId: await sessionIdOf(b), userId: user.userId, locale: "pt-BR" });
  expect((await register(b, { ...body, token: "nope" })).status).toBe(400);
  expect((await register(b, { ...body, extra: true })).status).toBe(400);
  const anonymous = await fetch(`${base}/api/push-devices/current`, { method: "PUT", headers: json, body: JSON.stringify(body) });
  expect(anonymous.status).toBe(401);
});

test("signing out deletes the session's push device", async () => {
  const user = await seller();
  const cookie = await user.signIn();
  const value = token();
  expect((await register(cookie, { version: 1, token: value, platform: "android", locale: "es" })).status).toBe(204);
  expect(await systemPrisma.pushDevice.count({ where: { token: value } })).toBe(1);
  const out = await fetch(`${base}/api/auth/sign-out`, { method: "POST", headers: { ...json, cookie }, body: "{}" });
  expect(out.status).toBe(200);
  expect(await systemPrisma.pushDevice.count({ where: { token: value } })).toBe(0);
});

test("POST /api/push-devices/unregister answers 204 for known and unknown tokens", async () => {
  const user = await seller();
  const cookie = await user.signIn();
  const value = token();
  await register(cookie, { version: 1, token: value, platform: "ios", locale: "es" });
  const unregister = (body: unknown) => fetch(`${base}/api/push-devices/unregister`, { method: "POST", headers: json, body: JSON.stringify(body) });
  expect((await unregister({ version: 1, token: value })).status).toBe(204);
  expect(await systemPrisma.pushDevice.count({ where: { token: value } })).toBe(0);
  expect((await unregister({ version: 1, token: token() })).status).toBe(204);
  expect((await unregister({ version: 1 })).status).toBe(400);
  const large = await fetch(`${base}/api/push-devices/unregister`, { method: "POST", headers: json, body: JSON.stringify({ version: 1, token: "x".repeat(200_000) }) });
  expect(large.status).toBe(413);
});

test("a device is found only for an unexpired session of a user in that company", async () => {
  const user = await seller();
  const cookie = await user.signIn();
  const sessionId = await sessionIdOf(cookie);
  expect((await register(cookie, { version: 1, token: token(), platform: "ios", locale: "es" })).status).toBe(204);
  expect(await pushDeviceRepository.findForSession(sessionId, user.companyId)).toMatchObject({ success: true, data: { sessionId, locale: "es" } });
  expect(await pushDeviceRepository.findForSession(sessionId, randomUUID())).toEqual({ success: true, data: null });

  const otherCompany = randomUUID();
  await withTenantIsolation(otherCompany, async () => await prisma.company.create({ data: { id: otherCompany, name: "Other", country: "PE" } }));
  user.fixture.companyIds.push(otherCompany);
  await systemPrisma.user.update({ where: { id: user.userId }, data: { companyId: otherCompany } });
  expect(await pushDeviceRepository.findForSession(sessionId, user.companyId)).toEqual({ success: true, data: null });
  expect(await pushDeviceRepository.findForSession(sessionId, otherCompany)).toMatchObject({ success: true, data: { sessionId } });

  await systemPrisma.session.update({ where: { id: sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  expect(await pushDeviceRepository.findForSession(sessionId, otherCompany)).toEqual({ success: true, data: null });
});

test("deleting a session removes its push device and removing a device by id deletes only that row", async () => {
  const user = await seller();
  const [a, b] = [await user.signIn(), await user.signIn()];
  await register(a, { version: 1, token: token(), platform: "ios", locale: "es" });
  await register(b, { version: 1, token: token(), platform: "ios", locale: "es" });
  const [sessionA, sessionB] = [await sessionIdOf(a), await sessionIdOf(b)];
  const device = await systemPrisma.pushDevice.findUniqueOrThrow({ where: { sessionId: sessionA } });
  await pushDeviceRepository.remove(device.id as never);
  expect(await systemPrisma.pushDevice.count({ where: { sessionId: sessionA } })).toBe(0);
  await systemPrisma.session.delete({ where: { id: sessionB } });
  expect(await systemPrisma.pushDevice.count({ where: { sessionId: sessionB } })).toBe(0);
});
