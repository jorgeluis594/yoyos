import { expect, test } from "vitest";
import { createQuotationRequestSchema, quotationResponseSchema } from "@shared/contracts/quotations";

const id = "00000000-0000-4000-8000-000000000001";
const destination = { country: "PE", districtCode: "150122", address: null, instructions: null };
test("quotation input is strict and never accepts client-owned identities or prices", () => {
  expect(createQuotationRequestSchema.safeParse({ destination }).success).toBe(true);
  expect(createQuotationRequestSchema.safeParse({ destination, orderId: id }).success).toBe(true);
  for (const body of [{}, { destination: null }, { destination, orderId: null }, { destination, orderId: "bad" },
    ...["companyId", "quotationId", "rateId", "price", "settingsVersion", "createdAt"].map(key => ({ destination, [key]: id })),
    { destination: { ...destination, kind: "home" } }]) {
    expect(createQuotationRequestSchema.safeParse(body).success).toBe(false);
  }
});
test("quotation output preserves every same-method rate and explicitly allows an empty quotation", () => {
  const base = { id, destination, createdAt: "2026-10-07T16:00:00.000Z" };
  expect(quotationResponseSchema.parse({ ...base, rates: [] }).rates).toEqual([]);
  const rates = [0, 8, 8].map((amount, index) => ({ id: id.slice(0, -1) + (index + 2), method: "home", optionId: id, name: "Option", zoneName: "Zone", price: { amount, currency: "PEN" } }));
  expect(quotationResponseSchema.parse({ ...base, rates }).rates).toHaveLength(3);
  for (const change of [{ method: "store" }, { label: "Internal zone" }, { name: "" }, { zoneName: " " }, { optionId: "bad" }, { zoneId: id }, { quotationId: id },
    { price: { amount: -1, currency: "PEN" } }, { price: { amount: 8.001, currency: "PEN" } }]) {
    expect(quotationResponseSchema.safeParse({ ...base, rates: [{ ...rates[0], ...change }] }).success).toBe(false);
  }
  expect(quotationResponseSchema.safeParse({ ...base, rates, total: { amount: 8, currency: "PEN" } }).success).toBe(false);
});
test("agency rates carry at least one eligible agency with its courier and catalog location", () => {
  const location = { country: "PE", districtCode: "150122", district: "Miraflores", province: "Lima", department: "Lima" };
  const agency = { id, name: "Agency", address: "Av. Test 123", location, courier: { id, name: "Shalom" } };
  const rate = { id, method: "agency", optionId: id, name: "Agency", zoneName: "Zone", price: { amount: 5, currency: "PEN" }, agencies: [agency] };
  const base = { id, destination, createdAt: "2026-10-07T16:00:00.000Z" };
  expect(quotationResponseSchema.safeParse({ ...base, rates: [rate] }).success).toBe(true);
  for (const change of [{ agencies: [] }, { agencies: undefined }, { agencies: [{ ...agency, courier: null }] }, { agencies: [{ ...agency, location: { ...location, districtCode: "x" } }] },
    { agencies: [{ ...agency, address: "" }] }]) {
    expect(quotationResponseSchema.safeParse({ ...base, rates: [{ ...rate, ...change }] }).success).toBe(false);
  }
  expect(quotationResponseSchema.safeParse({ ...base, rates: [{ ...rate, method: "home" }] }).success).toBe(false);
});
test("quotation request accepts an optional trigger and rejects unknown values", () => {
  expect(createQuotationRequestSchema.safeParse({ destination, trigger: "picked" }).success).toBe(true);
  expect(createQuotationRequestSchema.safeParse({ destination, trigger: "automatic" }).success).toBe(true);
  expect(createQuotationRequestSchema.safeParse({ destination }).success).toBe(true);
  for (const trigger of ["manual", "", null, 1]) expect(createQuotationRequestSchema.safeParse({ destination, trigger }).success).toBe(false);
});
