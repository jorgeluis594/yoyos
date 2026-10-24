import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import pino from "pino";

type OperationContext = { operation?: "create_order" | "create_quotation" | "enable_checkout" | "get_checkout" | "confirm_checkout" | "get_store_appearance" | "save_store_appearance" | "get_store_preview" | "get_catalog_preview_cards" | "set_catalog_publication" | "browse_catalog" | "get_catalog_product" | "get_catalog_settings" | "check_catalog_subdomain" | "save_catalog_subdomain" | "resolve_storefront" | "legacy_catalog_link" | "check_cart_order"; outcome?: "cancelled" | "unavailable" | "invalid_input" | "unauthenticated" | "technical_failure" | "pending" | "confirmed" | "already_confirmed" | "total_changed" | "rendered" | "loaded" | "saved" | "rate_limited"; storeHost?: "app" | "store" | "invalid"; orderNumber?: number; storeAppearance?: "default" | "custom" | "fallback"; storeTheme?: "classic" | "boutique" | "antojo" | "suave" | "noche" };
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
    paths: ["password", "token", "authorization", "cookie", "email", "phone", "headers", "body", "secret", "accessToken", "refreshToken", "apiKey", "url", "originalUrl", "referer", "buyer", "name", "address", "expectedTotal"]
      .flatMap((key) => [key, `*.${key}`, `*.*.${key}`, `*.*.*.${key}`]),
    censor: "[Redacted]",
  },
});

/** The seller JSON routes of the catalog, which do not bind their own operation. */
const catalogApiOperations: Readonly<Record<string, OperationContext["operation"]>> = {
  "GET /api/catalog/settings": "get_catalog_settings",
  "PUT /api/catalog/settings": "set_catalog_publication",
  "GET /api/catalog/subdomain-availability": "check_catalog_subdomain",
  "PUT /api/catalog/subdomain": "save_catalog_subdomain",
};

function catalogApiOutcome(method: string, statusCode: number): OperationContext["outcome"] {
  if (statusCode < 300) return method === "GET" ? "loaded" : "saved";
  if (statusCode === 401 || statusCode === 403) return "unauthenticated";
  if (statusCode === 404) return "unavailable";
  if (statusCode === 429) return "rate_limited";
  return statusCode >= 500 ? "technical_failure" : "invalid_input";
}

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
  const preview = /^(?:\/[a-z]{2}-[A-Z]{2})?\/settings\/store-appearance\/preview\/?(?:\.data)?$/.test(pathname);
  const catalogCards = /^(?:\/[a-z]{2}-[A-Z]{2})?\/settings\/store-appearance\/catalog-cards\/?(?:\.data)?$/.test(pathname);
  const enable = /^\/api\/orders\/[^/]+\/checkout-link\/?$/.test(pathname);
  const appearanceEditor = /^(?:\/[a-z]{2}-[A-Z]{2})?\/settings\/store-appearance(?:\.data)?\/?$/.test(pathname);
  const legacyAppearanceEditor = /^(?:\/[a-z]{2}-[A-Z]{2})?\/settings\/checkout-appearance(?:\.data)?\/?$/.test(pathname);
  const catalogApiOperation = catalogApiOperations[`${request.method} ${pathname.replace(/\/$/, "")}`];
  const operation = checkout ? request.method === "POST" ? "confirm_checkout" : "get_checkout" : enable ? "enable_checkout" : catalogApiOperation;
  response.set("x-request-id", requestId);
  // prefinish retains the agent's request context; finish runs after it is gone.
  response.once("prefinish", () => {
    const context = requestLog.getStore();
    if (catalogApiOperation && context && !context.outcome) context.outcome = catalogApiOutcome(request.method, response.statusCode);
    else if (operation && context && !context.outcome) context.outcome = response.statusCode >= 500 ? "technical_failure"
      : response.statusCode === 401 ? "unauthenticated" : response.statusCode === 404 ? "unavailable" : "invalid_input";
    log.info({
      event: "http_request_completed",
      method: request.method,
      route: checkout ? "/checkout/:companyId/:orderId" : preview ? "/settings/store-appearance/preview" : catalogCards ? "/settings/store-appearance/catalog-cards" : enable ? "/api/orders/:orderId/checkout-link"
        : appearanceEditor ? "/settings/store-appearance" : legacyAppearanceEditor ? "/settings/checkout-appearance"
        : request.route?.path ? `${request.baseUrl}${request.route.path}` : "unmatched",
      statusCode: response.statusCode,
      durationMs: Math.round(performance.now() - started),
    }, "HTTP request completed");
  });
  requestLog.run({ requestId, ...(operation ? { operation } : {}) }, next);
}
