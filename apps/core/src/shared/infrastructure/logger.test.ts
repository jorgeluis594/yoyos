import express from "express";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { log, requestLogging, safeError } from "@core/src/shared/infrastructure/logger";

afterEach(() => vi.restoreAllMocks());

it("logs a normalized route with a validated request ID and no private input", async () => {
  const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
  const app = express();
  app.use(requestLogging);
  const routes = express.Router();
  routes.get("/:id", (_request, response) => {
    log.info({ event: "order_loaded" }, "Order loaded");
    response.sendStatus(200);
  });
  app.use("/orders", routes);
  app.get("/fail", (_request, response) => response.sendStatus(503));
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    const response = await fetch(`http://127.0.0.1:${address.port}/orders/private@example.com?token=secret`, {
      headers: { "x-request-id": "invalid id", authorization: "Bearer secret" },
    });
    expect(response.status).toBe(200);
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(info).toHaveBeenCalledWith(expect.objectContaining({
      event: "http_request_completed", method: "GET", route: "/orders/:id", statusCode: 200,
    }), "HTTP request completed");
    await fetch(`http://127.0.0.1:${address.port}/fail`);
    expect(info).toHaveBeenCalledWith(expect.objectContaining({
      event: "http_request_completed", route: "/fail", statusCode: 503,
    }), "HTTP request completed");
    expect(JSON.stringify(info.mock.calls)).not.toContain("private@example.com");
    expect(JSON.stringify(info.mock.calls)).not.toContain("secret");
  } finally {
    server.close();
  }
});

it("removes secret bearing error messages while preserving stack frames", () => {
  const error = new Error("Bearer secret@example.com\nsecret@example.com");
  expect(JSON.stringify(safeError(error))).not.toContain("secret@example.com");
  expect(safeError(error).stack).toContain("logger.test.ts");
});

it("emits redacted JSON to stdout", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    import { log } from "./src/shared/infrastructure/logger.ts";
    log.error({ event: "privacy_probe", authorization: "Bearer marker-secret", nested: { account: { email: "marker@example.com" } }, err: new Error("marker-secret") }, "Privacy probe");
  `], { cwd: process.cwd(), encoding: "utf8" });
  const event = JSON.parse(output.trim());
  expect(event).toMatchObject({ event: "privacy_probe", authorization: "[Redacted]", nested: { account: { email: "[Redacted]" } } });
  expect(output).not.toContain("marker-secret");
  expect(output).not.toContain("marker@example.com");
});

it("adds request and company context only to logs in that request", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    import express from "express";
    import { bindCompanyToRequest, log, requestLogging } from "./src/shared/infrastructure/logger.ts";
    const app = express();
    app.use(requestLogging);
    app.get("/company/:id", async (request, response) => {
      if (request.params.id === "first") bindCompanyToRequest("company-one");
      await new Promise((resolve) => setImmediate(resolve));
      log.info({ event: "company_loaded" }, "Company loaded");
      response.sendStatus(200);
    });
    const server = app.listen(0);
    const address = server.address();
    await Promise.all([
      fetch("http://127.0.0.1:" + address.port + "/company/first", { headers: { "x-request-id": "first-request" } }),
      fetch("http://127.0.0.1:" + address.port + "/company/second", { headers: { "x-request-id": "second-request" } }),
    ]);
    log.info({ event: "outside_request" }, "Outside request");
    server.close();
  `], { cwd: process.cwd(), encoding: "utf8" });
  const entries = output.trim().split("\n").map((line) => JSON.parse(line));
  expect(entries.filter((entry) => entry.requestId === "first-request")).toEqual([
    expect.objectContaining({ event: "company_loaded", companyId: "company-one" }),
    expect.objectContaining({ event: "http_request_completed", companyId: "company-one" }),
  ]);
  expect(entries.filter((entry) => entry.requestId === "second-request")).toEqual([
    expect.objectContaining({ event: "company_loaded" }),
    expect.objectContaining({ event: "http_request_completed" }),
  ]);
  expect(entries.filter((entry) => entry.requestId === "second-request").every((entry) => !("companyId" in entry))).toBe(true);
  expect(entries.find((entry) => entry.event === "outside_request")).not.toHaveProperty("requestId");
});

