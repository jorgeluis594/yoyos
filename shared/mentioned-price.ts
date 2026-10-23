export type MentionedPriceItem = {
  readonly unitPrice: { readonly amount: number };
  readonly mentionedPrice: { readonly amount: { readonly amount: number }; readonly units: number } | null;
};

/** The note to show: the price the buyer wrote when it differs from the catalog price for the same units. */
export type MentionedPriceNote = { readonly amount: number; readonly units: number };

const cents = (amount: number): number => Math.round(amount * 100);

export function mentionedPriceNote(item: MentionedPriceItem): MentionedPriceNote | null {
  const mentioned = item.mentionedPrice;
  if (!mentioned) return null;
  const catalogCents = cents(item.unitPrice.amount) * mentioned.units;
  if (cents(mentioned.amount.amount) === catalogCents) return null;
  return { amount: mentioned.amount.amount, units: mentioned.units };
}
