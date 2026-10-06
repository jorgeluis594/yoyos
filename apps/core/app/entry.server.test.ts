import { afterEach, expect, test, vi } from "vitest";
import { handleError } from "@core/app/entry.server";
import { log } from "@core/src/shared/infrastructure/logger";

afterEach(() => vi.restoreAllMocks());

test("web errors use the structured logger without copying request URLs or buyer values", () => {
  const output = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const raw = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const cause = new Error("Private buyer detail");
  handleError(cause, { request: new Request("http://localhost/checkout/private-company/private-order") });
  expect(output).toHaveBeenCalledExactlyOnceWith({ event: "order_checkout_request_failed", err: cause }, "Web request failed");
  expect(raw).not.toHaveBeenCalled();
  const controller = new AbortController();
  controller.abort();
  handleError(cause, { request: new Request("http://localhost/checkout/private-company/private-order", { signal: controller.signal }) });
  expect(output).toHaveBeenCalledTimes(1);
});