it("normalizes checkout URLs and redacts the UUID credential even in separate fields", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    import express from "express";
    import { log, requestLogging, bindRequestOperation, bindCompanyToRequest } from "./src/shared/infrastructure/logger.ts";
    const app = express();
    app.use(requestLogging);
    app.get("/{*splat}", (_req, res) => {
      bindCompanyToRequest("verified-company");
      bindRequestOperation({ outcome: "pending", orderNumber: 1001 });
      const error = new Error("secret-link"); error.name = "secret-link";
      log.error({ event: "privacy_probe", orderId: "secret-order-uuid", nested: { url: "secret-link" }, buyer: { name: "Private buyer", phone: "Private phone" }, err: error }, "Privacy probe");
      res.sendStatus(200);
    });
    const server = app.listen(0);
    await fetch("http://127.0.0.1:" + server.address().port + "/checkout/claimed-company/secret-order-uuid?secret-link");
    server.close();
  `], { cwd: process.cwd(), encoding: "utf8" });
  for (const value of ["secret-order-uuid", "secret-link", "Private buyer", "Private phone", "claimed-company"]) expect(output).not.toContain(value);
  const entries = output.trim().split("\n").map((line) => JSON.parse(line));
  expect(entries.filter((entry) => entry.event === "http_request_completed")).toEqual([
    expect.objectContaining({ route: "/checkout/:companyId/:orderId", operation: "get_checkout", outcome: "pending", orderNumber: 1001, companyId: "verified-company" }),
  ]);
});

it("normalizes legacy buyer payment URLs with an explicit outcome", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    import express from "express";
    import { requestLogging, bindRequestOperation } from "./src/shared/infrastructure/logger.ts";
    const app = express();
    app.use(requestLogging);
    app.get("/{*splat}", (req, res) => {
      bindRequestOperation({ outcome: req.query.o });
      res.sendStatus(req.query.o === "rendered" ? 200 : 301);
    });
    const server = app.listen(0);
    const base = "http://127.0.0.1:" + server.address().port;
    await fetch(base + "/pago/secret-order-uuid?o=redirected", { redirect: "manual" });
    await fetch(base + "/pago/secret-order-uuid?o=rendered", { redirect: "manual" });
    server.close();
  `], { cwd: process.cwd(), encoding: "utf8" });
  expect(output).not.toContain("secret-order-uuid");
  expect(output.trim().split("\n").map((line) => JSON.parse(line)).filter((entry) => entry.event === "http_request_completed")).toEqual([
    expect.objectContaining({ route: "/pago/:orderId", operation: "redirect_buyer_payment", outcome: "redirected", statusCode: 301 }),
    expect.objectContaining({ route: "/pago/:orderId", operation: "redirect_buyer_payment", outcome: "rendered", statusCode: 200 }),
  ]);
});

it("normalizes the checkout preview route with an explicit outcome", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    import express from "express";
    import { requestLogging, bindRequestOperation } from "./src/shared/infrastructure/logger.ts";
    const app = express();
    app.use(requestLogging);
    app.get("/{*splat}", (req, res) => {
      bindRequestOperation({ operation: "get_checkout_preview", outcome: req.query.o });
      res.sendStatus(req.query.o === "rendered" ? 200 : 503);
    });
    const server = app.listen(0);
    const base = "http://127.0.0.1:" + server.address().port;
    await fetch(base + "/es-PE/settings/checkout-appearance/preview?o=rendered");
    await fetch(base + "/es-PE/settings/checkout-appearance/preview.data?o=technical_failure");
    server.close();
  `], { cwd: process.cwd(), encoding: "utf8" });
  expect(output.trim().split("\n").map((line) => JSON.parse(line)).filter((entry) => entry.event === "http_request_completed")).toEqual([
    expect.objectContaining({ route: "/settings/checkout-appearance/preview", operation: "get_checkout_preview", outcome: "rendered", statusCode: 200 }),
    expect.objectContaining({ route: "/settings/checkout-appearance/preview", operation: "get_checkout_preview", outcome: "technical_failure", statusCode: 503 }),
  ]);
});

it("normalizes the checkout appearance editor route without capturing the preview", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    import express from "express";
    import { requestLogging, bindRequestOperation } from "./src/shared/infrastructure/logger.ts";
    const app = express();
    app.use(requestLogging);
    app.all("/{*splat}", (req, res) => {
      bindRequestOperation({ operation: req.query.op, outcome: req.query.o });
      res.sendStatus(200);
    });
    const server = app.listen(0);
    const base = "http://127.0.0.1:" + server.address().port;
    await fetch(base + "/es-PE/settings/checkout-appearance?op=get_checkout_appearance&o=loaded");
    await fetch(base + "/es-PE/settings/checkout-appearance.data?op=save_checkout_appearance&o=saved", { method: "POST" });
    await fetch(base + "/es-PE/settings/checkout-appearance/preview?op=get_checkout_preview&o=rendered");
    server.close();
  `], { cwd: process.cwd(), encoding: "utf8" });
  expect(output.trim().split("\n").map((line) => JSON.parse(line)).filter((entry) => entry.event === "http_request_completed")).toEqual([
    expect.objectContaining({ route: "/settings/checkout-appearance", operation: "get_checkout_appearance", outcome: "loaded", statusCode: 200 }),
    expect.objectContaining({ route: "/settings/checkout-appearance", operation: "save_checkout_appearance", outcome: "saved", statusCode: 200 }),
    expect.objectContaining({ route: "/settings/checkout-appearance/preview", operation: "get_checkout_preview", outcome: "rendered", statusCode: 200 }),
  ]);
});

