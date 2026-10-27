import { afterEach, expect, test, vi } from "vitest";
import { lostResponse } from "@core/app/routes/lost-response";

afterEach(() => vi.unstubAllGlobals());

test("a failed fetch is offline", () => {
  expect(lostResponse(new TypeError("Failed to fetch"))).toBe("offline");
});

test("any error is offline while the browser reports no connection", () => {
  vi.stubGlobal("navigator", { onLine: false });
  expect(lostResponse(new Error("boom"))).toBe("offline");
});

test("a server error thrown outside the action is in doubt, not offline", () => {
  vi.stubGlobal("navigator", { onLine: true });
  expect(lostResponse(new Error("Unexpected Server Error"))).toBe("in-doubt");
});

test("a gateway failure is in doubt and a client error is the route's", () => {
  expect(lostResponse(new Response(null, { status: 502 }))).toBe("in-doubt");
  expect(lostResponse(new Response(null, { status: 404 }))).toBeUndefined();
});
