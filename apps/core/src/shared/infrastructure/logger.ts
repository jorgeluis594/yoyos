import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import pino from "pino";

const requestLog = new AsyncLocalStorage<{ requestId: string; companyId?: string }>();

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "yoyos-core" },
  mixin: () => ({ ...requestLog.getStore() }),
  serializers: { err: safeError },
  redact: {
    paths: ["password", "token", "authorization", "cookie", "email", "phone", "headers", "body", "secret", "accessToken", "refreshToken", "apiKey"]
      .flatMap((key) => [key, `*.${key}`, `*.*.${key}`, `*.*.*.${key}`]),
    censor: "[Redacted]",
  },
});

const validRequestId = /^[a-zA-Z0-9_-]{8,64}$/;

export function bindCompanyToRequest(companyId: string) {
  const context = requestLog.getStore();
  if (context) context.companyId = companyId;
}

export function safeError(cause: unknown) {
  if (!(cause instanceof Error)) return { type: "Error", message: "Unexpected failure" };
  const frames = cause.stack?.split("\n").flatMap((line) => {
    const frame = /^\s+at\s+.*?((?:file:\/\/)?\/[^\s()?=@]+|node:[^\s()?=@]+):(\d+):(\d+)\)?$/.exec(line);
    return frame ? [`    at ${frame[1]}:${frame[2]}:${frame[3]}`] : [];
  });
  return {
    type: cause.name,
    message: "Unexpected failure",
    stack: `${cause.name}: Unexpected failure\n${frames?.join("\n") ?? ""}`,
  };
}

export function requestLogging(request: Request, response: Response, next: NextFunction) {
  const supplied = request.get("x-request-id");
  const requestId = supplied && validRequestId.test(supplied) ? supplied : randomUUID();
  const started = performance.now();
  response.set("x-request-id", requestId);
  // prefinish retains the agent's request context; finish runs after it is gone.
  response.once("prefinish", () => {
    log.info({
      event: "http_request_completed",
      method: request.method,
      route: request.route?.path ? `${request.baseUrl}${request.route.path}` : "unmatched",
      statusCode: response.statusCode,
      durationMs: Math.round(performance.now() - started),
    }, "HTTP request completed");
  });
  requestLog.run({ requestId }, next);
}
