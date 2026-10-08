import { quotationResponseSchema } from "@shared/contracts/quotations";
import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { createDeliverySettingsApi } from "@mobile/features/delivery-settings/infrastructure/delivery-settings-api";
import { deliverySettingsSchema, deliveryZonesSchema } from "@shared/contracts/delivery-settings";
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

async function fixture(withCompany = true, country = "PE") {
  const companyId = withCompany ? randomUUID() : null;
  const email = `delivery-${randomUUID()}@example.test`;
  const password = "test-password-123";
  if (companyId) await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Delivery API", country } });
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
      await prisma.deliveryRate.deleteMany();
      await prisma.quotation.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany();
      await prisma.deliveryZone.deleteMany();
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
  for (const path of ["/api/delivery-settings", "/api/delivery-settings/zones"]) {
    for (const method of ["GET", "PUT"]) {
      const anonymous = await request(path, undefined, undefined, method);
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers.get("cache-control")).toBe("no-store");
      expect((await request(path, noCompany.cookie, undefined, method)).status).toBe(409);
    }
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

test("zone HTTP persists all overlapping options, retains the other method and returns meaningful validation and version conflicts", async () => {
  const [seller, other] = await Promise.all([fixture(), fixture()]);
  const path = "/api/delivery-settings/zones";
  const first = await request(path, seller.cookie);
  expect(first.status).toBe(200);
  expect(first.headers.get("cache-control")).toBe("no-store");
  expect(await first.json()).toEqual({ home: { enabled: false }, agency: { enabled: false }, version: 0, currency: "PEN", zones: [] });
  const fields = { kind: "new", name: " Nearby ", enabled: true, districtCodes: ["150122"], price: { amount: 8, currency: "PEN" } };
  const input = { method: "home", expectedVersion: 0, zones: [fields, { ...fields, name: "Free", price: { amount: 0, currency: "PEN" } }] };
  for (const body of [{ ...input, companyId: other.companyId }, { ...input, zones: [{ ...fields, id: randomUUID() }] },
    { ...input, zones: [{ ...fields, price: undefined }] }, { ...input, zones: [{ ...fields, rateId: randomUUID() }] }]) {
    expect((await request(path, seller.cookie, body, "PUT")).status).toBe(400);
  }
  for (const invalid of [{ ...fields, districtCodes: [] }, { ...fields, districtCodes: ["999999"] },
    { ...fields, districtCodes: ["150122", "150122"] }, { ...fields, price: { amount: -1, currency: "PEN" } },
    { ...fields, price: { amount: 8.001, currency: "PEN" } }]) {
    const response = await request(path, seller.cookie, { ...input, zones: [invalid] }, "PUT");
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "INVALID_DELIVERY_ZONE", index: 0 });
  }
  const saved = await request(path, seller.cookie, input, "PUT");
  expect(saved.status).toBe(200);
  const home = deliveryZonesSchema.parse(await saved.json());
  expect(home).toMatchObject({ version: 1, home: { enabled: false }, zones: [{ name: "Nearby", price: { amount: 8 } }, { name: "Free", price: { amount: 0 } }] });
  expect((await request("/api/delivery-settings", seller.cookie, { expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, couriers: [], store: { enabled: false, pickupPoint: null } }, "PUT")).status).toBe(200);
  const agencyResponse = await request(path, seller.cookie, { method: "agency", expectedVersion: 2, zones: [{ ...fields, name: "Agency", price: { amount: 5, currency: "PEN" } }] }, "PUT");
  expect(agencyResponse.status).toBe(200);
  const both = deliveryZonesSchema.parse(await agencyResponse.json());
  expect(both).toMatchObject({ version: 3, home: { enabled: true }, agency: { enabled: false } });
  expect(both.zones.filter(zone => zone.method === "home")).toEqual(expect.arrayContaining(home.zones));
  expect(both.zones.filter(zone => zone.method === "agency")).toHaveLength(1);
  const conflict = await request(path, seller.cookie, input, "PUT");
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({ code: "DELIVERY_SETTINGS_CONFLICT", currentVersion: 3, reason: "stale_version" });
  expect(deliveryZonesSchema.parse(await (await request(path, seller.cookie)).json()).zones).toEqual(expect.arrayContaining(both.zones));
  expect(await (await request(path, other.cookie)).json()).toMatchObject({ version: 0, zones: [] });
  const zone = home.zones[0];
  expect((await request(path, other.cookie, { method: "home", expectedVersion: 0, zones: [{ kind: "existing", id: zone.id, name: zone.name,
    enabled: zone.enabled, districtCodes: zone.districtCodes, price: zone.price }] }, "PUT")).status).toBe(422);
  await withTenantIsolation(seller.companyId ?? "", async () => {
    expect(await prisma.quotation.count()).toBe(0);
    expect(await prisma.deliveryRate.count()).toBe(0);
  });
});

test("zone administration rejects businesses outside the Peru pilot", async () => {
  const seller = await fixture(true, "US");
  for (const response of [await request("/api/delivery-settings/zones", seller.cookie),
    await request("/api/delivery-settings/zones", seller.cookie, { method: "home", expectedVersion: 0, zones: [] }, "PUT")]) {
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "UNSUPPORTED_COUNTRY" });
  }
});


test("seller quotations require company access, validate destinations and persist empty responses with fresh identities", async () => {
  const [seller, noCompany] = await Promise.all([fixture(), fixture(false)]);
  const path = "/api/quotations";
  const destination = { country: "PE", districtCode: "150122", address: null, instructions: null };
  expect((await request(path, undefined, { destination })).status).toBe(401);
  expect((await request(path, noCompany.cookie, { destination })).status).toBe(409);
  for (const body of [{}, { destination: null }, { destination, companyId: seller.companyId }, { destination, price: { amount: 0, currency: "PEN" } },
    { destination: { ...destination, kind: "home" } }, { destination, orderId: "bad" }]) {
    expect((await request(path, seller.cookie, body)).status).toBe(400);
  }
  for (const [change, code] of [[{ districtCode: "999999" }, "INVALID_DISTRICT"], [{ country: "US" }, "UNSUPPORTED_COUNTRY"],
    [{ address: "x".repeat(501) }, "INVALID_DESTINATION"]] as const) {
    const response = await request(path, seller.cookie, { destination: { ...destination, ...change } });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code });
  }
  const text = await fetch(`${base}${path}`, { method: "POST", headers: { cookie: seller.cookie, "content-type": "text/plain" }, body: "body" });
  expect(text.status).toBe(415);
  const invalidJson = await fetch(`${base}${path}`, { method: "POST", headers: { cookie: seller.cookie, "content-type": "application/json" }, body: "{" });
  expect(invalidJson.status).toBe(400);
  expect(await invalidJson.json()).toMatchObject({ code: "INVALID_INPUT" });
  const responses = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await request(path, seller.cookie, { destination: { ...destination, address: "  Street  ", instructions: " " } });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    responses.push(quotationResponseSchema.parse(await response.json()));
  }
  expect(responses[0]).toMatchObject({ destination: { ...destination, address: "Street" }, rates: [] });
  expect(responses[0].id).not.toBe(responses[1].id);
  await withTenantIsolation(seller.companyId ?? "", async () => {
    expect(await prisma.quotation.count()).toBe(2);
    expect(await prisma.deliveryRate.count()).toBe(0);
    expect(await prisma.companyDeliverySettings.count()).toBe(0);
  });
});
