import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { limaMidnightUtc, nextCalendarDay } from "@shared/orders-date";

/** Inclusive Lima days, `AAAA-MM-DD`; `cutToToday` marks a `hasta` in the future that was read up to today. */
export type SalesPeriod = Readonly<{ from: string; through: string; cutToToday: boolean }>;
export type PreviousPeriod = Readonly<{ from: string; through: string; month: Readonly<{ year: number; month: number }> | null }>;
export type PeriodRefusal =
  | Readonly<{ kind: "only_through" }>
  | Readonly<{ kind: "reversed"; from: string; through: string }>
  | Readonly<{ kind: "from_after_today"; from: string; today: string }>
  | Readonly<{ kind: "too_long"; maxDays: number }>;

/** Initial value: a whole year, leap years included, is the longest period an owner names. Lowered only if the load checks fail. */
export const salesPeriodMaxDays = 366;

const msPerDay = 86_400_000;
const parts = (day: string) => ({ year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)), day: Number(day.slice(8, 10)) });
const dayOf = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
const lastDayOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
/** The month `months` before the one holding this position, as a year and 1-based month. */
const monthsBefore = (year: number, month: number, months: number) => { const index = year * 12 + (month - 1) - months; return { year: Math.floor(index / 12), month: (index % 12 + 12) % 12 + 1 }; };
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * msPerDay).toISOString().slice(0, 10);

/** Calendar days of the period, both ends included. */
export function periodDays(period: Readonly<{ from: string; through: string }>): number {
  return Math.round((Date.parse(`${period.through}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / msPerDay) + 1;
}

/**
 * Checks in this order: only `hasta`; reversed (on the input dates); `desde` after today; defaults (nothing: the 1st of today's month to today;
 * only `desde`: to today); a `hasta` after today is cut to today; length over `salesPeriodMaxDays` on the period read.
 */
export function resolveSalesPeriod(input: Readonly<{ desde?: string; hasta?: string }>, today: string): Result<SalesPeriod, PeriodRefusal> {
  const { desde, hasta } = input;
  if (desde === undefined && hasta !== undefined) return err({ kind: "only_through" });
  if (desde !== undefined && hasta !== undefined && hasta < desde) return err({ kind: "reversed", from: desde, through: hasta });
  if (desde !== undefined && desde > today) return err({ kind: "from_after_today", from: desde, today });
  const from = desde ?? `${today.slice(0, 8)}01`;
  const cutToToday = hasta !== undefined && hasta > today;
  const period: SalesPeriod = { from, through: hasta === undefined || cutToToday ? today : hasta, cutToToday };
  return periodDays(period) > salesPeriodMaxDays ? err({ kind: "too_long", maxDays: salesPeriodMaxDays }) : ok(period);
}

/**
 * The period to compare with, in three cases tried in order: whole calendar months compare with the same number of months just before
 * (`month` set when it is one); a period starting on the 1st moves back by the months it touches, keeping the day numbers and cutting the end to that
 * month's last day; any other period compares with the same number of days just before. Days are UTC calendar arithmetic of the strings.
 */
export function previousPeriod(period: SalesPeriod): PreviousPeriod {
  const from = parts(period.from), through = parts(period.through);
  const touched = (through.year * 12 + through.month) - (from.year * 12 + from.month) + 1;
  if (from.day === 1) {
    const start = monthsBefore(from.year, from.month, touched);
    if (through.day === lastDayOfMonth(through.year, through.month)) {
      const end = monthsBefore(from.year, from.month, 1);
      return { from: dayOf(start.year, start.month, 1), through: dayOf(end.year, end.month, lastDayOfMonth(end.year, end.month)), month: touched === 1 ? end : null };
    }
    const end = monthsBefore(through.year, through.month, touched);
    return { from: dayOf(start.year, start.month, 1), through: dayOf(end.year, end.month, Math.min(through.day, lastDayOfMonth(end.year, end.month))), month: null };
  }
  const days = periodDays(period);
  const end = addDays(period.from, -1);
  return { from: addDays(end, -(days - 1)), through: end, month: null };
}

/** The half-open instant window `[from, before)` of the period's Lima days. */
export function windowOf(period: Readonly<{ from: string; through: string }>): Readonly<{ from: Date; before: Date }> {
  return { from: new Date(limaMidnightUtc(period.from)), before: new Date(limaMidnightUtc(nextCalendarDay(period.through))) };
}
