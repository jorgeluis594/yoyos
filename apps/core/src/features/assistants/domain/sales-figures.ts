import type { Money } from "@shared/money";

/** Whole cents of a two-decimal amount; exact because the amounts come from `numeric(15,2)` sums. */
export const centsOf = (money: Pick<Money, "amount">): number => Math.round(money.amount * 100);

/** Integer division rounding the magnitude half up and reapplying the sign, so −14.5 becomes −15 and no floating-point division decides a figure. */
export function roundHalfUp(numerator: number, denominator: number): number {
  const magnitude = Math.floor((2 * Math.abs(numerator) + Math.abs(denominator)) / (2 * Math.abs(denominator)));
  return numerator < 0 !== denominator < 0 && magnitude !== 0 ? -magnitude : magnitude;
}

export type Share = Readonly<{ kind: "percent"; value: number }> | Readonly<{ kind: "under_one" }>;

/** A share rounded half up to the whole percent, or «menos de 1%» below 0.5%; shares are rounded one by one and never adjusted to 100. */
export function sharePercent(part: number, whole: number): Share {
  if (part > 0 && whole > 0 && part * 200 < whole) return { kind: "under_one" };
  return { kind: "percent", value: whole === 0 ? 0 : roundHalfUp(part * 100, whole) };
}

/** Sales divided by orders in cents, half up; zero without orders. */
export const averageCents = (totalCents: number, orders: number): number => (orders === 0 ? 0 : roundHalfUp(totalCents, orders));

export type Comparison =
  | Readonly<{ kind: "same" }>
  | Readonly<{ kind: "more" | "less"; difference: number; percent: number | "under_one" | null }>;

/** This period minus the previous one: the difference in cents (always positive; `kind` gives the direction) and a percent of the previous figure, half up. */
export function compareFigure(current: number, previous: number): Comparison {
  if (current === previous) return { kind: "same" };
  const difference = Math.abs(current - previous);
  const percent = previous === 0 ? null : roundHalfUp(difference * 100, Math.abs(previous));
  return { kind: current > previous ? "more" : "less", difference, percent: percent === 0 ? "under_one" : percent };
}

/** The ticket comparison uses the two rounded averages, so the figures shown and their difference reconcile. */
export const compareAverages = (current: Readonly<{ totalCents: number; orders: number }>, previous: Readonly<{ totalCents: number; orders: number }>): Comparison =>
  compareFigure(averageCents(current.totalCents, current.orders), averageCents(previous.totalCents, previous.orders));

export const counted = (count: number, singular: string, plural: string): string => `${count} ${count === 1 ? singular : plural}`;
