import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { createDeliverySettingsApi } from "@mobile/features/delivery-settings/infrastructure/delivery-settings-api";
import { deliverySettingsSchema } from "@shared/contracts/delivery-settings";
import { app } from "@core/src/app";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("No test port");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const fixtures: { cleanup: () => Promise<void> }[] = [];

async function request(path: string, cookie?: string, body?: unknown, method?: string) {
  return fetch(`${base}${path}`, { method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { origin, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function fixture(withCompany = true) {
  const companyId = withCompany ? randomUUID() : null;
  const email = `delivery-${randomUUID()}@example.test`;
  const password = "test-password-123";
  if (companyId) await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Delivery API", country: "PE" } });
  });
  const signup = await request("/api/auth/sign-up/email", undefined, { name: "Seller", email, password });
  expect(signup.status).toBe(200);
  const userId = (await signup.json()).user.id as string;
  await systemPrisma.user.update({ where: { id: userId }, data: { emailVerified: true, companyId } });
  const login = await request("/api/auth/sign-in/email", undefined, { email, password });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Missing test session");
  const f = { companyId, cookie, async cleanup() {
    await systemPrisma.user.delete({ where: { id: userId } });
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.companyDeliverySettings.deleteMany();
      await prisma.company.delete({ where: { id: companyId } });
    });
  } };
  fixtures.push(f);
  return f;
}

afterAll(async () => {
  for (const f of fixtures.reverse()) await f.cleanup();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await systemPrisma.$disconnect();
});

test("configuration endpoints require authenticated company access and disable caching", async () => {
  const noCompany = await fixture(false);
  for (const method of ["GET", "PUT"]) {
    const anonymous = await request("/api/delivery-settings", undefined, undefined, method);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toBe("no-store");
    expect((await request("/api/delivery-settings", noCompany.cookie, undefined, method)).status).toBe(409);
  }
});

test("authenticated configuration HTTP persists, conflicts, rejects manipulation and isolates businesses", async () => {
  const [seller, other] = await Promise.all([fixture(), fixture()]);
  const initial = await request("/api/delivery-settings", seller.cookie);
  expect(initial.status).toBe(200);
  expect(await initial.json()).toEqual({ version: 0, home: { enabled: false }, store: { enabled: false, pickupPoint: null } });
  const store = { enabled: true, pickupPoint: { name: "Tienda", address: "Av. Lima 123", instructions: null } };
  const input = { expectedVersion: 0, home: { enabled: false }, store };
  for (const extra of [{ companyId: other.companyId }, { userId: "other" }, { version: 99 }, { recordedBy: { kind: "buyer" } }]) {
    expect((await request("/api/delivery-settings", seller.cookie, { ...input, ...extra }, "PUT")).status).toBe(400);
  }
  const saved = await request("/api/delivery-settings", seller.cookie, input, "PUT");
  expect(saved.status).toBe(200);
  expect(deliverySettingsSchema.parse(await saved.json())).toEqual({ version: 1, home: { enabled: false }, store });
  const stale = await request("/api/delivery-settings", seller.cookie, { expectedVersion: 0, home: { enabled: false }, store: { enabled: false, pickupPoint: null } }, "PUT");
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "DELIVERY_SETTINGS_CONFLICT" });
  expect(await (await request("/api/delivery-settings", seller.cookie)).json()).toEqual({ version: 1, home: { enabled: false }, store });
  expect(await (await request("/api/delivery-settings", other.cookie)).json()).toEqual({ version: 0, home: { enabled: false }, store: { enabled: false, pickupPoint: null } });
  const disabled = { ...store, enabled: false };
  expect((await request("/api/delivery-settings", seller.cookie, { expectedVersion: 1, home: { enabled: false }, store: disabled }, "PUT")).status).toBe(200);
  expect(await (await request("/api/delivery-settings", seller.cookie)).json()).toEqual({ version: 2, home: { enabled: false }, store: disabled });
});


test("mobile settings adapter exchanges authenticated settings and preserves a real stale-version conflict", async () => {
  const seller = await fixture();
  const mobile = createDeliverySettingsApi(async (path, init) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), origin, cookie: seller.cookie } });
    const body: unknown = await response.json();
    return response.ok ? ok(body) : err({ code: "API_ERROR", message: "HTTP failure", http: { status: response.status, body } });
  });
  expect(await mobile.get()).toEqual({ success: true, data: { version: 0, home: { enabled: false }, store: { enabled: false, pickupPoint: null } } });
  const input = { expectedVersion: 0, home: { enabled: false }, store: { enabled: true as const, pickupPoint: { name: " Store ", address: " Lima ", instructions: null } } };
  const saved = await mobile.save(input);
  expect(saved).toMatchObject({ success: true, data: { version: 1, home: { enabled: false }, store: { pickupPoint: { name: "Store", address: "Lima" } } } });
  expect(await mobile.save(input)).toMatchObject({ success: false, error: { code: "DELIVERY_SETTINGS_CONFLICT" } });
  expect(await mobile.get()).toEqual(saved);
});
