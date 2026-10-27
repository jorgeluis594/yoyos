import { draftFromProduct, type EditorDraft } from "@shared/product-variants";
import type { Product } from "./product";

/** The editor draft of a saved product. Fields the editor never reads (product QR, timestamps) are left empty. */
export function editorDraftOf(product: Product): EditorDraft {
  return draftFromProduct({
    id: product.id, name: product.name, description: product.description ?? null, imageId: product.photo?.id ?? null,
    currency: product.currency, qrCode: "", createdAt: "", updatedAt: "", structureVersion: product.structureVersion,
    options: product.options.map((option) => ({ id: option.id, name: option.name, values: option.values.map((value) => ({ id: value.id, name: value.name })) })),
    variants: product.variants.map((variant) => ({
      id: variant.id, combination: variant.combination.map((entry) => ({ optionId: entry.optionId, valueId: entry.valueId })),
      sku: variant.sku ?? null, salePrice: variant.salePrice, purchasePrice: variant.purchasePrice ?? null, qrCode: variant.qrCode,
      status: variant.status, stock: variant.stock, hasOrders: variant.hasOrders,
    })),
  });
}
