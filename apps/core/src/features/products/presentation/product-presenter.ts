import {
  productDetailResponseSchema,
  productIdResponseSchema,
  productListResponseSchema,
  type ProductDetailResponse,
  type ProductIdResponse,
  type ProductListResponse,
} from "@shared/contracts/products";
import type { Detail } from "@core/src/features/products/application/get";
import type { ListOutput } from "@core/src/features/products/application/list";
import type { ProductId } from "@core/src/features/products/domain/product";

export function toProductListResponse(output: ListOutput): ProductListResponse {
  return productListResponseSchema.parse({
    ...output,
    items: output.items.map((item) => ({
      id: item.id, name: item.name, variantCount: item.variantCount, activeVariantCount: item.activeVariantCount,
      ...(item.sku === undefined ? {} : { sku: item.sku }),
      minSalePrice: item.minSalePrice, hasDifferentPrices: item.hasDifferentPrices, totalStock: item.totalStock,
      ...(item.image === undefined ? {} : { image: item.image }),
    })),
  });
}

export function toProductDetailResponse(detail: Detail): ProductDetailResponse {
  const { product } = detail;
  return productDetailResponseSchema.parse({
    product: {
      id: product.id, name: product.name,
      description: product.description ?? null,
      imageId: product.imageId ?? null,
      currency: product.currency, qrCode: product.qrCode,
      createdAt: product.createdAt.toISOString(), updatedAt: product.updatedAt.toISOString(),
      structureVersion: product.structureVersion,
      options: product.options.map((option) => ({ id: option.id, name: option.name, values: option.values.map((value) => ({ id: value.id, name: value.name })) })),
      variants: product.variants.map((variant) => ({
        id: variant.id,
        combination: product.options.map((option) => ({ optionId: option.id, valueId: variant.combination[option.id] })),
        sku: variant.sku ?? null,
        salePrice: variant.salePrice,
        purchasePrice: variant.purchasePrice ?? null,
        qrCode: variant.qrCode, status: variant.status, stock: variant.stock.quantity,
        hasOrders: detail.orderedVariantIds.has(variant.id),
      })),
    },
    image: detail.image ?? null,
  });
}

export function toProductIdResponse(id: ProductId): ProductIdResponse {
  return productIdResponseSchema.parse({ id });
}
