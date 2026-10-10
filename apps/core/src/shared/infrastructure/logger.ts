import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import pino from "pino";

type OperationContext = { operation?: "create_order" | "create_quotation" | "enable_checkout" | "get_checkout" | "confirm_checkout"; outcome?: "enabled" | "already_enabled" | "cancelled" | "unavailable" | "invalid_input" | "unauthenticated" | "technical_failure" | "pending" | "confirmed" | "already_confirmed" | "total_changed"; orderNumber?: number };
type LogContext = { requestId: string; companyId?: string } & OperationContext;
type LoggingState = { context: AsyncLocalStorage<LogContext>; log?: pino.Logger };
// Express loads source modules; the React Router server build bundles them.
// Both must use the same logger and request context in this process.
const globalLogging = globalThis as typeof globalThis & { __yoyosLogging?: LoggingState };
const state: LoggingState = globalLogging.__yoyosLogging ??= { context: new AsyncLocalStorage<LogContext>() };
const requestLog = state.context;

export const log = state.log ??= pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "yoyos-core" },
  mixin: () => ({ ...requestLog.getStore() }),
  serializers: { err: safeError },
  redact: {
    paths: ["password", "token", "authorization", "cookie", "email", "phone", "headers", "body", "secret", "accessToken", "refreshToken", "apiKey", "orderId", "url", "originalUrl", "referer", "buyer", "name", "address", "expectedTotal"]
      .flatMap((key) => [key, `*.${key}`, `*.*.${key}`, `*.*.*.${key}`]),
    censor: "[Redacted]",
  },
});

const validRequestId = /^[a-zA-Z0-9_-]{8,64}$/;

export function bindCompanyToRequest(companyId: string) {
  const context = requestLog.getStore();
  if (context) context.companyId = companyId;
}

export function bindRequestOperation(fields: OperationContext) {
  const context = requestLog.getStore();
  if (context) Object.assign(context, fields);
}

export function safeError(cause: unknown) {
  if (!(cause instanceof Error)) return { type: "Error", message: "Unexpected failure" };
  const frames = cause.stack?.split("\n").flatMap((line) => {
    const frame = /^\s+at\s+.*?((?:file:\/\/)?\/[^\s()?=@]+|node:[^\s()?=@]+):(\d+):(\d+)\)?$/.exec(line);
    return frame ? [`    at ${frame[1]}:${frame[2]}:${frame[3]}`] : [];
  });
  const type = /^(Error|TypeError|RangeError|SyntaxError|AbortError|PrismaClientKnownRequestError|PrismaClientUnknownRequestError|PrismaClientInitializationError)$/.test(cause.name) ? cause.name : "Error";
  return {
    type,
    message: "Unexpected failure",
    stack: `${type}: Unexpected failure\n${frames?.join("\n") ?? ""}`,
  };
}

export function requestLogging(request: Request, response: Response, next: NextFunction) {
  const supplied = request.get("x-request-id");
  const requestId = supplied && validRequestId.test(supplied) ? supplied : randomUUID();
  const started = performance.now();
  const pathname = request.path;
  const checkout = /^\/checkout(?:\/|$)/.test(pathname);
  const preview = /^(?:\/[a-z]{2}-[A-Z]{2})?\/settings\/checkout-appearance\/preview\/?(?:\.data)?$/.test(pathname);
  const enable = /^\/api\/orders\/[^/]+\/checkout-link\/?$/.test(pathname);
  const operation = checkout ? request.method === "POST" ? "confirm_checkout" : "get_checkout" : enable ? "enable_checkout" : undefined;
  response.set("x-request-id", requestId);
  // prefinish retains the agent's request context; finish runs after it is gone.
  response.once("prefinish", () => {
    const context = requestLog.getStore();
    if (operation && context && !context.outcome) context.outcome = response.statusCode >= 500 ? "technical_failure"
      : response.statusCode === 401 ? "unauthenticated" : response.statusCode === 404 ? "unavailable" : "invalid_input";
    log.info({
      event: "http_request_completed",
      method: request.method,
      route: checkout ? "/checkout/:companyId/:orderId" : preview ? "/settings/checkout-appearance/preview" : enable ? "/api/orders/:orderId/checkout-link"
        : request.route?.path ? `${request.baseUrl}${request.route.path}` : "unmatched",
      statusCode: response.statusCode,
      durationMs: Math.round(performance.now() - started),
    }, "HTTP request completed");
  });
  requestLog.run({ requestId, ...(operation ? { operation } : {}) }, next);
}
