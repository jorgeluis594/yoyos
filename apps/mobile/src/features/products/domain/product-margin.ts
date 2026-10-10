import { andThen, err, map } from "@shared/functional";
import { compare, subtract, type Money, type MoneyError } from "@shared/money";
import type { Result } from "@shared/result";

export type ProductMargin = Readonly<{ profit: Money; percent: number }>;

// Margin in tenths of a percent from whole cents, rounding halves away from zero so gains and losses mirror.
function marginPercent(profit: Money, salePrice: Money): number {
  const tenths = (Math.round(profit.amount * 100) * 1000) / Math.round(salePrice.amount * 100);
  return (Math.sign(tenths) * Math.round(Math.abs(tenths))) / 10 || 0;
}

/** Profit per unit and margin over the sale price; the margin is rounded to one decimal. */
export function productMargin(salePrice: Money, purchasePrice: Money): Result<ProductMargin, MoneyError> {
  return andThen(compare({ amount: 0, currency: salePrice.currency })(salePrice), (sign) =>
    sign <= 0
      ? err({ message: "Sale price must be positive to compute a margin", code: "INVALID_AMOUNT" })
      : map(subtract(purchasePrice)(salePrice), (profit) => ({ profit, percent: marginPercent(profit, salePrice) })),
  );
}
