import { describe, expect, it } from "vitest";
import { parseCreateJson, parseUpdateJson } from "@core/src/features/products/presentation/input";

const valid = { name: "Cuaderno", currency: "PEN", variants: [{ attributes: {}, salePrice: 12.5 }] };
const id = "00000000-0000-4000-8000-000000000011";

describe("create product JSON input", () => {
  it("accepts the single-variant form payload", () => {
    expect(parseCreateJson(JSON.stringify(valid))).toEqual({ success: true, data: valid });
  });

  it("rejects malformed JSON, forbidden identity and fields, and invalid nested types", () => {
    expect(parseCreateJson("{")).toMatchObject({ success: false, error: { code: "MALFORMED_JSON" } });
    for (const payload of [
      { ...valid, companyId: crypto.randomUUID() },
      { ...valid, variants: [{ ...valid.variants[0], qrCode: "manual" }] },
      { ...valid, variants: [{ ...valid.variants[0], salePrice: "12.5" }] },
      { ...valid, imageId: "wrong" },
    ]) expect(parseCreateJson(JSON.stringify(payload))).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  });
});

describe("update product JSON input", () => {
  it("preserves omitted values, explicit nulls, and variant order", () => {
    const payload = { name: "Camisa", description: null, variants: [{ id, sku: null, purchasePrice: 0 }, { id: crypto.randomUUID(), salePrice: 5 }] };
    const result = parseUpdateJson(JSON.stringify(payload));
    expect(result).toEqual({ success: true, data: payload });
    expect(parseUpdateJson("{}")).toEqual({ success: true, data: {} });
  });

  it("rejects malformed JSON, unknown or non-editable fields, and invalid identifiers", () => {
    expect(parseUpdateJson("{")).toMatchObject({ success: false, error: { code: "MALFORMED_JSON" } });
    for (const payload of [
      { currency: "PEN" },
      { stock: 4 },
      { variants: [{ id, attributes: {} }] },
      { variants: [{ id, qrCode: "manual" }] },
      { variants: [{ id: "not-a-uuid" }] },
      { variants: [{ id, salePrice: "12.5" }] },
      { variants: "invalid" },
    ]) expect(parseUpdateJson(JSON.stringify(payload))).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  });
});
