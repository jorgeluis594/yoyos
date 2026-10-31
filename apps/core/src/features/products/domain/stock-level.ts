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
