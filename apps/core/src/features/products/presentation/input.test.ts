import { describe, expect, it } from "vitest";
import { parseCreateJson } from "@core/src/features/products/presentation/input";

const valid = { name: "Cuaderno", currency: "PEN", variants: [{ attributes: {}, salePrice: 12.5 }] };

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
