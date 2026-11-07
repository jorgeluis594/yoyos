import type { VariantIssueField } from "./variant-row-issues";

/** What the seller typed in a variant row, as text. */
export type VariantForm = Readonly<{ salePrice: string; purchasePrice: string; stock: string; sku: string }>;
export type FieldErrors = Partial<Record<VariantIssueField, string>>;
type Translate = (key: string, options?: Record<string, unknown>) => string;
export type VariantValues = Readonly<{ salePrice: number | null; purchasePrice: number | null; stock: number | null; sku: string | null }>;

const maxAmount = 999_999_999.99;
const decimals = (text: string) => (text.trim().split(".")[1] ?? "").length;
const amountOf = (text: string) => /^\d+(?:\.\d+)?$/.test(text.trim()) ? Number(text) : null;

/** The typed values and the field texts that stop them: the same rules for a saved row's save and a «Nueva» row's Aplicar. */
export function checkVariantForm(form: VariantForm, emptyStock: "invalid" | "zero", t: Translate): Readonly<{ values: VariantValues; errors: FieldErrors }> {
  const sale = amountOf(form.salePrice);
  const purchase = form.purchasePrice.trim() ? amountOf(form.purchasePrice) : null;
  const stockText = form.stock.trim() === "" && emptyStock === "zero" ? "0" : form.stock.trim();
  const stock = /^\d+$/.test(stockText) && Number.isSafeInteger(Number(stockText)) ? Number(stockText) : null;
  const errors: FieldErrors = {
    ...(sale === null || sale <= 0 || sale > maxAmount ? { salePrice: t("salePriceInvalid") } : decimals(form.salePrice) > 2 ? { salePrice: t("maxTwoDecimals") } : {}),
    ...(form.purchasePrice.trim() && (purchase === null || purchase > maxAmount) ? { purchasePrice: t("purchasePriceInvalid") } : decimals(form.purchasePrice) > 2 ? { purchasePrice: t("maxTwoDecimals") } : {}),
    ...(stock === null ? { stock: t("initialStockInvalid") } : {}),
    ...(form.sku.trim().length > 100 ? { sku: t("maxCharacters", { count: 100 }) } : {}),
  };
  return { values: { salePrice: sale, purchasePrice: purchase, stock, sku: form.sku.trim() || null }, errors };
}
