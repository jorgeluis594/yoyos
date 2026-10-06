import { Readable } from "node:stream";
import express from "express";
import { chromium } from "@playwright/test";
import { createElement, Suspense } from "react";
import type { EntryContext } from "react-router";
import { RouterContextProvider } from "react-router";
import { expect, test, vi } from "vitest";
import handleRequest from "@core/app/entry.server";
import { log, requestLogging, safeError } from "@core/src/shared/infrastructure/logger";

// Inject a delayed component failure; HTTP, React streaming and the production
// error boundary remain real. No test-only route is added to the application.
vi.mock("react-router", async (original) => ({
  ...await original<typeof import("react-router")>(),
  ServerRouter: () => createElement(Suspense, { fallback: createElement("p", null, "Cargando resumen") }, createElement(FailingSummary)),
}));
vi.mock("@core/app/middleware/i18next", () => ({ getInstance: () => undefined }));
const gate = Promise.withResolvers<void>();
let released = false;
const secret = "00000000-0000-4000-8000-000000000099";
function FailingSummary(): never {
  if (!released) throw gate.promise;
  throw new Error(`Private buyer /checkout/company/${secret}`);
}

test("a render failure after the shell logs once while retaining the HTTP 200 already sent", async () => {
  const errors = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const summaries = vi.spyOn(log, "info").mockImplementation(() => undefined);
  const raw = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const app = express();
  app.use(requestLogging);
  app.get("/checkout/:companyId/:orderId", async (request, response) => {
    const rendered = await handleRequest(new Request(`http://localhost${request.path}`, { headers: { "user-agent": request.get("user-agent") ?? "" } }),
      200, new Headers(), { isSpaMode: false } as EntryContext, new RouterContextProvider());
    response.status(rendered.status);
    rendered.headers.forEach((value, key) => response.setHeader(key, value));
    Readable.fromWeb(rendered.body as import("node:stream/web").ReadableStream).pipe(response);
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing render test port");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36" });
    const response = await page.goto(`http://127.0.0.1:${address.port}/checkout/company/${secret}`, { waitUntil: "commit" });
    await page.getByText("Cargando resumen").waitFor();
    expect(response?.status()).toBe(200);
    released = true;
    gate.resolve();
    await page.waitForLoadState("load");
    await expect.poll(() => errors.mock.calls.length).toBe(1);
    expect(errors.mock.calls[0][0]).toMatchObject({ event: "order_checkout_request_failed" });
    const fields = errors.mock.calls[0][0] as { err: unknown };
    expect(JSON.stringify(safeError(fields.err))).not.toContain(secret);
    expect(summaries.mock.calls.map(([fields]) => fields)).toContainEqual(expect.objectContaining({
      event: "http_request_completed", statusCode: 200, route: "/checkout/:companyId/:orderId",
    }));
    expect(raw).not.toHaveBeenCalled();
  } finally {
    released = true;
    gate.resolve();
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.restoreAllMocks();
  }
});
