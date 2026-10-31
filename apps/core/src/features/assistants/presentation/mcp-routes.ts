import express, { Router, type NextFunction, type Request, type Response } from "express";
import { createMcpHandler, type AuthInfo, type McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { z } from "zod";
import type { Result } from "@shared/result";
import type { CompanyId, UserId } from "@shared/identity";
import { bindCompanyToRequest, log } from "@core/src/shared/infrastructure/logger";
import type { LimiterDecision } from "@core/src/shared/application/limiter-decision";
import { assistantScopes } from "@core/src/features/assistants/domain/scopes";
import type { AssistantConnectionId } from "@core/src/features/assistants/domain/assistant-connection";
import type { AssistantAccess, AssistantTokenError, RefusalReason, ResolveAssistantAccessError, VerifiedAssistantToken, VerifiedToken } from "@core/src/features/assistants/application/resolve-assistant-access";

type AccessRefusal = "missing_token" | "invalid_token" | "request_limit" | RefusalReason;

export type McpRoutesDependencies = Readonly<{
  verifyToken: (token: string) => Promise<Result<VerifiedToken, AssistantTokenError>>;
  /** Coarse limit per (account, client), checked before any database read. */
  allowRequest: (key: string) => LimiterDecision;
  resolveAccess: (token: VerifiedAssistantToken) => Promise<Result<AssistantAccess, ResolveAssistantAccessError>>;
  inTenant: <T>(companyId: CompanyId, work: () => T) => T;
  createServer: (access: AssistantAccess) => McpServer;
  resourceUrl: string;
  resourceMetadataUrl: string;
}>;

const assistantAccessSchema = z.strictObject({
  companyId: z.uuid(), userId: z.string().min(1), connectionId: z.uuid(),
  scopes: z.array(z.enum(assistantScopes)), lastUsedAt: z.date().nullable(),
});

/** The access the route stored in `authInfo.extra`, checked again here so the server factory needs no cast. */
export function assistantAccessOf(authInfo: AuthInfo | undefined): AssistantAccess {
  const parsed = assistantAccessSchema.safeParse(authInfo?.extra?.assistantAccess);
  if (!parsed.success) {
    log.error({ event: "assistant_access_missing", errorCode: "INVALID_STATE" }, "assistant_access_missing");
    throw new Error("Assistant access is missing from the request");
  }
  return { ...parsed.data, companyId: parsed.data.companyId as CompanyId, userId: parsed.data.userId as UserId, connectionId: parsed.data.connectionId as AssistantConnectionId };
}

const bearer = /^Bearer ([^\s]+)$/i;

export function mcpRoutes(deps: McpRoutesDependencies): Router {
  const handler = toNodeHandler(
    createMcpHandler(
      (context) => deps.createServer(assistantAccessOf(context.authInfo)),
      // No stateless streams: every call is an independent read, and a listen subscription would hold a connection open for nothing.
      { maxSubscriptions: 0, onerror: (error) => log.warn({ event: "mcp_handler_error", err: error }, "mcp_handler_error") },
    ),
    { onerror: (error) => log.error({ event: "mcp_adapter_failed", err: error }, "mcp_adapter_failed") },
  );

  function refuse(response: Response, status: 401 | 429 | 503, reason: AccessRefusal, fields: Readonly<{ oauthClientId?: string; userId?: string; companyId?: string; retryAfterSeconds?: number }> = {}) {
    response.set("Cache-Control", "no-store");
    if (status === 401) {
      log.info({ event: "assistant_access_refused", reason, oauthClientId: fields.oauthClientId, userId: fields.userId, companyId: fields.companyId }, "assistant_access_refused");
      return response.status(401).set("WWW-Authenticate", `Bearer error="invalid_token", resource_metadata="${deps.resourceMetadataUrl}"`)
        .json({ error: "invalid_token", error_description: "A valid access token for this connection is required" });
    }
    if (status === 429) {
      log.info({ event: "assistant_access_refused", reason, oauthClientId: fields.oauthClientId, userId: fields.userId }, "assistant_access_refused");
      return response.status(429).set("Retry-After", String(fields.retryAfterSeconds ?? 60))
        .json({ error: "rate_limited", error_description: "Too many requests", retry_after_seconds: fields.retryAfterSeconds });
    }
    return response.status(503).json({ error: "temporarily_unavailable" });
  }

  const router = Router();
  // The MCP bearer never goes through the `/api` chain, and this route never reads cookies.
  router.use("/mcp", (_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
  router.post("/mcp", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const match = request.get("authorization")?.match(bearer);
      if (!match) return refuse(response, 401, "missing_token");
      const verified = await deps.verifyToken(match[1]);
      if (!verified.success) {
        return verified.error.code === "INVALID_TOKEN" ? refuse(response, 401, "invalid_token") : refuse(response, 503, "invalid_token");
      }
      const token = verified.data;
      const decision = deps.allowRequest(`${token.userId}:${token.oauthClientId}`);
      if (!decision.allowed) return refuse(response, 429, "request_limit", { oauthClientId: token.oauthClientId, userId: token.userId, retryAfterSeconds: decision.retryAfterSeconds });
      response.locals.assistantToken = token;
      return next();
    } catch (cause) {
      return next(cause);
    }
  }, express.json({ limit: "100kb" }), async (request: Request, response: Response, next: NextFunction) => {
    try {
      const token = response.locals.assistantToken as VerifiedToken;
      const resolved = await deps.resolveAccess(token);
      if (!resolved.success) {
        if (resolved.error.code === "PERSISTENCE_UNAVAILABLE") return refuse(response, 503, "invalid_token");
        return refuse(response, 401, resolved.error.reason, { oauthClientId: token.oauthClientId, userId: token.userId, companyId: resolved.error.companyId });
      }
      const access = resolved.data;
      bindCompanyToRequest(access.companyId);
      const authInfo: AuthInfo = {
        token: "", clientId: token.oauthClientId, scopes: [...access.scopes], expiresAt: token.expiresAt, resource: new URL(deps.resourceUrl),
        extra: { assistantAccess: access },
      };
      return await deps.inTenant(access.companyId, () => handler(Object.assign(request, { auth: authInfo }), response, request.body));
    } catch (cause) {
      return next(cause);
    }
  });
  // GET and DELETE are 2025 session operations: this server has no sessions or streams, so the handler answers 405 itself.
  router.all("/mcp", (request, response) => handler(request, response));
  router.use("/mcp", (error: unknown, _request: Request, response: Response, next: NextFunction) => {
    if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large")
      return response.status(413).json({ jsonrpc: "2.0", error: { code: -32600, message: "Request exceeds 100 kB" }, id: null });
    if (error instanceof SyntaxError && "body" in error)
      return response.status(400).json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
    if (response.headersSent) return next(error);
    log.error({ event: "mcp_unhandled_error", err: error }, "mcp_unhandled_error");
    return response.status(500).json({ error: "internal_error" });
  });
  return router;
}
