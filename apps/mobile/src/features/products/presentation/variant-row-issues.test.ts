import type { VariantActionError } from "../application/variant-operations";
import { variantIssueText } from "./variant-row-issues";

// The keys come back as the text so each assertion reads as the mapping it checks.
const t = (key: string, options?: Record<string, unknown>) => options?.field ? `${key}:${String(options.field)}` : key;
const refused = (field: string, reason: string, code: VariantActionError["code"] = "VALIDATION_ERROR"): VariantActionError => ({ code, message: "x", issues: [{ field, reason }] });

test("maps every stock reason to its text", () => {
  expect(["INVALID_STOCK", "INVALID_TYPE", "REQUIRED"].map((reason) => variantIssueText(refused("stock", reason), t)[0])).toEqual(
    Array(3).fill({ kind: "field", field: "stock", text: "initialStockInvalid" }));
  expect(variantIssueText(refused("stock", "INVALID_TOTAL_STOCK"), t)).toEqual([{ kind: "field", field: "stock", text: "totalStockInvalid" }]);
  expect(variantIssueText(refused("initialStock", "INVALID_STOCK"), t)).toEqual([{ kind: "field", field: "stock", text: "initialStockInvalid" }]);
});

test("maps INVALID_PRECISION to the two-decimals text", () => {
  expect(variantIssueText(refused("salePrice", "INVALID_PRECISION"), t)).toEqual([{ kind: "field", field: "salePrice", text: "maxTwoDecimals" }]);
  expect(variantIssueText(refused("purchasePrice", "INVALID_PRECISION"), t)).toEqual([{ kind: "field", field: "purchasePrice", text: "maxTwoDecimals" }]);
});

test("maps prices and SKU, also a DUPLICATE_SKU answer without issues", () => {
  expect(variantIssueText(refused("salePrice", "INVALID_PRICE"), t)[0]).toMatchObject({ text: "salePriceInvalid" });
  expect(variantIssueText(refused("purchasePrice", "INVALID_PRICE"), t)[0]).toMatchObject({ text: "purchasePriceInvalid" });
  expect(variantIssueText(refused("sku", "TOO_LONG"), t)[0]).toMatchObject({ field: "sku", text: "maxCharacters" });
  expect(variantIssueText({ code: "DUPLICATE_SKU", message: "x" }, t)).toEqual([{ kind: "field", field: "sku", text: "variantSkuInUse" }]);
  expect(variantIssueText(refused("sku", "DUPLICATE_SKU", "DUPLICATE_SKU"), t)).toEqual([{ kind: "field", field: "sku", text: "variantSkuInUse" }]);
});

test("maps a known field with an unknown reason to the not-accepted text", () => {
  expect(variantIssueText(refused("stock", "SOMETHING_NEW"), t)).toEqual([{ kind: "field", field: "stock", text: "valueNotAccepted" }]);
});

test("names an unknown field or a missing issue at the top of the form", () => {
  expect(variantIssueText(refused("color", "X", "INVALID_INPUT"), t)).toEqual([{ kind: "form", text: "unknownIssue:color" }]);
  expect(variantIssueText({ code: "VALIDATION_ERROR", message: "x" }, t)).toEqual([{ kind: "form", text: "unknownIssue:VALIDATION_ERROR" }]);
});

test("never answers the generic save text for a known field", () => {
  for (const field of ["salePrice", "purchasePrice", "stock", "sku"]) {
    for (const reason of ["INVALID_STOCK", "INVALID_PRICE", "UNKNOWN_FIELD", "ANYTHING"]) {
      expect(variantIssueText(refused(field, reason), t)[0].text).not.toMatch(/SaveError$/);
    }
  }
});
