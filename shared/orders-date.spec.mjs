import { expect, test } from "vitest";
import { limaCalendarDay } from "@shared/orders-date";

test("returns 30/10 as today at 23:30 Lima on 30/10, which is 04:30 UTC on 31/10", () => {
  expect(limaCalendarDay(new Date("2026-10-31T04:30:00.000Z"))).toBe("2026-10-30");
});

test("returns the next Lima day from 00:00 Lima, which is 05:00 UTC", () => {
  expect(limaCalendarDay(new Date("2026-10-31T04:59:59.999Z"))).toBe("2026-10-30");
  expect(limaCalendarDay(new Date("2026-10-31T05:00:00.000Z"))).toBe("2026-10-31");
});
