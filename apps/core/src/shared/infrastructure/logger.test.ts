import express from "express";
import { execFileSync } from "node:child_process";
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
