import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { resolveShippingCost } from "@core/src/features/orders/application/resolve-delivery-selection";
import { parseRatedDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
import { buildQuotationWithRates } from "@core/src/features/delivery-settings/domain/quotation";
import { validateSelectedDeliveryRate } from "@core/src/features/delivery-settings/domain/selected-delivery-rate";
import { parseDeliveryZone } from "@core/src/features/delivery-settings/domain/delivery-zone";
import type { UserId } from "@shared/identity";
import type { CourierId } from "@core/src/features/delivery-settings";
import { initialDeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";

const money = (amount: number) => ({ amount, currency: "PEN" as const });
function fixture(method: "home" | "agency" = "home") {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const zone = parseDeliveryZone({ id: id(1), method, name: "Zone", enabled: true, districtCodes: ["150122"], price: money(8) }, "PEN");
  if (!zone.success) throw new Error(zone.error.message);
  const settings = { ...initialDeliverySettings(), version: 2, home: { enabled: true }, agency: { enabled: method === "agency" },
    couriers: method === "agency" ? [{ id: id(5) as CourierId, name: "Courier", enabled: true }] : [],
    store: { enabled: true as const, pickupPoint: { name: "Shop", address: "Street", instructions: null } } };
  const built = buildQuotationWithRates({ id: id(2), companyId: id(3), createdAt: new Date(), destination: { country: "PE", districtCode: "150122" },
    settings, zones: [zone.data], rateIds: [id(4)] }, "PEN");
  if (!built.success) throw new Error(built.error.message);
  const saved = built.data.rates[0];
  const rate = validateSelectedDeliveryRate({ companyId: saved.companyId, rateId: saved.id, method, districtCode: saved.districtCode },
    { quotation: built.data.quotation, rate: saved }, settings, [zone.data], "PEN");
  if (!rate.success) throw new Error(rate.error.message);
  const recipient = { name: "Ana", phone: "999", identity: { kind: "document", documentType: "national_id", document: "12345678" } };
  const input = method === "home" ? { method, recipient, rateId: saved.id, destination: { districtCode: "150122", address: " Street ", instructions: " " } }
    : { method, recipient, rateId: saved.id, districtCode: "150122" };
  const context = { companyId: saved.companyId, author: { kind: "buyer" as const } };
  const deps = { getStoreSettings: vi.fn(async () => ok(settings)), resolveSelectedDeliveryRate: vi.fn(async () => ok(rate.data)) };
  return { input, recipient, context, settings, rate: rate.data, deps };
}

test("shipping uses the chosen rate's price and references and obtains geographic names from the server catalog", async () => {
  for (const method of ["home", "agency"] as const) {
    const f = fixture(method);
    const result = await resolveShippingCost(f.input, f.context, "PEN", money(8), f.deps);
    expect(result).toMatchObject({ success: true, data: { cost: money(8), delivery: { method, recipient: f.recipient,
      pricing: { rateId: f.rate.rateId, quotationId: f.rate.quotationId, zoneId: f.rate.zoneId, settingsVersion: 2 }, recordedBy: { kind: "buyer" },
      destination: { country: "PE", districtCode: "150122", district: "MIRAFLORES", province: "LIMA METROPOLITANA", department: "LIMA" } } } });
    expect(await resolveShippingCost(f.input, { ...f.context, author: { kind: "seller", userId: "seller" as UserId } }, "PEN", money(0),
      { ...f.deps, resolveSelectedDeliveryRate: async () => ok({ ...f.rate, price: money(0) }) })).toMatchObject({ success: true, data: {
        cost: money(0), delivery: { pricing: { rateId: f.rate.rateId }, recordedBy: { kind: "seller", userId: "seller" } },
      } });
    expect(f.deps.getStoreSettings).not.toHaveBeenCalled();
    expect(f.deps.resolveSelectedDeliveryRate).toHaveBeenCalledWith({ companyId: f.context.companyId, rateId: f.rate.rateId, method, districtCode: "150122" });
    if (method === "home") expect(result).toMatchObject({ data: { delivery: { destination: { address: "Street", instructions: null } } } });
    else expect(result).toMatchObject({ data: { delivery: { courier: null, agency: null } } });
  }
});

test("pickup uses the enabled point and explicit zero without resolving a quotation or accepting shipping references", async () => {
  const f = fixture();
  const input = { method: "store", recipient: f.recipient };
  expect(await resolveShippingCost(input, f.context, "PEN", money(0), f.deps)).toEqual(ok({ cost: money(0),
    delivery: { ...input, recordedBy: f.context.author, pickupPoint: f.settings.store.pickupPoint, settingsVersion: 2 } }));
  expect(f.deps.resolveSelectedDeliveryRate).not.toHaveBeenCalled();
  expect(await resolveShippingCost(input, f.context, "PEN", money(8), f.deps)).toMatchObject({ success: false,
    error: { code: "TOTAL_CHANGED", currentPrice: money(0) } });
  for (const extra of [{ rateId: f.rate.rateId }, { districtCode: "150122" }, { destination: { districtCode: "150122" } }, { price: money(0) }]) {
    expect((await resolveShippingCost({ ...input, ...extra }, f.context, "PEN", money(0), f.deps)).success).toBe(false);
  }
  expect(await resolveShippingCost(input, f.context, "PEN", money(0), { ...f.deps, getStoreSettings: async () => ok({ ...f.settings,
    store: { enabled: false, pickupPoint: f.settings.store.pickupPoint } }) })).toMatchObject({ success: false, error: { code: "DELIVERY_METHOD_DISABLED" } });
});

test("expected delivery price is checked independently and storage/availability errors are preserved", async () => {
  const f = fixture();
  expect(await resolveShippingCost(f.input, f.context, "PEN", money(7), f.deps)).toMatchObject({ success: false,
    error: { code: "TOTAL_CHANGED", currentPrice: money(8) } });
  for (const error of [{ code: "SERVICE_UNAVAILABLE", message: "Storage" }, { code: "RATE_UNAVAILABLE", message: "Unavailable" },
    { code: "TOTAL_CHANGED", message: "Price", currentPrice: money(10) }] as const) {
    expect(await resolveShippingCost(f.input, f.context, "PEN", money(8), { ...f.deps, resolveSelectedDeliveryRate: async () => err(error) })).toEqual(err(error));
  }
  expect(await resolveShippingCost(f.input, f.context, "PEN", money(8), { ...f.deps,
    resolveSelectedDeliveryRate: async () => ok({ ...f.rate, price: { amount: 8, currency: "USD" } }) })).toMatchObject({ success: false, error: { code: "RATE_UNAVAILABLE" } });
  const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Storage" });
  expect(await resolveShippingCost({ method: "store", recipient: f.recipient }, f.context, "PEN", money(0), { ...f.deps,
    getStoreSettings: async () => failure })).toEqual(failure);
});

test("new shipping selections reject legacy/manual prices, unknown districts and forged geographic labels", async () => {
  const f = fixture();
  for (const input of [{ ...f.input, rateId: undefined }, { ...f.input, rateId: "bad" }, { ...f.input, price: money(0) },
    { ...f.input, chargeDeliveryToCustomer: false }, { ...f.input, destination: { districtCode: "150122", district: "Fake", address: "Street", instructions: null } }]) {
    expect((await resolveShippingCost(input, f.context, "PEN", money(8), f.deps)).success).toBe(false);
  }
  expect(parseRatedDeliverySelection({ method: "agency", rateId: f.rate.rateId, recipient: f.recipient, districtCode: "999999" }))
    .toMatchObject({ success: false, error: { code: "INVALID_DISTRICT" } });
  expect(f.deps.resolveSelectedDeliveryRate).not.toHaveBeenCalled();
  for (const amount of [NaN, Infinity, -1, 8.001]) expect((await resolveShippingCost(f.input, f.context, "PEN", money(amount), f.deps)).success).toBe(false);
});
