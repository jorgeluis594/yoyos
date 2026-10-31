import { describe, expect, test } from "vitest";
import { periodDays, previousPeriod, resolveSalesPeriod, salesPeriodMaxDays, windowOf, type SalesPeriod } from "@core/src/features/assistants/domain/sales-period";

const period = (from: string, through: string): SalesPeriod => ({ from, through, cutToToday: false });
const previous = (from: string, through: string) => { const { month: _month, ...days } = previousPeriod(period(from, through)); void _month; return days; };

describe("resolveSalesPeriod", () => {
  test("without dates reads from the first of the current month to today in Lima", () => {
    expect(resolveSalesPeriod({}, "2026-10-20")).toEqual({ success: true, data: { from: "2026-10-01", through: "2026-10-20", cutToToday: false } });
  });

  test("with only desde reads up to today", () => {
    expect(resolveSalesPeriod({ desde: "2026-09-15" }, "2026-10-20")).toEqual({ success: true, data: { from: "2026-09-15", through: "2026-10-20", cutToToday: false } });
  });

  test("refuses only hasta with the initial-date text", () => {
    expect(resolveSalesPeriod({ hasta: "2026-10-10" }, "2026-10-20")).toMatchObject({ success: false, error: { kind: "only_through" } });
  });

  test("cuts a future hasta to today and marks the period as cut", () => {
    expect(resolveSalesPeriod({ desde: "2026-10-01", hasta: "2026-10-31" }, "2026-10-20")).toEqual({ success: true, data: { from: "2026-10-01", through: "2026-10-20", cutToToday: true } });
    expect(resolveSalesPeriod({ desde: "2026-10-01", hasta: "2026-10-20" }, "2026-10-20")).toMatchObject({ data: { cutToToday: false } });
  });

  test("refuses a desde after today echoing both dates as AAAA-MM-DD", () => {
    expect(resolveSalesPeriod({ desde: "2026-11-05" }, "2026-10-31")).toMatchObject({ success: false, error: { kind: "from_after_today", from: "2026-11-05", today: "2026-10-31" } });
  });

  test("refuses a reversed range with the existing reversed-range text", () => {
    expect(resolveSalesPeriod({ desde: "2026-10-07", hasta: "2026-10-01" }, "2026-10-31")).toMatchObject({ success: false, error: { kind: "reversed", from: "2026-10-07", through: "2026-10-01" } });
  });

  test("refuses a period read longer than 366 days and accepts a leap year of 366", () => {
    expect(salesPeriodMaxDays).toBe(366);
    expect(resolveSalesPeriod({ desde: "2028-01-01", hasta: "2028-12-31" }, "2029-03-01")).toMatchObject({ success: true });
    expect(resolveSalesPeriod({ desde: "2027-01-01", hasta: "2028-01-02" }, "2029-03-01")).toMatchObject({ success: false, error: { kind: "too_long", maxDays: 366 } });
    expect(resolveSalesPeriod({ desde: "2025-01-01" }, "2026-10-31")).toMatchObject({ success: false, error: { kind: "too_long" } });
    expect(resolveSalesPeriod({ desde: "2027-01-01", hasta: "2028-01-01" }, "2029-03-01")).toMatchObject({ success: true });
  });

  test("measures the length on the period read, after a future hasta is cut to today", () => {
    expect(resolveSalesPeriod({ desde: "2026-01-01", hasta: "2030-01-01" }, "2026-10-31")).toMatchObject({ success: true, data: { through: "2026-10-31" } });
  });
});

describe("previousPeriod", () => {
  test("compares whole months with the same number of months before and names a single month", () => {
    expect(previousPeriod(period("2026-10-01", "2026-10-31"))).toEqual({ from: "2026-09-01", through: "2026-09-30", month: { year: 2026, month: 9 } });
    expect(previousPeriod(period("2026-07-01", "2026-09-30"))).toEqual({ from: "2026-04-01", through: "2026-06-30", month: null });
    expect(previousPeriod(period("2026-01-01", "2026-01-31"))).toEqual({ from: "2025-12-01", through: "2025-12-31", month: { year: 2025, month: 12 } });
  });

  test("moves a period starting on the 1st back by the months it touches and cuts the end to the month's last day", () => {
    expect(previous("2026-10-01", "2026-10-20")).toEqual({ from: "2026-09-01", through: "2026-09-20" });
    expect(previous("2026-09-01", "2026-10-20")).toEqual({ from: "2026-07-01", through: "2026-08-20" });
    expect(previous("2026-03-01", "2026-03-30")).toEqual({ from: "2026-02-01", through: "2026-02-28" });
    expect(previous("2026-10-01", "2026-10-01")).toEqual({ from: "2026-09-01", through: "2026-09-01" });
    expect(previous("2026-10-01", "2026-10-07")).toEqual({ from: "2026-09-01", through: "2026-09-07" });
    expect(previous("2028-03-01", "2028-03-30")).toEqual({ from: "2028-02-01", through: "2028-02-29" });
    expect(previousPeriod(period("2026-10-01", "2026-10-20")).month).toBeNull();
  });

  test("compares any other period with the same number of days just before", () => {
    expect(previous("2026-10-11", "2026-10-17")).toEqual({ from: "2026-10-04", through: "2026-10-10" });
    expect(previous("2026-09-15", "2026-10-14")).toEqual({ from: "2026-08-16", through: "2026-09-14" });
  });
});

describe("windowOf", () => {
  test("an order at 23:30 Lima on 31/10 falls inside October's window and one at 00:05 on 01/11 outside it", () => {
    const window = windowOf(period("2026-10-01", "2026-10-31"));
    const inside = new Date("2026-11-01T04:30:00Z");
    const outside = new Date("2026-11-01T05:05:00Z");
    expect(window.from.toISOString()).toBe("2026-10-01T05:00:00.000Z");
    expect(inside >= window.from && inside < window.before).toBe(true);
    expect(outside >= window.from && outside < window.before).toBe(false);
  });

  test("counts both ends of the period", () => {
    expect(periodDays(period("2026-10-01", "2026-10-31"))).toBe(31);
    expect(periodDays(period("2026-10-01", "2026-10-01"))).toBe(1);
  });
});
