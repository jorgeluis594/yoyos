import { describe, expect, it } from "vitest";
import { createProductRequestSchema, saveProductRequestSchema } from "@shared/contracts/products";
import { parseRequestJson, toCreateInput, toSaveInput } from "@core/src/features/products/presentation/request-input";

const valid = {
  id: "00000000-0000-4000-8000-000000000001", name: "Cuaderno", description: null, photoIds: [], currency: "PEN", options: [],
  variants: [{ values: [], sku: null, salePrice: 12.5, purchasePrice: null, initialStock: 0 }],
};
const parseCreate = (text: string) => parseRequestJson(createProductRequestSchema, text, "Invalid product input");

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
      { ...valid, photoIds: ["wrong"] },
    ]) expect(parseCreate(JSON.stringify(payload))).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  });

  it("maps the photo list of a create and keeps a save without photoIds untouched", () => {
    const photoIds = ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a2"];
    const created = parseCreate(JSON.stringify({ ...valid, photoIds }));
    if (!created.success) throw new Error("Expected a valid create");
    expect(toCreateInput(created.data).photoIds).toEqual(photoIds);
    const save = { structureVersion: 1, name: "Cuaderno", description: null, options: [], variants: [], newVariants: [], deletedVariantIds: [] };
    const productId = "00000000-0000-4000-8000-000000000001" as never;
    expect("photoIds" in toSaveInput(productId, saveProductRequestSchema.parse(save))).toBe(false);
    expect(toSaveInput(productId, saveProductRequestSchema.parse({ ...save, photoIds: [] })).photoIds).toEqual([]);
  });
});
