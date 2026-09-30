import express from "express";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { bindCompanyToRequest, currentLogger, logger, requestLogging, safeError } from "@core/src/shared/infrastructure/logger";

afterEach(() => vi.restoreAllMocks());

it("logs a normalized route with a validated request ID and no private input", async () => {
  const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
  vi.spyOn(logger, "child").mockImplementation(() => logger as unknown as ReturnType<typeof logger.child>);
  const app = express();
  app.use(requestLogging);
  const routes = express.Router();
  routes.get("/:id", (_request, response) => {
    currentLogger().info({ event: "order_loaded" }, "Order loaded");
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
    import { logger } from "./src/shared/infrastructure/logger.ts";
    logger.error({ event: "privacy_probe", authorization: "Bearer marker-secret", nested: { account: { email: "marker@example.com" } }, err: new Error("marker-secret") }, "Privacy probe");
  `], { cwd: process.cwd(), encoding: "utf8" });
  const event = JSON.parse(output.trim());
  expect(event).toMatchObject({ event: "privacy_probe", authorization: "[Redacted]", nested: { account: { email: "[Redacted]" } } });
  expect(output).not.toContain("marker-secret");
  expect(output).not.toContain("marker@example.com");
});

it("keeps authenticated company context within its request", async () => {
  const app = express();
  app.use(requestLogging);
  app.get("/company/:id", (request, response) => {
    if (request.params.id === "first") bindCompanyToRequest("company-one");
    response.json(currentLogger().bindings());
  });
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    const first = await fetch(`http://127.0.0.1:${address.port}/company/first`);
    const second = await fetch(`http://127.0.0.1:${address.port}/company/second`);
    expect(await first.json()).toMatchObject({ companyId: "company-one" });
    expect(await second.json()).not.toHaveProperty("companyId");
  } finally {
    server.close();
  }
});
