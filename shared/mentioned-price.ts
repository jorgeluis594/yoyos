import { compare, multiply, type Money } from "@shared/money";

export type MentionedPriceItem = {
  readonly unitPrice: Money;
  readonly mentionedPrice: { readonly amount: Money; readonly units: number } | null;
};

/** The note to show: the price the buyer wrote when it differs from the catalog price for the same units. */
export type MentionedPriceNote = { readonly amount: number; readonly units: number };

export function mentionedPriceNote(item: MentionedPriceItem): MentionedPriceNote | null {
  const mentioned = item.mentionedPrice;
  if (!mentioned) return null;
  const catalog = multiply(item.unitPrice)(mentioned.units);
  if (!catalog.success) return null;
  const comparison = compare(catalog.data)(mentioned.amount);
  if (!comparison.success || comparison.data === 0) return null;
  return { amount: mentioned.amount.amount, units: mentioned.units };
}
