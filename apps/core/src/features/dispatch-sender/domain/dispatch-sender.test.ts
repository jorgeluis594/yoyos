import { expect, test } from "vitest";
import { parseDispatchSender, resolveDispatchSender } from "@core/src/features/dispatch-sender/domain/dispatch-sender";

test("trims both fields and turns empty text into null", () => {
  expect(parseDispatchSender({ name: "  Fantastidog  ", phone: " 977 000 111 " })).toEqual({ success: true, data: { name: "Fantastidog", phone: "977 000 111" } });
  expect(parseDispatchSender({ name: "   ", phone: "" })).toEqual({ success: true, data: { name: null, phone: null } });
  expect(parseDispatchSender({ name: null, phone: null })).toEqual({ success: true, data: { name: null, phone: null } });
});

test("accepts any phone format up to 30 characters and a name up to 120", () => {
  expect(parseDispatchSender({ name: "n".repeat(120), phone: "+51 (977) abc".padEnd(30, "1") }).success).toBe(true);
  expect(parseDispatchSender({ name: "n".repeat(121), phone: null }).success).toBe(false);
  expect(parseDispatchSender({ name: null, phone: "1".repeat(31) }).success).toBe(false);
});

test("rejects unknown fields and non-text values", () => {
  expect(parseDispatchSender({ name: null, phone: null, companyId: "x" })).toMatchObject({ success: false, error: { code: "INVALID_DISPATCH_SENDER" } });
  expect(parseDispatchSender({ name: 1, phone: null }).success).toBe(false);
  expect(parseDispatchSender({ name: null }).success).toBe(false);
});

test("the effective name falls back to the current company name when nothing is stored or the name is empty", () => {
  const empty = { configured: { name: null, phone: null }, effective: { name: "Mi Negocio", phone: null } };
  expect(resolveDispatchSender("Mi Negocio", null)).toEqual(empty);
  expect(resolveDispatchSender("Mi Negocio", { name: null, phone: null })).toEqual(empty);
  expect(resolveDispatchSender("Mi Negocio", { name: "  ", phone: " " })).toEqual(empty);
});

test("a stored name and phone are used as configured", () => {
  expect(resolveDispatchSender("Mi Negocio", { name: "Fantastidog", phone: "977 000 111" })).toEqual({
    configured: { name: "Fantastidog", phone: "977 000 111" }, effective: { name: "Fantastidog", phone: "977 000 111" } });
  expect(resolveDispatchSender("Mi Negocio", { name: null, phone: "977" }).effective).toEqual({ name: "Mi Negocio", phone: "977" });
});
