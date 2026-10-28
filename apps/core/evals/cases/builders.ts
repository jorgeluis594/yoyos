import type { ProductKey } from "@core/evals/fixtures/catalog";
import type { FinalLine, OrderLine } from "@core/evals/cases/schema";

type Variant = Readonly<Record<string, string>>;

/** A line of the open order before the message. */
export const line = (product: ProductKey, variant: Variant, quantity = 1): OrderLine => ({ product, variant, quantity });

/** A line of the expected order after the message, with the price the buyer mentioned (`amount` for `units`). */
export const after = (product: ProductKey, variant: Variant, quantity = 1, mentionedPrice: Readonly<{ amount: number; units: number }> | null = null): FinalLine =>
  ({ product, variant, quantity, mentionedPrice });

/** The same line, unchanged, in the expected order. */
export const kept = (order: OrderLine): FinalLine => ({ ...order, mentionedPrice: null });

export const M_NEGRO = { Talla: "M", Color: "Negro" } as const;
export const L_NEGRO = { Talla: "L", Color: "Negro" } as const;
