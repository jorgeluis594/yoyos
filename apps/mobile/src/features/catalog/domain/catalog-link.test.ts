import { linkFieldState, needsServerCheck, type LinkVerdict } from "@mobile/features/catalog/domain/catalog-link";

const available: LinkVerdict = { status: "available", subdomain: "fantasio" };

test("maps every product status line state from the typed value, the saved link and the latest verdict", () => {
  expect(linkFieldState("", null, null)).toEqual({ kind: "empty" });
  expect(linkFieldState("fa", null, null)).toEqual({ kind: "short" });
  expect(linkFieldState("f", "fantasio", null)).toEqual({ kind: "short" });
  expect(linkFieldState("-", null, null)).toEqual({ kind: "invalid", reason: "hyphen_edge" });
  expect(linkFieldState("-f", null, null)).toEqual({ kind: "invalid", reason: "hyphen_edge" });
  expect(linkFieldState("fantasio.yoyos.lat", null, null)).toEqual({ kind: "invalid", reason: "contains_domain" });
  expect(linkFieldState("pañales", null, null)).toEqual({ kind: "invalid", reason: "invalid_character" });
  expect(linkFieldState("a".repeat(40), null, null)).toEqual({ kind: "invalid", reason: "too_long" });
  expect(linkFieldState("pay", null, null)).toEqual({ kind: "reserved" });
  expect(linkFieldState("fantasio", null, null)).toEqual({ kind: "checking", subdomain: "fantasio" });
  expect(linkFieldState("fantasio", null, available)).toEqual({ kind: "available", subdomain: "fantasio" });
  expect(linkFieldState("fantasio", null, { status: "in_use", subdomain: "fantasio" })).toEqual({ kind: "in_use", subdomain: "fantasio" });
  expect(linkFieldState("fantasio", null, { status: "reserved" })).toEqual({ kind: "reserved" });
  expect(linkFieldState("fantasio", null, { status: "invalid", reason: "double_hyphen" })).toEqual({ kind: "invalid", reason: "double_hyphen" });
  expect(linkFieldState("fantasio", null, { status: "check_failed" })).toEqual({ kind: "check_failed", subdomain: "fantasio" });
  expect(linkFieldState("fantasio", "fantasio", null)).toEqual({ kind: "current", subdomain: "fantasio" });
  expect(linkFieldState("fantasio", "fantasio", null, true)).toEqual({ kind: "saved", subdomain: "fantasio" });
  expect(linkFieldState("fantasio", "fantasio", { status: "current", subdomain: "fantasio" })).toEqual({ kind: "current", subdomain: "fantasio" });
  expect(linkFieldState("fantasio-store", "fantasio", available)).toEqual({ kind: "available", subdomain: "fantasio-store" });
});

test("needs a server check only for a valid, non-reserved value that differs from the saved link", () => {
  expect(needsServerCheck("fantasio", null)).toBe(true);
  expect(needsServerCheck("fantasio-store", "fantasio")).toBe(true);
  expect(needsServerCheck("fantasio", "fantasio")).toBe(false);
  expect(needsServerCheck("pay", null)).toBe(false);
  expect(needsServerCheck("fa", null)).toBe(false);
  expect(needsServerCheck("", null)).toBe(false);
  expect(needsServerCheck("pañales", null)).toBe(false);
  expect(needsServerCheck("a".repeat(40), null)).toBe(false);
});
