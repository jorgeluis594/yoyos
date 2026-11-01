import { orderedRows, removalOf, type EditorBase, type EditorDraft } from "@shared/product-variants";
import type { Product } from "../domain/product";
import type { ProductFormField, ProductFormValues } from "./product-form";
import i18n from '@mobile/i18n';

export const emptyProductForm: ProductFormValues = { name: "", description: "", sku: "", salePrice: "", purchasePrice: "", stock: "", hidden: false };
const fieldLabels: Record<string, string> = { name: 'name', description: 'descriptionLabel', sku: 'optionalSku', salePrice: 'salePrice', purchasePrice: 'purchasePrice', stock: 'initialStock', initialStock: 'initialStock' };

export function valuesForProduct(product: Product): ProductFormValues {
  const variant = product.options.length === 0 ? product.variants[0] : undefined;
  return {
    name: product.name,
    description: product.description ?? "",
    sku: variant?.sku ?? "",
    salePrice: variant?.salePrice.amount.toFixed(2) ?? "",
    purchasePrice: variant?.purchasePrice?.amount.toFixed(2) ?? "",
    stock: "",
    hidden: product.hidden,
  };
}

export function validateProductForm(values: ProductFormValues, hasVariant = true, creating = false): Partial<Record<ProductFormField, string>> {
  const errors: Partial<Record<ProductFormField, string>> = {};
  if (!values.name.trim()) errors.name = i18n.t('productNameRequired');
  else if ([...values.name].length > 200) errors.name = i18n.t('maxCharacters', { count: 200 });
  if ([...values.description].length > 5000) errors.description = i18n.t('maxCharacters', { count: 5000 });
  if (hasVariant) {
    if (values.sku.trim().length > 100) errors.sku = i18n.t('maxCharacters', { count: 100 });
    const sale = Number(values.salePrice);
    if (!/^\d+(?:\.\d{0,2})?$/.test(values.salePrice) || !Number.isFinite(sale) || sale <= 0 || sale > 999999999.99) errors.salePrice = i18n.t('salePriceInvalid');
    if (values.purchasePrice.trim()) {
      const purchase = Number(values.purchasePrice);
      if (!/^\d+(?:\.\d{0,2})?$/.test(values.purchasePrice) || !Number.isFinite(purchase) || purchase < 0 || purchase > 999999999.99) errors.purchasePrice = i18n.t('purchasePriceInvalid');
    }
    if (creating && values.stock.trim() && (!/^\d+$/.test(values.stock) || !Number.isSafeInteger(Number(values.stock)))) errors.stock = i18n.t('initialStockInvalid');
  }
  return errors;
}

/** The request may have reached core: the outcome is unknown until the product is read again. */
export const uncertainCodes: readonly string[] = ["NETWORK_ERROR", "SERVER_ERROR", "SERVICE_UNAVAILABLE"];

export function productErrors(error: { code?: string; issues?: readonly { field: string; reason: string; maxLength?: number; scope?: string; index?: number }[] }, hasOptions = false): Partial<Record<ProductFormField, string>> {
  // With options the SKU field is not on the form, so the conflict is reported above it.
  if (error.code === "DUPLICATE_SKU") return hasOptions ? { form: i18n.t('duplicateSku') } : { sku: i18n.t('duplicateSku') };
  if (error.code === "PRODUCT_ID_CONFLICT") return { form: i18n.t('productCreationUncertain') };
  if (error.code === "PRODUCT_CHANGED") return { form: i18n.t('productChanged') };
  if (error.code === "DUPLICATE_COMBINATION" || error.code === "ID_CONFLICT" || error.code === "VARIANT_HAS_ORDERS") return { form: i18n.t('reviewProductData') };
  if (error.code === "PRODUCT_NOT_FOUND") return { form: i18n.t('productNotFound') };
  if (error.code === "IMAGE_NOT_FOUND") return { form: i18n.t('imageNotFound') };
  if (error.code === "VALIDATION_ERROR" || error.code === "INVALID_INPUT") {
    const mapped: Partial<Record<ProductFormField, string>> = {};
    for (const issue of error.issues ?? []) {
      const field = issue.field.split(".").at(-1);
      if (["name", "description", "sku", "salePrice", "purchasePrice", "stock", "initialStock"].includes(field ?? "")) {
        const key = field === "initialStock" ? "stock" : field as ProductFormField;
        mapped[key] = issue.reason === "TOO_LONG" ? i18n.t('maxCharacters', { count: issue.maxLength ?? '' })
          : issue.reason === "DUPLICATE_SKU" ? i18n.t('duplicateSku')
          : i18n.t('reviewField', { field: i18n.t(fieldLabels[field ?? '']) });
      } else mapped.form = i18n.t('reviewProductData');
    }
    return Object.keys(mapped).length ? mapped : { form: i18n.t('reviewProductData') };
  }
  return { form: i18n.t('saveProductError') };
}

/** The form's SKU, prices and stock as the base the first generated combinations copy. A missing price stays 0 and is flagged on the rows. */
export function baseOf(values: ProductFormValues): EditorBase {
  const amount = (text: string) => /^\d+(?:\.\d{0,2})?$/.test(text.trim()) ? Number(text) : null;
  return {
    sku: values.sku.trim() || null,
    salePrice: amount(values.salePrice) ?? 0,
    purchasePrice: amount(values.purchasePrice),
    stock: /^\d+$/.test(values.stock.trim()) ? Number(values.stock) : 0,
  };
}

const decimals = (value: number) => (String(value).split(".")[1] ?? "").length;

/** What core would reject on a variant row anyway, found before sending so the rows can be marked. */
export function rowErrors(draft: EditorDraft): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const row of orderedRows(draft).filter((candidate) => removalOf(draft, candidate) === null)) {
    if (!Number.isFinite(row.salePrice) || row.salePrice <= 0 || row.salePrice > 999999999.99) errors[row.ref] = i18n.t('missingPrice');
    else if (decimals(row.salePrice) > 2 || row.purchasePrice !== null && decimals(row.purchasePrice) > 2) errors[row.ref] = i18n.t('maxTwoDecimals');
    else if (row.purchasePrice !== null && (!Number.isFinite(row.purchasePrice) || row.purchasePrice < 0 || row.purchasePrice > 999999999.99)) errors[row.ref] = i18n.t('purchasePriceInvalid');
    else if (!Number.isSafeInteger(row.stock) || row.stock < 0) errors[row.ref] = i18n.t('initialStockInvalid');
    else if ((row.sku?.trim().length ?? 0) > 100) errors[row.ref] = i18n.t('maxCharacters', { count: 100 });
  }
  return errors;
}
