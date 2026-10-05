import { expect, test } from "vitest";
import { checkExpectedTotal, checkoutState, parseBuyer, parseOrderNumber } from "@core/src/features/orders/domain/checkout";

test("order numbers continue past four digits and preserve safe integer precision", () => {
  for (const value of [1001, 9999, 10000, Number.MAX_SAFE_INTEGER]) expect(parseOrderNumber(value)).toEqual({ success: true, data: value });
  for (const value of [1000, -1, 1001.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1001"]) expect(parseOrderNumber(value).success).toBe(false);
});

test("buyer requires a nonempty name, not surnames, and the existing international phone format", () => {
  expect(parseBuyer({ name: " Ana ", phone: "+51987654321" })).toEqual({ success: true, data: { name: "Ana", phone: "+51987654321" } });
  expect(parseBuyer({ name: "Ana Pérez", phone: "+14155552671" }).success).toBe(true);
  for (const name of [null, "", "   "]) expect(parseBuyer({ name, phone: "+51987654321" }).success).toBe(false);
  for (const phone of [null, "", "987654321", "+012345678", "+1234567", "+1234567890123456", "+51 987654321"])
    expect(parseBuyer({ name: "Ana", phone }).success).toBe(false);
});

test("state derives from timestamps and cancellation takes precedence without erasing history", () => {
  const enabled = new Date("2026-01-01T00:00:00Z");
  const confirmed = new Date("2026-01-02T00:00:00Z");
  const base = { checkoutEnabledAt: null, checkoutConfirmedAt: null, cancelled: false, buyer: null };
  expect(checkoutState(base)).toMatchObject({ data: { kind: "not_enabled" } });
  expect(checkoutState({ ...base, checkoutEnabledAt: enabled })).toMatchObject({ data: { kind: "pending" } });
  const complete = { ...base, checkoutEnabledAt: enabled, checkoutConfirmedAt: confirmed, buyer: { contactId: null, name: "Ana", phone: "+51987654321" } };
  expect(checkoutState(complete)).toMatchObject({ data: { kind: "confirmed", confirmedAt: confirmed } });
  expect(checkoutState({ ...complete, cancelled: true })).toMatchObject({ data: { kind: "cancelled" } });
  expect(complete.checkoutConfirmedAt).toEqual(confirmed);
  for (const order of [{ ...complete, checkoutEnabledAt: null }, { ...complete, buyer: null }, { ...complete, checkoutConfirmedAt: new Date(NaN) }])
    expect(checkoutState(order)).toMatchObject({ success: false, error: { code: "INVALID_CHECKOUT" } });
});

test("expected total checks amount and currency without rounding client values into a match", () => {
  const current = { amount: 100.5, currency: "PEN" as const };
  expect(checkExpectedTotal(current, current)).toEqual({ success: true, data: null });
  expect(checkExpectedTotal({ ...current, amount: 100 }, current)).toMatchObject({ error: { code: "TOTAL_CHANGED" } });
  expect(checkExpectedTotal({ ...current, currency: "USD" }, current)).toMatchObject({ error: { code: "TOTAL_CHANGED" } });
  expect(checkExpectedTotal({ ...current, amount: 100.501 }, current)).toMatchObject({ error: { code: "INVALID_CHECKOUT" } });
});
