import type { VariantActionError } from "../application/variant-operations";

type Translate = (key: string, options?: Record<string, unknown>) => string;
export type VariantIssueField = "salePrice" | "purchasePrice" | "stock" | "sku";
/** A refusal as the editor shows it: under its field, or as a text of the whole form. */
export type VariantIssueText = Readonly<{ kind: "field"; field: VariantIssueField; text: string }> | Readonly<{ kind: "form"; text: string }>;

const fields: readonly string[] = ["salePrice", "purchasePrice", "stock", "sku"];

/** The text of one known field and reason; null when the reason is not one core sends for that field. */
function reasonText(field: VariantIssueField, reason: string, t: Translate): string | null {
  switch (field) {
    case "stock":
      if (reason === "INVALID_TOTAL_STOCK") return t("totalStockInvalid");
      return ["INVALID_STOCK", "INVALID_TYPE", "REQUIRED"].includes(reason) ? t("initialStockInvalid") : null;
    case "salePrice":
      return reason === "INVALID_PRICE" ? t("salePriceInvalid") : reason === "INVALID_PRECISION" ? t("maxTwoDecimals") : null;
    case "purchasePrice":
      return reason === "INVALID_PRICE" ? t("purchasePriceInvalid") : reason === "INVALID_PRECISION" ? t("maxTwoDecimals") : null;
    case "sku":
      return reason === "TOO_LONG" ? t("maxCharacters", { count: 100 }) : reason === "DUPLICATE_SKU" ? t("variantSkuInUse") : null;
  }
}

function issueText(field: string, reason: string, t: Translate): VariantIssueText {
  const name = field === "initialStock" ? "stock" : field;
  if (!fields.includes(name)) return { kind: "form", text: t("unknownIssue", { field: field || reason }) };
  const known = name as VariantIssueField;
  return { kind: "field", field: known, text: reasonText(known, reason, t) ?? t("valueNotAccepted") };
}

/** Every refusal of a variant save mapped by field and reason, never by the server's message. `DUPLICATE_SKU` without issues is the SKU field. */
export function variantIssueText(error: VariantActionError, t: Translate): readonly VariantIssueText[] {
  const issues = error.issues ?? [];
  if (issues.length > 0) return issues.map((issue) => issueText(issue.field, issue.reason, t));
  if (error.code === "DUPLICATE_SKU") return [issueText("sku", "DUPLICATE_SKU", t)];
  return [{ kind: "form", text: t("unknownIssue", { field: error.code }) }];
}
