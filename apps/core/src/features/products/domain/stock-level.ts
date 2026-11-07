import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { Product, VariantId } from "@core/src/features/products/domain/product";

/** Units at or below which an active variant is «stock bajo». Same for every store; MCP 4/4 owns changes. */
export const lowStockThreshold = 3;

export type StockLevel = "sold_out" | "low" | "available";
/** `in_stock` is `low` plus `available`. A level applies to an active variant, never to a product total. */
export type VariantStockFilter = "in_stock" | "low" | "sold_out";

export function stockLevelOf(quantity: number): StockLevel {
  if (quantity <= 0) return "sold_out";
  return quantity <= lowStockThreshold ? "low" : "available";
}

export function matchesStockFilter(quantity: number, filter: VariantStockFilter): boolean {
  const level = stockLevelOf(quantity);
  return filter === "in_stock" ? level !== "sold_out" : level === filter;
}

/** A count that replaces a variant's stock. Whole number ≥ 0, validated by the caller. */
export type StockCount = Readonly<{ variantId: VariantId; stock: number }>;

/** A stock count the seller types: a whole number from 0 up to the safe integer bound. */
export function parseStockCount(value: unknown): Result<number, { reason: "INVALID_STOCK"; message: string }> {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return err({ reason: "INVALID_STOCK", message: "Invalid stock" });
  return ok(value);
}

/** The product total with `stock` in place of the variant's count must stay within the safe integer range. */
export function checkProductStockTotal(product: Product, variantId: VariantId, stock: number): Result<void, { reason: "INVALID_TOTAL_STOCK"; message: string }> {
  const others = product.variants.reduce((total, variant) => variant.id === variantId ? total : total + variant.stock.quantity, 0);
  return stock > Number.MAX_SAFE_INTEGER - others ? err({ reason: "INVALID_TOTAL_STOCK", message: "Total stock exceeds the supported range" }) : ok(undefined);
}