it("labels the buyer checkout with how its appearance was resolved and logs an explicit outcome", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    import express from "express";
    import { requestLogging, bindRequestOperation } from "./src/shared/infrastructure/logger.ts";
    const app = express();
    app.use(requestLogging);
    app.get("/checkout/:companyId/:orderId", (req, res) => {
      bindRequestOperation({ outcome: "pending", checkoutAppearance: req.query.a });
      res.sendStatus(200);
    });
    const server = app.listen(0);
    const base = "http://127.0.0.1:" + server.address().port;
    for (const kind of ["custom", "default", "fallback"]) await fetch(base + "/checkout/company-secret/order-secret?a=" + kind);
    server.close();
  `], { cwd: process.cwd(), encoding: "utf8" });
  expect(output).not.toContain("order-secret");
  const completed = output.trim().split("\n").map((line) => JSON.parse(line)).filter((entry) => entry.event === "http_request_completed");
  expect(completed.map((entry) => entry.checkoutAppearance)).toEqual(["custom", "default", "fallback"]);
  for (const entry of completed) expect(entry).toMatchObject({ route: "/checkout/:companyId/:orderId", operation: "get_checkout", outcome: "pending", statusCode: 200 });
});

it("names the four routes of the feature in New Relic without capturing one another", () => {
  const require = createRequire(import.meta.url);
  const rules: { pattern: string; name: string }[] = require("../../../newrelic.cjs").config.rules.name;
  const nameOf = (path: string) => rules.find((rule) => new RegExp(rule.pattern).test(path))?.name;
  expect(nameOf("/pago/0b6f3a5e-0000-4000-8000-000000000000")).toBe("pago");
  expect(nameOf("/checkout/6d2a7c1e-0000-4000-8000-000000000000/0b6f3a5e-0000-4000-8000-000000000000")).toBe("checkout");
  expect(nameOf("/es-PE/settings/checkout-appearance")).toBe("settings/checkout-appearance");
  expect(nameOf("/es-PE/settings/checkout-appearance.data")).toBe("settings/checkout-appearance");
  expect(nameOf("/es-PE/settings/checkout-appearance/preview")).toBe("settings/checkout-appearance/preview");
  expect(nameOf("/settings/checkout-appearance/preview.data")).toBe("settings/checkout-appearance/preview");
});

it("shares context between independently loaded source and server-bundled modules", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    import express from 'express';
    import { requestLogging } from './src/shared/infrastructure/logger.ts';
    const separate = await import('./src/shared/infrastructure/logger.ts?server-build');
    const app = express();
    app.use(requestLogging);
    app.get('/checkout/:companyId/:orderId', (_req, res) => {
      separate.bindRequestOperation({ operation: 'get_checkout', outcome: 'pending', orderNumber: 1001 });
      separate.bindCompanyToRequest('verified-company');
      separate.log.info({ event: 'shared_context_probe' }, 'Shared context probe');
      res.sendStatus(200);
    });
    const server = app.listen(0);
    await fetch('http://127.0.0.1:' + server.address().port + '/checkout/company/order', { headers: { 'x-request-id': 'bundled-request' } });
    server.close();
  `], { cwd: process.cwd(), encoding: "utf8" });
  const events = output.trim().split("\n").map((line) => JSON.parse(line));
  expect(events).toHaveLength(2);
  for (const event of events) expect(event).toMatchObject({ requestId: "bundled-request", companyId: "verified-company", outcome: "pending", orderNumber: 1001 });
});
