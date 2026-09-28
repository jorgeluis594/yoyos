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
      id: item.id, name: item.name, variantCount: item.variantCount,
      ...(item.sku === undefined ? {} : { sku: item.sku }),
      minSalePrice: item.minSalePrice, hasDifferentPrices: item.hasDifferentPrices, totalStock: item.totalStock,
    })),
  });
}

export function toProductDetailResponse(detail: Detail): ProductDetailResponse {
  const { product } = detail;
  return productDetailResponseSchema.parse({
    product: {
      id: product.id, name: product.name,
      ...(product.description === undefined ? {} : { description: product.description }),
      ...(product.imageId === undefined ? {} : { imageId: product.imageId }),
      currency: product.currency, qrCode: product.qrCode, status: product.status,
      createdAt: product.createdAt.toISOString(), updatedAt: product.updatedAt.toISOString(),
      variants: product.variants.map((variant) => ({
        id: variant.id, productId: variant.productId, attributes: variant.attributes,
        ...(variant.sku === undefined ? {} : { sku: variant.sku }),
        salePrice: variant.salePrice,
        ...(variant.purchasePrice === undefined ? {} : { purchasePrice: variant.purchasePrice }),
        qrCode: variant.qrCode, status: variant.status, stock: variant.stock,
      })),
    },
    ...(detail.image === undefined ? {} : { image: detail.image }),
  });
}

export function toProductIdResponse(id: ProductId): ProductIdResponse {
  return productIdResponseSchema.parse({ id });
}
