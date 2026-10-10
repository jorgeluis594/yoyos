import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { initialDeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { parseDeliveryZone } from "@core/src/features/delivery-settings/domain/delivery-zone";
import type { QuotationWithRates } from "@core/src/features/delivery-settings/domain/quotation";
import { createQuotation, type CreateQuotationDependencies, type DeliveryConfiguration } from "@core/src/features/delivery-settings/application/create-quotation";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const input = { companyId: id(1), country: "PE", districtCode: "150122", address: null, instructions: null };
const configuration = (): DeliveryConfiguration => {
  const zone = parseDeliveryZone({ id: id(2), name: "Zone", method: "home", enabled: true, districtCodes: ["150122"], price: { amount: 8, currency: "PEN" } }, "PEN");
  if (!zone.success) throw new Error(zone.error.message);
  return { country: "PE", currency: "PEN", settings: { ...initialDeliverySettings(), home: { enabled: true }, version: 7 }, zones: [zone.data] };
};
function fake(config = configuration()) {
  let sequence = 10;
  const stored: QuotationWithRates[] = [];
  const deps: CreateQuotationDependencies = {
    transaction: async (companyId, work) => {
      expect(companyId).toBe(input.companyId);
      return work();
    },
    readConfigurationForShare: async () => ok(config),
    insertQuotationWithRates: async value => { stored.push(value); return ok(null); },
    generateId: () => id(sequence++), now: () => new Date("2026-10-07T16:00:00Z"),
  };
  return { deps, stored };
}

test("quotation persists and returns the complete generated aggregate without altering configuration", async () => {
  const config = configuration();
  const { deps, stored } = fake(config);
  const result = await createQuotation(input, deps);
  expect(result).toMatchObject({ success: true, data: { quotation: { id: id(10), companyId: input.companyId },
    rates: [{ id: id(11), quotationId: id(10), settingsVersion: 7, price: { amount: 8, currency: "PEN" } }] } });
  expect(stored).toHaveLength(1);
  if (result.success) expect(stored[0]).toEqual(result.data);
  expect(config).toEqual(configuration());
});

test("valid destination without coverage persists a quotation with zero rates", async () => {
  const { deps, stored } = fake({ ...configuration(), zones: [] });
  expect(await createQuotation(input, deps)).toMatchObject({ success: true, data: { quotation: { id: id(10) }, rates: [] } });
  expect(stored).toHaveLength(1);
  expect(stored[0].rates).toEqual([]);
});

test("invalid identity, country, district or destination rejects without persistence", async () => {
  for (const change of [{ companyId: "bad" }, { country: "US" }, { districtCode: "999999" }, { districtCode: "" }, { address: "a".repeat(501) }]) {
    const { deps, stored } = fake();
    expect((await createQuotation({ ...input, ...change }, { ...deps,
      readConfigurationForShare: async () => { throw new Error("Rejected input must not access persistence"); },
    })).success).toBe(false);
    expect(stored).toEqual([]);
  }
});

test("storage failures propagate rather than returning empty coverage or a successful quotation", async () => {
  const failure = err({ code: "SERVICE_UNAVAILABLE" as const, message: "Database unavailable" });
  const read = fake();
  expect(await createQuotation(input, { ...read.deps, readConfigurationForShare: async () => failure })).toEqual(failure);
  expect(read.stored).toEqual([]);
  const write = fake();
  expect(await createQuotation(input, { ...write.deps, insertQuotationWithRates: async () => failure })).toEqual(failure);
  expect(write.stored).toEqual([]);
});

test("retries create fresh quotation and rate identities without changing the settings version", async () => {
  const { deps, stored } = fake();
  expect((await createQuotation(input, deps)).success).toBe(true);
  expect((await createQuotation(input, deps)).success).toBe(true);
  expect(stored.map(value => value.quotation.id)).toEqual([id(10), id(12)]);
  expect(stored.map(value => value.rates[0].id)).toEqual([id(11), id(13)]);
  expect(stored.map(value => value.rates[0].settingsVersion)).toEqual([7, 7]);
});

test("business country and currency must match the Peru pilot before writing", async () => {
  for (const config of [{ ...configuration(), country: "US" }, { ...configuration(), currency: "USD" as const }]) {
    const { deps, stored } = fake(config);
    expect((await createQuotation(input, deps)).success).toBe(false);
    expect(stored).toEqual([]);
  }
});
