import { quotationResponseSchema } from "@shared/contracts/quotations";
import { randomUUID } from "node:crypto";
import { afterAll, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { createDeliverySettingsApi } from "@mobile/features/delivery-settings/infrastructure/delivery-settings-api";
import { createQuotationApi } from "@mobile/features/delivery-settings/infrastructure/quotation-api";
import { log } from "@core/src/shared/infrastructure/logger";
import { agencyCatalogSchema, courierCatalogSchema, deliverySettingsSchema, deliveryZonesSchema } from "@shared/contracts/delivery-settings";
import { app } from "@core/src/app";
import { seededCourier, withCatalogAdmin } from "@core/src/features/delivery-settings/infrastructure/courier-catalog-fixture";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("No test port");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const fixtures: { cleanup: () => Promise<void> }[] = [];
const temporaryCouriers: string[] = [];
const shalomId = (await seededCourier("shalom")).id;

// Throwaway catalog entries keep tests from mutating the seeded couriers other files rely on.
async function temporaryCourier(enabled: boolean, name = "Temporary courier") {
  const id = randomUUID();
  await withCatalogAdmin(query => query('INSERT INTO "Courier" (id, code, name, enabled) VALUES ($1, $2, $3, $4)', [id, `t2_${id.replaceAll("-", "")}`, name, enabled]));
  temporaryCouriers.push(id);
  return { id };
}

async function catalogAgency(courierId: string, name: string, districtCode: string, enabled = true) {
  const id = randomUUID();
  await withCatalogAdmin(query => query('INSERT INTO "DeliveryAgency" (id, "courierId", name, address, "districtCode", enabled) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, courierId, name, "Av. Test 123", districtCode, enabled]));
  return id;
}

async function withCourier(f: { companyId: string | null }, courierId: string, enabled = true) {
  if (!f.companyId) throw new Error("Company required");
  await withTenantIsolation(f.companyId, async () => {
    await prisma.companyDeliverySettings.create({ data: { agencyEnabled: false, homeEnabled: false, storeEnabled: false, version: 1 } });
    await prisma.companyCourier.create({ data: { id: randomUUID(), courierId, enabled } });
  });
}

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
      await prisma.deliveryOptionAgency.deleteMany();
      await prisma.deliveryOption.deleteMany();
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
  await withCatalogAdmin(async query => {
    await query('DELETE FROM "DeliveryAgency" WHERE "courierId" = ANY($1::uuid[])', [temporaryCouriers]);
    await query('DELETE FROM "Courier" WHERE id = ANY($1::uuid[])', [temporaryCouriers]);
  });
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
  const input = { expectedVersion: 0, home: { enabled: false }, store: { enabled: false as const, pickupPoint: null }, agency: { enabled: true }, couriers: [{ kind: "new" as const, courierId: shalomId, enabled: true }] };
  expect((await request("/api/delivery-settings", seller.cookie, { ...input, couriers: [{ ...input.couriers[0], id: randomUUID() }] }, "PUT")).status).toBe(400);
  expect((await request("/api/delivery-settings", seller.cookie, { ...input, couriers: [{ ...input.couriers[0], name: "Forged" }] }, "PUT")).status).toBe(400);
  const saved = await request("/api/delivery-settings", seller.cookie, input, "PUT");
  expect(saved.status).toBe(200);
  const first = deliverySettingsSchema.parse(await saved.json());
  expect(first).toMatchObject({ version: 1, agency: { enabled: true }, couriers: [{ courierId: shalomId, name: "Shalom", enabled: true }] });
  const courier = first.couriers[0];
  expect(courier.id).toMatch(/^[0-9a-f-]{36}$/);
  expect((await request("/api/delivery-settings", seller.cookie, input, "PUT")).status).toBe(409);
  expect(await (await request("/api/delivery-settings", seller.cookie)).json()).toEqual(first);
  const edit = { ...input, expectedVersion: 1, couriers: [{ kind: "existing", id: courier.id, enabled: false }] };
  for (const couriers of [[], [edit.couriers[0], edit.couriers[0]], [{ ...edit.couriers[0], id: randomUUID() }]]) {
    expect((await request("/api/delivery-settings", seller.cookie, { ...edit, agency: { enabled: false }, couriers }, "PUT")).status).toBe(422);
  }
  expect((await request("/api/delivery-settings", other.cookie, { ...edit, expectedVersion: 0 }, "PUT")).status).toBe(422);
  // Agency delivery stays on without enabled couriers; its options simply produce no rates.
  const disabled = await request("/api/delivery-settings", seller.cookie, edit, "PUT");
  expect(disabled.status).toBe(200);
  expect(await disabled.json()).toMatchObject({ version: 2, agency: { enabled: true }, couriers: [{ id: courier.id, courierId: shalomId, name: "Shalom", enabled: false }] });
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
  const input = { expectedVersion: 0, home: { enabled: false }, store: { enabled: false as const, pickupPoint: null }, agency: { enabled: true }, couriers: [{ kind: "new" as const, courierId: shalomId, enabled: true }] };
  expect(await mobile.save(input)).toMatchObject({ success: false, error: { code: "NETWORK_ERROR" } });
  const confirmed = await mobile.get();
  expect(confirmed).toMatchObject({ success: true, data: { version: 1, couriers: [{ name: "Shalom" }] } });
  expect(await mobile.save(input)).toMatchObject({ success: false, error: { code: "DELIVERY_SETTINGS_CONFLICT" } });
  expect(await mobile.get()).toEqual(confirmed);
  expect(await withTenantIsolation(seller.companyId ?? "", async () => await prisma.companyCourier.count())).toBe(1);
});

test("zone HTTP persists zones with options, retains existing ones and returns meaningful validation and version conflicts", async () => {
  const [seller, other] = await Promise.all([fixture(), fixture()]);
  const path = "/api/delivery-settings/zones";
  const first = await request(path, seller.cookie);
  expect(first.status).toBe(200);
  expect(first.headers.get("cache-control")).toBe("no-store");
  expect(await first.json()).toEqual({ home: { enabled: false }, agency: { enabled: false }, version: 0, currency: "PEN", zones: [], agencies: [] });
  const option = { kind: "new", method: "home", name: "Standard", enabled: true, price: { amount: 8, currency: "PEN" } };
  const fields = { kind: "new", name: " Nearby ", enabled: true, districtCodes: ["150122"], options: [option] };
  const free = { ...fields, name: "Free", options: [{ ...option, name: "Free", price: { amount: 0, currency: "PEN" } },
    { kind: "new", method: "agency", name: "Agency", enabled: true, price: { amount: 5, currency: "PEN" }, agencyIds: [] }] };
  const input = { expectedVersion: 0, zones: [fields, free] };
  for (const body of [{ ...input, companyId: other.companyId }, { ...input, method: "home" }, { ...input, zones: [{ ...fields, id: randomUUID() }] },
    { ...input, zones: [{ ...fields, options: [{ ...option, price: undefined }] }] }, { ...input, zones: [{ ...fields, options: [{ ...option, agencyIds: [] }] }] },
    { ...input, zones: [{ ...fields, price: { amount: 1, currency: "PEN" } }] }]) {
    expect((await request(path, seller.cookie, body, "PUT")).status).toBe(400);
  }
  for (const invalid of [{ ...fields, districtCodes: [] }, { ...fields, districtCodes: ["999999"] }, { ...fields, districtCodes: ["150122", "150122"] }]) {
    const response = await request(path, seller.cookie, { ...input, zones: [invalid] }, "PUT");
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "INVALID_DELIVERY_ZONE", index: 0 });
  }
  for (const change of [{ price: { amount: -1, currency: "PEN" } }, { price: { amount: 8.001, currency: "PEN" } }, { name: " " }]) {
    const response = await request(path, seller.cookie, { ...input, zones: [{ ...fields, options: [{ ...option, ...change }] }] }, "PUT");
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "INVALID_DELIVERY_OPTION", ...("price" in change ? { field: "price" } : {}), index: 0, optionIndex: 0 });
  }
  const duplicate = await request(path, seller.cookie, { ...input, zones: [{ ...fields, options: [option, { ...option, name: " STANDARD " }] }] }, "PUT");
  expect(duplicate.status).toBe(422);
  expect(await duplicate.json()).toMatchObject({ code: "INVALID_DELIVERY_OPTION", field: "name", index: 0, optionIndex: 1 });
  const unknownAgency = await request(path, seller.cookie, { ...input, zones: [{ ...fields, options: [{ ...option, method: "agency", agencyIds: [randomUUID()] }] }] }, "PUT");
  expect(unknownAgency.status).toBe(422);
  expect(await unknownAgency.json()).toMatchObject({ code: "INVALID_DELIVERY_OPTION", field: "agencyIds" });
  const saved = await request(path, seller.cookie, input, "PUT");
  expect(saved.status).toBe(200);
  const home = deliveryZonesSchema.parse(await saved.json());
  expect(home).toMatchObject({ version: 1, home: { enabled: false }, zones: [{ name: "Nearby", options: [{ method: "home", price: { amount: 8 } }] },
    { name: "Free", options: [{ price: { amount: 0 } }, { method: "agency", agencyIds: [] }] }] });
  expect((await request("/api/delivery-settings", seller.cookie, { expectedVersion: 1, home: { enabled: true }, agency: { enabled: false }, couriers: [], store: { enabled: false, pickupPoint: null } }, "PUT")).status).toBe(200);
  const existing = home.zones.map(zone => ({ kind: "existing", id: zone.id, name: zone.name, enabled: zone.enabled, districtCodes: zone.districtCodes,
    options: zone.options.map(value => ({ kind: "existing", ...value })) }));
  const moved = await request(path, seller.cookie, { expectedVersion: 2, zones: [{ ...existing[0], options: [] },
    { ...existing[1], options: [...existing[1].options, existing[0].options[0]] }] }, "PUT");
  expect(moved.status).toBe(422);
  expect(await moved.json()).toMatchObject({ code: "INVALID_DELIVERY_OPTION", field: "id", index: 1, optionIndex: 2 });
  const dropped = await request(path, seller.cookie, { expectedVersion: 2, zones: [existing[0]] }, "PUT");
  expect(dropped.status).toBe(422);
  expect(await dropped.json()).toMatchObject({ code: "INVALID_DELIVERY_ZONE", field: "zones" });
  const disabled = await request(path, seller.cookie, { expectedVersion: 2, zones: existing.map(zone => ({ ...zone, options: zone.options.map(value => ({ ...value, enabled: false })) })) }, "PUT");
  expect(disabled.status).toBe(200);
  const both = deliveryZonesSchema.parse(await disabled.json());
  expect(both).toMatchObject({ version: 3, home: { enabled: true }, agency: { enabled: false } });
  expect(both.zones.flatMap(zone => zone.options).every(value => !value.enabled)).toBe(true);
  const conflict = await request(path, seller.cookie, input, "PUT");
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({ code: "DELIVERY_SETTINGS_CONFLICT", currentVersion: 3, reason: "stale_version" });
  // Reads order by id, saves keep input order.
  const normalized = (zones: typeof both.zones) => [...zones].sort((left, right) => left.id.localeCompare(right.id))
    .map(zone => ({ ...zone, options: [...zone.options].sort((left, right) => left.id.localeCompare(right.id)) }));
  expect(normalized(deliveryZonesSchema.parse(await (await request(path, seller.cookie)).json()).zones)).toEqual(normalized(both.zones));
  expect(await (await request(path, other.cookie)).json()).toMatchObject({ version: 0, zones: [] });
  expect((await request(path, other.cookie, { expectedVersion: 0, zones: [existing[0]] }, "PUT")).status).toBe(422);
  await withTenantIsolation(seller.companyId ?? "", async () => {
    expect(await prisma.quotation.count()).toBe(0);
    expect(await prisma.deliveryRate.count()).toBe(0);
  });
});

