import { andThen, err, map } from "@shared/functional";
import { compare, subtract, type Money, type MoneyError } from "@shared/money";
import type { Result } from "@shared/result";

export type ProductMargin = Readonly<{ profit: Money; percent: number }>;

/** Profit per unit and margin over the sale price; the margin is rounded to one decimal. */
export function productMargin(salePrice: Money, purchasePrice: Money): Result<ProductMargin, MoneyError> {
  return andThen(compare({ amount: 0, currency: salePrice.currency })(salePrice), (sign) =>
    sign <= 0
      ? err({ message: "Sale price must be positive to compute a margin", code: "DIVISION_BY_ZERO" })
      : map(subtract(purchasePrice)(salePrice), (profit) => ({ profit, percent: Math.round((profit.amount / salePrice.amount) * 1000) / 10 })),
  );
}
