import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "yoyos-core" },
  serializers: { err: safeError },
  redact: {
    paths: ["password", "token", "authorization", "cookie", "email", "phone", "headers", "body", "secret", "accessToken", "refreshToken", "apiKey"]
      .flatMap((key) => [key, `*.${key}`, `*.*.${key}`, `*.*.*.${key}`]),
    censor: "[Redacted]",
  },
});

const requestLog = new AsyncLocalStorage<pino.Logger>();
const validRequestId = /^[a-zA-Z0-9_-]{8,64}$/;

export function currentLogger() {
  return requestLog.getStore() ?? logger;
}

export function bindCompanyToRequest(companyId: string) {
  requestLog.getStore()?.setBindings({ companyId });
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

export function logFailure(event: string, cause?: unknown, errorCode?: string) {
  const causeCode = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
  const code = errorCode ?? (typeof causeCode === "string" && /^[A-Z][A-Z0-9_]{1,39}$/.test(causeCode) ? causeCode : undefined);
  currentLogger().error({
    event,
    ...(code ? { errorCode: code } : {}),
    ...(cause === undefined ? {} : { err: cause }),
  }, event);
}

export function requestLogging(request: Request, response: Response, next: NextFunction) {
  const supplied = request.get("x-request-id");
  const requestId = supplied && validRequestId.test(supplied) ? supplied : randomUUID();
  const started = performance.now();
  const log = logger.child({ requestId });
  response.set("x-request-id", requestId);
  response.once("finish", () => {
    log.info({
      event: "http_request_completed",
      method: request.method,
      route: request.route?.path ? `${request.baseUrl}${request.route.path}` : "unmatched",
      statusCode: response.statusCode,
      durationMs: Math.round(performance.now() - started),
    }, "HTTP request completed");
  });
  requestLog.run(log, next);
}
