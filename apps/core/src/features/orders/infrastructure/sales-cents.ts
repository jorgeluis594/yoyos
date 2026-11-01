import { z } from "zod";
import type { Currency, Money } from "@shared/money";

/**
 * Integer-cent text as SQL returns it, `round(sum(x) * 100)::bigint::text`: exact on `numeric(15,2)` sums, where `Number(text) * 100` would not be.
 * Parses to a safe integer number of cents (negative differences included).
 */
export const centsText = z.string().regex(/^-?\d+$/).refine((text) => Number.isSafeInteger(Number(text))).transform(Number);

/** Cents to major units; two-decimal amounts divide exactly enough that `Math.round(amount * 100)` reads them back. */
export const moneyOfCents = (cents: number, currency: Currency): Money => ({ amount: cents / 100, currency });