test("zone administration rejects businesses outside the Peru pilot", async () => {
  const seller = await fixture(true, "US");
  for (const response of [await request("/api/delivery-settings/zones", seller.cookie),
    await request("/api/delivery-settings/zones", seller.cookie, { expectedVersion: 0, zones: [] }, "PUT")]) {
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

test("mobile zone adapter consumes real authenticated saves and preserves conflict details without duplicating zones", async () => {
  const seller = await fixture();
  const api = createDeliverySettingsApi(async (path, init) => {
    const response = await fetch(base + path, { ...init, headers: { origin, cookie: seller.cookie, ...init?.headers } });
    const body: unknown = await response.json();
    return response.ok ? ok(body) : err({ code: "API_ERROR", message: "Request failed", http: { status: response.status, body } });
  });
  expect(await api.getZones()).toMatchObject({ success: true, data: { version: 0, currency: "PEN", zones: [] } });
  const input = { expectedVersion: 0, zones: [{ kind: "new" as const, name: "Free home", enabled: true, districtCodes: ["150122"],
    options: [{ kind: "new" as const, method: "home" as const, name: "Free", enabled: true, price: { amount: 0, currency: "PEN" as const } }] }] };
  const saved = await api.saveZones(input);
  expect(saved).toMatchObject({ success: true, data: { version: 1, zones: [expect.objectContaining({
    id: expect.any(String), options: [expect.objectContaining({ method: "home", price: { amount: 0, currency: "PEN" } })],
  })] } });
  expect(await api.saveZones(input)).toMatchObject({ error: { code: "DELIVERY_SETTINGS_CONFLICT", currentVersion: 1, reason: "stale_version" } });
  expect(await api.getZones()).toEqual(saved);
  if (!saved.success) throw new Error("Expected saved zones");
  const [stored] = saved.data.zones;
  expect(await api.saveZones({ expectedVersion: 1, zones: [{ kind: "existing", id: stored.id, name: stored.name, enabled: true, districtCodes: ["000000"],
    options: stored.options.map(({ id, method, name, enabled, price }) => ({ kind: "existing" as const, id, method: method as "home", name, enabled, price })) }] }))
    .toMatchObject({ error: { code: "INVALID_DELIVERY_ZONE", field: "districtCodes", index: 0 } });
  expect(await api.getZones()).toEqual(saved);
});

test("mobile seller quotation adapter consumes overlapping real rates, empty coverage and new IDs per request", async () => {
  const seller = await fixture();
  expect((await request("/api/delivery-settings", seller.cookie, { expectedVersion: 0, home: { enabled: true },
    agency: { enabled: true }, couriers: [{ kind: "new", courierId: shalomId, enabled: true }],
    store: { enabled: false, pickupPoint: null } }, "PUT")).status).toBe(200);
  const zone = (name: string, amount: number) => ({ kind: "new", name, enabled: true, districtCodes: ["150122"],
    options: [{ kind: "new", method: "home", name: "Home", enabled: true, price: { amount, currency: "PEN" } }] });
  expect((await request("/api/delivery-settings/zones", seller.cookie, { expectedVersion: 1,
    zones: [zone("First", 8), zone("Second", 8), zone("Free", 0)] }, "PUT")).status).toBe(200);
  const api = createQuotationApi(async (path, init) => {
    const response = await fetch(base + path, { ...init, headers: { origin, cookie: seller.cookie, ...init?.headers } });
    const body: unknown = await response.json();
    return response.ok ? ok(body) : err({ code: "API_ERROR", message: "Request failed", http: { status: response.status, body } });
  });
  const first = await api("150122");
  expect(first.success).toBe(true);
  if (!first.success) throw new Error("Expected quotation");
  expect(first.data.rates.map(rate => rate.price.amount)).toEqual([0, 8, 8]);
  expect(first.data.rates.map(rate => rate.zoneName).sort()).toEqual(["First", "Free", "Second"]);
  expect(first.data.rates.every(rate => rate.name === "Home" && rate.method === "home")).toBe(true);
  const second = await api("150122");
  expect(second.success).toBe(true);
  if (!second.success) throw new Error("Expected repeated quotation");
  expect(second.data.id).not.toBe(first.data.id);
  expect(second.data.rates.every(rate => !first.data.rates.some(previous => previous.id === rate.id))).toBe(true);
  expect(await api("040110")).toMatchObject({ success: true, data: { districtCode: "040110", rates: [] } });
  await withTenantIsolation(seller.companyId ?? "", async () => {
    expect(await prisma.quotation.count()).toBe(3);
    expect(await prisma.deliveryRate.count()).toBe(6);
    expect(await prisma.companyDeliverySettings.findUnique({ where: { companyId: seller.companyId ?? "" } })).toMatchObject({ version: 2 });
  });
});

test("courier catalog endpoint lists enabled catalog couriers by name for authenticated companies only", async () => {
  const [seller, noCompany] = await Promise.all([fixture(), fixture(false)]);
  const disabled = await temporaryCourier(false, "Disabled courier");
  expect((await request("/api/delivery-settings/courier-catalog")).status).toBe(401);
  expect((await request("/api/delivery-settings/courier-catalog", noCompany.cookie)).status).toBe(409);
  const response = await request("/api/delivery-settings/courier-catalog", seller.cookie);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const { couriers } = courierCatalogSchema.parse(await response.json());
  expect(couriers).toEqual(expect.arrayContaining([{ id: shalomId, code: "shalom", name: "Shalom" }]));
  expect(couriers.map(courier => courier.id)).not.toContain(disabled.id);
  expect(couriers.map(courier => courier.name)).toEqual([...couriers.map(courier => courier.name)].sort((a, b) => a.localeCompare(b, "en")));
});

test("courier saves reject missing, disabled and duplicated catalog couriers, keep existing ones and show renamed catalog names", async () => {
  const seller = await fixture();
  const disabled = await temporaryCourier(false);
  const renamed = await temporaryCourier(true, "Before rename");
  const base = { expectedVersion: 0, home: { enabled: false }, store: { enabled: false as const, pickupPoint: null }, agency: { enabled: false } };
  for (const courierId of [randomUUID(), disabled.id]) {
    expect((await request("/api/delivery-settings", seller.cookie, { ...base, couriers: [{ kind: "new", courierId, enabled: true }] }, "PUT")).status).toBe(422);
  }
  expect((await request("/api/delivery-settings", seller.cookie, { ...base, couriers: [{ kind: "new", courierId: shalomId, enabled: true }, { kind: "new", courierId: shalomId, enabled: false }] }, "PUT")).status).toBe(422);
  const created = await request("/api/delivery-settings", seller.cookie, { ...base, couriers: [{ kind: "new", courierId: shalomId, enabled: true }, { kind: "new", courierId: renamed.id, enabled: true }] }, "PUT");
  expect(created.status).toBe(200);
  const first = deliverySettingsSchema.parse(await created.json());
  expect(first.couriers.map(courier => courier.name).sort()).toEqual(["Before rename", "Shalom"]);
  const existing = first.couriers.map(courier => ({ kind: "existing" as const, id: courier.id, enabled: courier.enabled }));
  expect((await request("/api/delivery-settings", seller.cookie, { ...base, expectedVersion: 1, couriers: [...existing, { kind: "new", courierId: shalomId, enabled: true }] }, "PUT")).status).toBe(422);
  expect((await request("/api/delivery-settings", seller.cookie, { ...base, expectedVersion: 1, couriers: existing.slice(0, 1) }, "PUT")).status).toBe(422);
  // A catalog rename (what repeating the seed does) changes the displayed name without a settings write.
  await withCatalogAdmin(query => query('UPDATE "Courier" SET name = $1 WHERE id = $2', ["After rename", renamed.id]));
  const reloaded = deliverySettingsSchema.parse(await (await request("/api/delivery-settings", seller.cookie)).json());
  expect(reloaded).toEqual({ ...first, couriers: expect.arrayContaining(first.couriers.map(courier => courier.courierId === renamed.id ? { ...courier, name: "After rename" } : courier)) });
  expect(reloaded.couriers).toHaveLength(2);
  // Delisted catalog couriers stay configured and can be disabled.
  await withCatalogAdmin(query => query('UPDATE "Courier" SET enabled = false WHERE id = $1', [renamed.id]));
  const disabledResponse = await request("/api/delivery-settings", seller.cookie, { ...base, expectedVersion: 1, couriers: existing.map(courier => ({ ...courier, enabled: false })) }, "PUT");
  expect(disabledResponse.status).toBe(200);
  expect(deliverySettingsSchema.parse(await disabledResponse.json()).couriers).toHaveLength(2);
});

test("two courier saves with the same version produce one 409 DELIVERY_SETTINGS_CONFLICT", async () => {
  const seller = await fixture();
  const input = { expectedVersion: 0, home: { enabled: false }, store: { enabled: false as const, pickupPoint: null }, agency: { enabled: false }, couriers: [{ kind: "new", courierId: shalomId, enabled: true }] };
  const responses = await Promise.all([request("/api/delivery-settings", seller.cookie, input, "PUT"), request("/api/delivery-settings", seller.cookie, input, "PUT")]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  const conflict = responses.find(response => response.status === 409);
  expect(await conflict?.json()).toMatchObject({ code: "DELIVERY_SETTINGS_CONFLICT" });
  expect(await withTenantIsolation(seller.companyId ?? "", async () => await prisma.companyCourier.count())).toBe(1);
});

test("agency catalog lists enabled agencies of an enabled catalog courier, shared across companies whether or not they ship with it", async () => {
  const [seller, second, outsider, noCompany] = await Promise.all([fixture(), fixture(), fixture(), fixture(false)]);
  const courier = await temporaryCourier(true, "Agency courier");
  const other = await temporaryCourier(true, "Other courier");
  const miraflores = await catalogAgency(courier.id, "Beta", "150122");
  const lima = await catalogAgency(courier.id, "Alpha", "150101");
  const lambayeque = await catalogAgency(courier.id, "Gamma", "140101");
  await catalogAgency(courier.id, "Disabled", "150101", false);
  await catalogAgency(other.id, "Other courier agency", "150101");
  await withCourier(seller, courier.id, false);
  await withCourier(second, courier.id);
  const path = (courierId: string) => `/api/delivery-settings/agency-catalog?courierId=${courierId}`;
  expect((await request(path(courier.id))).status).toBe(401);
  expect((await request(path(courier.id), noCompany.cookie)).status).toBe(409);
  expect((await request("/api/delivery-settings/agency-catalog", seller.cookie)).status).toBe(400);
  expect((await request(path("not-a-uuid"), seller.cookie)).status).toBe(400);
  expect((await request(`${path(courier.id)}&companyId=${outsider.companyId}`, seller.cookie)).status).toBe(400);
  const disabledCourier = await temporaryCourier(false, "Disabled courier");
  const hidden = await request(path(disabledCourier.id), seller.cookie);
  expect(hidden.status).toBe(404);
  expect(await hidden.json()).toMatchObject({ code: "NOT_FOUND" });
  expect((await request(path(randomUUID()), seller.cookie)).status).toBe(404);
  const [first, again] = await Promise.all([request(path(courier.id), seller.cookie), request(path(courier.id), second.cookie)]);
  expect(first.status).toBe(200);
  expect(first.headers.get("cache-control")).toBe("no-store");
  const listed = agencyCatalogSchema.parse(await first.json());
  expect(listed.agencies.map(agency => agency.id)).toEqual([lambayeque, lima, miraflores]);
  expect(listed.agencies[1]).toEqual({ id: lima, courierId: courier.id, name: "Alpha", address: "Av. Test 123", enabled: true,
    location: { country: "PE", districtCode: "150101", district: "LIMA", province: "LIMA METROPOLITANA", department: "LIMA" } });
  expect(agencyCatalogSchema.parse(await again.json())).toEqual(listed);
  expect(agencyCatalogSchema.parse(await (await request(path(courier.id), outsider.cookie)).json())).toEqual(listed);
});

test("an agency with a district missing from the Peru catalog answers 500 INTERNAL_ERROR with a log and no partial list", async () => {
  const seller = await fixture();
  const courier = await temporaryCourier(true, "Broken courier");
  await catalogAgency(courier.id, "Valid", "150101");
  const broken = await catalogAgency(courier.id, "Broken", "999999");
  await withCourier(seller, courier.id);
  const error = vi.spyOn(log, "error");
  try {
    const response = await request(`/api/delivery-settings/agency-catalog?courierId=${courier.id}`, seller.cookie);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "agency_catalog_stored_data_invalid", agencyId: broken }), expect.any(String));
  } finally { error.mockRestore(); }
});
