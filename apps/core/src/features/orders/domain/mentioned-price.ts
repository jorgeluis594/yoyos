import type { Currency } from "@shared/money";
import type { MentionedPrice } from "@core/src/features/orders/domain/order";

export type { MentionedPrice };
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
