import type { Product } from "../domain/product";
import type { ProductFormField, ProductFormValues } from "./product-form";

export const emptyProductForm: ProductFormValues = { name: "", description: "", sku: "", salePrice: "", purchasePrice: "", stock: "" };

export function valuesForProduct(product: Product): ProductFormValues {
  const variant = product.variants.length === 1 ? product.variants[0] : undefined;
  return {
    name: product.name,
    description: product.description ?? "",
    sku: variant?.sku ?? "",
    salePrice: variant?.salePrice.amount.toString() ?? "",
    purchasePrice: variant?.purchasePrice?.amount.toString() ?? "",
    stock: "",
  };
}

export function validateProductForm(values: ProductFormValues, hasVariant = true, creating = false): Partial<Record<ProductFormField, string>> {
  const errors: Partial<Record<ProductFormField, string>> = {};
  if (!values.name.trim()) errors.name = "Escribe el nombre del producto.";
  else if ([...values.name].length > 200) errors.name = "Usa como máximo 200 caracteres.";
  if ([...values.description].length > 5000) errors.description = "Usa como máximo 5000 caracteres.";
  if (hasVariant) {
    if (values.sku.trim().length > 100) errors.sku = "Usa como máximo 100 caracteres.";
    const sale = Number(values.salePrice);
    if (!/^\d+(?:\.\d{0,2})?$/.test(values.salePrice) || !Number.isFinite(sale) || sale <= 0 || sale > 999999999.99) errors.salePrice = "Ingresa un precio mayor que cero, con hasta dos decimales.";
    if (values.purchasePrice.trim()) {
      const purchase = Number(values.purchasePrice);
      if (!/^\d+(?:\.\d{0,2})?$/.test(values.purchasePrice) || !Number.isFinite(purchase) || purchase < 0 || purchase > 999999999.99) errors.purchasePrice = "Ingresa un precio no negativo, con hasta dos decimales.";
    }
    if (creating && values.stock.trim() && (!/^\d+$/.test(values.stock) || !Number.isSafeInteger(Number(values.stock)))) errors.stock = "Ingresa un número entero no negativo.";
  }
  return errors;
}

export function productErrors(error: { code?: string; issues?: readonly { field: string; reason: string; maxLength?: number; scope?: string; index?: number }[] }): Partial<Record<ProductFormField, string>> {
  if (error.code === "DUPLICATE_SKU") return { sku: "Este SKU ya está en uso." };
  if (error.code === "PRODUCT_ID_CONFLICT") return { form: "No se pudo confirmar si se creó este producto. Revisa el catálogo antes de iniciar otra creación." };
  if (error.code === "PRODUCT_NOT_FOUND") return { form: "Producto no encontrado." };
  if (error.code === "IMAGE_NOT_FOUND") return { form: "La imagen ya no está disponible." };
  if (error.code === "VALIDATION_ERROR" || error.code === "INVALID_INPUT") {
    const mapped: Partial<Record<ProductFormField, string>> = {};
    for (const issue of error.issues ?? []) {
      const field = issue.field.split(".").at(-1);
      if (["name", "description", "sku", "salePrice", "purchasePrice", "stock", "initialStock"].includes(field ?? "")) {
        const key = field === "initialStock" ? "stock" : field as ProductFormField;
        mapped[key] = issue.reason === "TOO_LONG" ? `Usa como máximo ${issue.maxLength ?? ""} caracteres.`
          : issue.reason === "DUPLICATE_SKU" ? "Este SKU ya está en uso."
          : `Revisa el campo ${field}.`;
      } else mapped.form = "Revisa los datos del producto.";
    }
    return Object.keys(mapped).length ? mapped : { form: "Revisa los datos del producto." };
  }
  return { form: "No se pudo guardar. Revisa tu conexión e inténtalo otra vez." };
}
