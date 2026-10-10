import type { Product } from "../domain/product";
import type { ProductFormField, ProductFormValues } from "./product-form";
import i18n from '@mobile/i18n';

export const emptyProductForm: ProductFormValues = { name: "", description: "", sku: "", salePrice: "", purchasePrice: "", stock: "" };
const fieldLabels: Record<string, string> = { name: 'name', description: 'descriptionLabel', sku: 'optionalSku', salePrice: 'salePrice', purchasePrice: 'purchasePrice', stock: 'initialStock', initialStock: 'initialStock' };

export function valuesForProduct(product: Product): ProductFormValues {
  const variant = product.variants.length === 1 ? product.variants[0] : undefined;
  return {
    name: product.name,
    description: product.description ?? "",
    sku: variant?.sku ?? "",
    salePrice: variant?.salePrice.amount.toFixed(2) ?? "",
    purchasePrice: variant?.purchasePrice?.amount.toFixed(2) ?? "",
    stock: "",
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

export function productErrors(error: { code?: string; issues?: readonly { field: string; reason: string; maxLength?: number; scope?: string; index?: number }[] }): Partial<Record<ProductFormField, string>> {
  if (error.code === "DUPLICATE_SKU") return { sku: i18n.t('duplicateSku') };
  if (error.code === "PRODUCT_ID_CONFLICT") return { form: i18n.t('productCreationUncertain') };
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
