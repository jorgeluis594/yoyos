import * as Crypto from "expo-crypto";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { validateProduct } from "../domain/product";
import type { Product, ProductError, ProductInput, ProductStock, ProductVariant } from "../domain/product";

export function generateProduct(input: ProductInput): Result<Product, ProductError> {
  const validation = validateProduct(input);
  if (!validation.success) return err(validation.error);

  const id = input.id ?? Crypto.randomUUID();
  const variants: ProductVariant[] = [];
  const stocks: ProductStock[] = [];
  for (const variant of input.variants) {
    const variantId = variant.id ?? Crypto.randomUUID();
    variants.push({
      id: variantId,
      productId: id,
      attributes: { ...variant.attributes },
      sku: variant.sku,
      qrCode: Crypto.randomUUID(),
      salePrice: { amount: variant.salePrice, currency: input.currency },
      ...(variant.purchasePrice === undefined ? {} : { purchasePrice: { amount: variant.purchasePrice, currency: input.currency } }),
      status: "active",
    });
    stocks.push({ variantId, quantity: variant.initialQuantity ?? 0 });
  }
  return ok({
    id,
    name: input.name,
    ...(input.photo === undefined ? {} : { photo: input.photo }),
    ...(input.category === undefined ? {} : { category: input.category }),
    ...(input.description === undefined ? {} : { description: input.description }),
    currency: input.currency,
    qrCode: Crypto.randomUUID(),
    status: "active",
    variants,
    stocks,
  });
}
