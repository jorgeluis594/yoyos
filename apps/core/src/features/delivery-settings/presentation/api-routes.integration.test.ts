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
      await prisma.companyCourier.deleteMany();
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
  expect(await initial.json()).toEqual({ version: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: null } });
  const store = { enabled: true, pickupPoint: { name: "Tienda", address: "Av. Lima 123", instructions: null } };
  const input = { expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store };
  for (const extra of [{ companyId: other.companyId }, { userId: "other" }, { version: 99 }, { recordedBy: { kind: "buyer" } }]) {
    expect((await request("/api/delivery-settings", seller.cookie, { ...input, ...extra }, "PUT")).status).toBe(400);
  }
  const saved = await request("/api/delivery-settings", seller.cookie, input, "PUT");
  expect(saved.status).toBe(200);
  expect(deliverySettingsSchema.parse(await saved.json())).toEqual({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store });
  const stale = await request("/api/delivery-settings", seller.cookie, { expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: null } }, "PUT");
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "DELIVERY_SETTINGS_CONFLICT" });
  expect(await (await request("/api/delivery-settings", seller.cookie)).json()).toEqual({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store });
  expect(await (await request("/api/delivery-settings", other.cookie)).json()).toEqual({ version: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: null } });
  const disabled = { ...store, enabled: false };
  expect((await request("/api/delivery-settings", seller.cookie, { expectedVersion: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: disabled }, "PUT")).status).toBe(200);
  expect(await (await request("/api/delivery-settings", seller.cookie)).json()).toEqual({ version: 2, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: disabled });
});


test("mobile settings adapter exchanges authenticated settings and preserves a real stale-version conflict", async () => {
  const seller = await fixture();
  const mobile = createDeliverySettingsApi(async (path, init) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), origin, cookie: seller.cookie } });
    const body: unknown = await response.json();
    return response.ok ? ok(body) : err({ code: "API_ERROR", message: "HTTP failure", http: { status: response.status, body } });
  });
  expect(await mobile.get()).toEqual({ success: true, data: { version: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: null } } });
  const input = { expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true as const, pickupPoint: { name: " Store ", address: " Lima ", instructions: null } } };
  const saved = await mobile.save(input);
  expect(saved).toMatchObject({ success: true, data: { version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { pickupPoint: { name: "Store", address: "Lima" } } } });
  expect(await mobile.save(input)).toMatchObject({ success: false, error: { code: "DELIVERY_SETTINGS_CONFLICT" } });
  expect(await mobile.get()).toEqual(saved);
});


test("courier HTTP generates IDs, rejects omission and foreign IDs, and retains deactivated couriers through the mobile adapter", async () => {
  const [seller, other] = await Promise.all([fixture(), fixture()]);
  const input = { expectedVersion: 0, home: { enabled: false }, store: { enabled: false as const, pickupPoint: null }, agency: { enabled: true }, couriers: [{ kind: "new" as const, name: " Courier ", enabled: true }] };
  expect((await request("/api/delivery-settings", seller.cookie, { ...input, couriers: [{ ...input.couriers[0], id: randomUUID() }] }, "PUT")).status).toBe(400);
  const saved = await request("/api/delivery-settings", seller.cookie, input, "PUT");
  expect(saved.status).toBe(200);
  const first = deliverySettingsSchema.parse(await saved.json());
  expect(first).toMatchObject({ version: 1, agency: { enabled: true }, couriers: [{ name: "Courier", enabled: true }] });
  const courier = first.couriers[0];
  expect(courier.id).toMatch(/^[0-9a-f-]{36}$/);
  expect((await request("/api/delivery-settings", seller.cookie, input, "PUT")).status).toBe(409);
  expect(await (await request("/api/delivery-settings", seller.cookie)).json()).toEqual(first);
  const edit = { ...input, expectedVersion: 1, couriers: [{ ...courier, kind: "existing", name: "Renamed", enabled: false }] };
  for (const couriers of [[], [edit.couriers[0], edit.couriers[0]], [{ ...edit.couriers[0], id: randomUUID() }]]) {
    expect((await request("/api/delivery-settings", seller.cookie, { ...edit, agency: { enabled: false }, couriers }, "PUT")).status).toBe(422);
  }
  expect((await request("/api/delivery-settings", other.cookie, { ...edit, expectedVersion: 0 }, "PUT")).status).toBe(422);
  expect((await request("/api/delivery-settings", seller.cookie, edit, "PUT")).status).toBe(422);
  const disabled = await request("/api/delivery-settings", seller.cookie, { ...edit, agency: { enabled: false } }, "PUT");
  expect(disabled.status).toBe(200);
  expect(await disabled.json()).toMatchObject({ version: 2, agency: { enabled: false }, couriers: [{ id: courier.id, name: "Renamed", enabled: false }] });
  expect(await withTenantIsolation(seller.companyId ?? "", async () => await prisma.companyCourier.count())).toBe(1);
});

test("a lost settings response after commit recovers persisted courier IDs without replaying the save", async () => {
  const seller = await fixture();
  let dropResponse = true;
  const mobile = createDeliverySettingsApi(async (path, init) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), origin, cookie: seller.cookie } });
    if (dropResponse && init?.method === "PUT") {
      expect(response.status).toBe(200);
      await response.arrayBuffer();
      dropResponse = false;
      return err({ code: "NETWORK_ERROR", message: "Response lost after server commit" });
    }
    const body: unknown = await response.json();
    return response.ok ? ok(body) : err({ code: "API_ERROR", message: "HTTP failure", http: { status: response.status, body } });
  });
  const input = { expectedVersion: 0, home: { enabled: false }, store: { enabled: false as const, pickupPoint: null }, agency: { enabled: true }, couriers: [{ kind: "new" as const, name: "Courier", enabled: true }] };
  expect(await mobile.save(input)).toMatchObject({ success: false, error: { code: "NETWORK_ERROR" } });
  const confirmed = await mobile.get();
  expect(confirmed).toMatchObject({ success: true, data: { version: 1, couriers: [{ name: "Courier" }] } });
  expect(await mobile.save(input)).toMatchObject({ success: false, error: { code: "DELIVERY_SETTINGS_CONFLICT" } });
  expect(await mobile.get()).toEqual(confirmed);
  expect(await withTenantIsolation(seller.companyId ?? "", async () => await prisma.companyCourier.count())).toBe(1);
});
