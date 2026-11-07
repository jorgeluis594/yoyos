import { draftFromProduct, type EditorDraft } from "@shared/product-variants";
import type { ProductDetailResponse } from "@shared/contracts/products";
import type { Product } from "./product";

/** The product as the shared editor reads it. Fields the editor never reads (visibility, product QR, timestamps) are left empty. */
export function editorProductOf(product: Product): ProductDetailResponse["product"] {
  return {
    id: product.id, name: product.name, description: product.description ?? null, hidden: false, photos: product.photos.map((photo) => ({ id: photo.id, url: photo.url })),
    currency: product.currency, qrCode: "", createdAt: "", updatedAt: "", structureVersion: product.structureVersion,
    options: product.options.map((option) => ({ id: option.id, name: option.name, values: option.values.map((value) => ({ id: value.id, name: value.name })) })),
    variants: product.variants.map((variant) => ({
      id: variant.id, combination: variant.combination.map((entry) => ({ optionId: entry.optionId, valueId: entry.valueId })),
      sku: variant.sku ?? null, salePrice: variant.salePrice, purchasePrice: variant.purchasePrice ?? null, qrCode: variant.qrCode,
      status: variant.status, stock: variant.stock, hasOrders: variant.hasOrders,
    })),
  };
}

/** The editor draft of a saved product. */
export const editorDraftOf = (product: Product): EditorDraft => draftFromProduct(editorProductOf(product));
