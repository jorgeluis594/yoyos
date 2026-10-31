import { expect, test } from "vitest";
import { formatLimaDate, formatLimaTime, hasSignedAuthorizationQuery, isLimaToday } from "@core/app/lib/assistant-display";

test("formats dates and times in America/Lima", () => {
  // 04:30 UTC on 31/10 is 23:30 on 30/10 in Lima.
  expect(formatLimaDate("2026-10-31T04:30:00.000Z")).toBe("30/10/2026");
  expect(formatLimaTime("2026-10-30T15:42:00.000Z")).toBe("10:42");
  expect(formatLimaDate("2026-01-05T12:00:00.000Z")).toBe("05/01/2026");
});

test("tells whether an instant is today in Lima, whatever the zone of the clock", () => {
  const now = new Date("2026-10-31T04:30:00.000Z");
  expect(isLimaToday("2026-10-30T20:00:00.000Z", now)).toBe(true);
  expect(isLimaToday("2026-10-31T04:00:00.000Z", now)).toBe(true);
  expect(isLimaToday("2026-10-30T04:30:00.000Z", now)).toBe(false);
});

test("recognizes the signed authorization query of an agent request", () => {
  expect(hasSignedAuthorizationQuery("?client_id=c&exp=1&sig=abc&scope=x")).toBe(true);
  expect(hasSignedAuthorizationQuery("")).toBe(false);
  expect(hasSignedAuthorizationQuery("?foo=bar")).toBe(false);
  expect(hasSignedAuthorizationQuery("?client_id=c&exp=1")).toBe(false);
});
