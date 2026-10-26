import { describe, expect, it } from "vitest";
import { createProductRequestSchema, updateProductRequestSchema } from "@shared/contracts/products";
import { parseRequestJson, toCreateInput, toUpdateInput } from "@core/src/features/products/presentation/request-input";

const id = "00000000-0000-4000-8000-000000000011";
const valid = {
  id: "00000000-0000-4000-8000-000000000001", name: "Cuaderno", description: null, imageId: null, currency: "PEN", options: [],
  variants: [{ values: [], sku: null, salePrice: 12.5, purchasePrice: null, initialStock: 0 }],
};
const parseCreate = (text: string) => parseRequestJson(createProductRequestSchema, text, "Invalid product input");
const parseUpdate = (text: string) => parseRequestJson(updateProductRequestSchema, text, "Invalid product update");

describe("create product JSON input", () => {
  it("accepts the product without options form payload and maps it to the use case input", () => {
    const parsed = parseCreate(JSON.stringify(valid));
    expect(parsed).toEqual({ success: true, data: valid });
    if (parsed.success) expect(toCreateInput(parsed.data)).toMatchObject({ id: valid.id, options: [], variants: [{ values: [], salePrice: 12.5 }] });
  });

  it("rejects malformed JSON, forbidden identity and fields, and invalid nested types", () => {
    expect(parseCreate("{")).toMatchObject({ success: false, error: { code: "MALFORMED_JSON" } });
    for (const payload of [
      { ...valid, companyId: crypto.randomUUID() },
      { ...valid, variants: [{ ...valid.variants[0], qrCode: "manual" }] },
      { ...valid, variants: [{ ...valid.variants[0], salePrice: "12.5" }] },
      { ...valid, variants: [{ ...valid.variants[0], attributes: {} }] },
      { ...valid, imageId: "wrong" },
    ]) expect(parseCreate(JSON.stringify(payload))).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  });
});

describe("update product JSON input", () => {
  it("preserves omitted values, explicit nulls, and variant order", () => {
    const payload = { name: "Camisa", description: null, variants: [{ id, sku: null, purchasePrice: 0 }, { id: crypto.randomUUID(), salePrice: 5 }] };
    const result = parseUpdate(JSON.stringify(payload));
    expect(result).toEqual({ success: true, data: payload });
    if (result.success) expect(toUpdateInput(result.data)).toEqual(payload);
    expect(parseUpdate("{}")).toEqual({ success: true, data: {} });
  });

  it("rejects malformed JSON, unknown or non-editable fields, and invalid identifiers", () => {
    expect(parseUpdate("{")).toMatchObject({ success: false, error: { code: "MALFORMED_JSON" } });
    for (const payload of [
      { currency: "PEN" },
      { stock: 4 },
      { variants: [{ id, attributes: {} }] },
      { variants: [{ id, qrCode: "manual" }] },
      { variants: [{ id: "not-a-uuid" }] },
      { variants: [{ id, salePrice: "12.5" }] },
      { variants: "invalid" },
    ]) expect(parseUpdate(JSON.stringify(payload))).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  });
});
