import type { Currency, Money } from "@shared/money";
import type { MentionedPrice } from "@core/src/features/orders/domain/order";

export type { MentionedPrice };
/** A price as the reader states it: `per` says whether the buyer meant each unit, the whole lot, or did not say. */
export type StatedPrice = Readonly<{ amount: string; currency: "not_named" | Currency | "other"; per: "unit" | "lot" | "not_explicit" }>;
/** What the model extracts: `other` marks a price stated in a currency that is not the order's. */
export type MentionedPriceArgs = Readonly<{ amount: string; units: number; currency: "order_currency" | "other" }>;

const maxUnits = 99;
const maxAmountCents = 99999999999n;

/** The price as the buyer said it, in the order's currency. A price that cannot be kept is dropped: it is only a note and never blocks a message. */
export function parseMentionedPrice(args: MentionedPriceArgs, currency: Currency): MentionedPrice | null {
  if (args.currency !== "order_currency" || !Number.isInteger(args.units) || args.units < 1 || args.units > maxUnits) return null;
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(args.amount);
  if (!match) return null;
  const cents = BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (cents <= 0n || cents > maxAmountCents) return null;
  return { amount: { amount: Number(args.amount), currency }, units: args.units };
}

/** The stated amount in `currency`, or null when it is in another currency or cannot be kept. */
export function statedMoney(stated: StatedPrice, currency: Currency): Money | null {
  if (stated.currency !== "not_named" && stated.currency !== currency) return null;
  return parseMentionedPrice({ amount: stated.amount, units: 1, currency: "order_currency" }, currency)?.amount ?? null;
}

/** The mentioned price of an item from what the buyer stated, judged with the variant's catalog price. `quantity` is the quantity the price was stated for. */
export function mentionedPriceOf(stated: StatedPrice, quantity: number, unitPrice: Money): MentionedPrice | null {
  const amount = statedMoney(stated, unitPrice.currency);
  if (!amount) return null;
  const units = unitsOf(stated.per, quantity, amount.amount, unitPrice.amount);
  return parseMentionedPrice({ amount: stated.amount, units, currency: "order_currency" }, unitPrice.currency);
}

/** Without an explicit basis, the reading whose per-unit amount is closer to the catalog price wins; a tie is the lot. */
function unitsOf(per: StatedPrice["per"], quantity: number, amount: number, unitPrice: number): number {
  if (per === "unit" || quantity === 1) return 1;
  if (per === "lot") return quantity;
  const cents = (value: number) => Math.round(value * 100);
  const perUnitGap = Math.abs(cents(amount) - cents(unitPrice)) * quantity;
  const perLotGap = Math.abs(cents(amount) - cents(unitPrice) * quantity);
  return perLotGap <= perUnitGap ? quantity : 1;
}
