import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { grantedOAuthScope } from "@core/src/features/assistants/domain/scopes";
import type { UserId } from "@shared/identity";
import { isAllowedRedirectUri, type OAuthClientId } from "@core/src/features/assistants/domain/assistant-connection";

/**
 * The one `hooks.before` middleware of Better Auth, as a dispatcher by `ctx.path` (technical design, section 5.11).
 * Better Auth runs it on every HTTP request and on every nested dispatch a plugin makes, with `ctx.path` set to the dispatched endpoint.
 */

/** The part of Better Auth's endpoint context the dispatcher reads. */
export type OAuthHookContext = Readonly<{
  path: string;
  method: string;
  query?: unknown;
  body?: unknown;
  // Set by the oauth-provider plugin on nested authorize dispatches; absent on a top-level HTTP request.
  authorizeSettings?: Readonly<{ isAuthorize?: boolean; postLogin?: boolean }> | undefined;
}>;
export type OAuthHookResult = Readonly<{ context: Readonly<{ query?: Readonly<{ scope: string }>; body?: Readonly<{ scope: string }> }> }> | undefined;

/** Marks the server-side consent call of the owner's own «Permitir acceso» or «No permitir», and the authorize it nests. */
export type ConsentMarker = Readonly<{ oauthClientId: string; userId: string }>;
const consentMarkers = new AsyncLocalStorage<ConsentMarker>();
export function withConsentMarker<T>(marker: ConsentMarker, run: () => T): T {
  return consentMarkers.run(marker, run);
}

type HookFailure = Readonly<{ code: string; message: string }>;
export type OAuthHookDependencies = Readonly<{
  /** The signed-in account of this call, or null. Reads `ctx.context.session` too: right after sign-in the new session exists only there. */
  readSessionUserId: () => Promise<Result<UserId | null, HookFailure>>;
  /** Whether (client, account) has an active connection. An account without a store has none. */
  hasActiveConnection: (userId: UserId, oauthClientId: OAuthClientId) => Promise<Result<boolean, HookFailure>>;
  dropConsent: (userId: UserId, oauthClientId: OAuthClientId) => Promise<Result<number, HookFailure>>;
  reportFailure: (failure: Readonly<{ userId: string; oauthClientId: string; errorCode: string }>) => void;
  reportRefusedConsent: (refusal: Readonly<{ userId: string | null; oauthClientId: string | null }>) => void;
}>;

/**
 * Where the plugin itself reads authorize parameters (`getAuthorizationRequestParameters` in @better-auth/oauth-provider 1.7.14):
 * the body only for a top-level HTTP POST (`isAuthorize` true, the endpoint's default when no `authorizeSettings` is passed),
 * the query for every nested dispatch, which arrive as POST with another endpoint's body.
 */
export function authorizeParameterSource(ctx: Pick<OAuthHookContext, "method" | "authorizeSettings"> & Partial<Pick<OAuthHookContext, "path">>): "query" | "body" {
  const settings = ctx.authorizeSettings ?? { isAuthorize: true };
  return ctx.method === "POST" && settings.isAuthorize === true ? "body" : "query";
}

const oauthError = (status: "BAD_REQUEST" | "FORBIDDEN" | "SERVICE_UNAVAILABLE", error: string, description: string) =>
  new APIError(status, { error, error_description: description });

const authorizeParametersSchema = z.looseObject({ client_id: z.string().min(1), scope: z.string().optional() });
const registrationSchema = z.looseObject({ redirect_uris: z.array(z.string()).optional(), scope: z.string().optional() });
const consentBodySchema = z.looseObject({ oauth_query: z.string() });

const normalizedScope = { scope: grantedOAuthScope } as const;

async function authorizeHook(ctx: OAuthHookContext, deps: OAuthHookDependencies): Promise<OAuthHookResult> {
  const source = authorizeParameterSource(ctx);
  const parameters = authorizeParametersSchema.safeParse(ctx[source]);
  if (!parameters.success) throw oauthError("BAD_REQUEST", "invalid_request", "client_id is required");
  const oauthClientId = parameters.data.client_id as OAuthClientId;
  const rewritten: OAuthHookResult = { context: { [source]: normalizedScope } };

  const session = await deps.readSessionUserId();
  if (!session.success) {
    deps.reportFailure({ userId: "unknown", oauthClientId, errorCode: session.error.code });
    throw oauthError("SERVICE_UNAVAILABLE", "server_error", "Unable to continue the authorization");
  }
  const userId = session.data;
  if (userId === null) return rewritten;

  const marker = consentMarkers.getStore();
  // The authorize nested in the owner's own allow: the consent was written a moment ago and must stay.
  if (marker !== undefined && marker.oauthClientId === oauthClientId && marker.userId === userId) return rewritten;

  const active = await deps.hasActiveConnection(userId, oauthClientId);
  if (!active.success) {
    deps.reportFailure({ userId, oauthClientId, errorCode: active.error.code });
    throw oauthError("SERVICE_UNAVAILABLE", "server_error", "Unable to continue the authorization");
  }
  if (active.data) return rewritten;
  const dropped = await deps.dropConsent(userId, oauthClientId);
  if (!dropped.success) {
    deps.reportFailure({ userId, oauthClientId, errorCode: dropped.error.code });
    throw oauthError("SERVICE_UNAVAILABLE", "server_error", "Unable to continue the authorization");
  }
  return rewritten;
}

function registerHook(ctx: OAuthHookContext): OAuthHookResult {
  const body = registrationSchema.safeParse(ctx.body);
  // Anything the plugin must reject itself is left to the plugin.
  if (!body.success) return undefined;
  if (body.data.redirect_uris?.some((uri) => !isAllowedRedirectUri(uri))) {
    throw oauthError("BAD_REQUEST", "invalid_redirect_uri", "Redirect URIs must be https or loopback http");
  }
  return body.data.scope === undefined ? undefined : { context: { body: normalizedScope } };
}

async function consentHook(ctx: OAuthHookContext, deps: OAuthHookDependencies): Promise<OAuthHookResult> {
  const body = consentBodySchema.safeParse(ctx.body);
  const oauthClientId = body.success ? new URLSearchParams(body.data.oauth_query).get("client_id") : null;
  const session = await deps.readSessionUserId();
  const userId = session.success ? session.data : null;
  const marker = consentMarkers.getStore();
  if (marker !== undefined && oauthClientId !== null && userId !== null && marker.oauthClientId === oauthClientId && marker.userId === userId) return undefined;
  deps.reportRefusedConsent({ userId, oauthClientId });
  throw oauthError("FORBIDDEN", "access_denied", "Consent can only be answered from the Yoyos authorization screen");
}

export async function dispatchOAuthHook(ctx: OAuthHookContext, deps: OAuthHookDependencies): Promise<OAuthHookResult> {
  switch (ctx.path) {
    case "/oauth2/register": return registerHook(ctx);
    case "/oauth2/authorize": return authorizeHook(ctx, deps);
    case "/oauth2/consent": return consentHook(ctx, deps);
    default: return undefined;
  }
}

/** The Better Auth `hooks.before` value. */
export function createOAuthBeforeHook(deps: Omit<OAuthHookDependencies, "readSessionUserId">) {
  return createAuthMiddleware(async (ctx) => {
    const handled = await dispatchOAuthHook(ctx as unknown as OAuthHookContext, {
      ...deps,
      readSessionUserId: async () => {
        try {
          const session = await getSessionFromCtx(ctx);
          return ok((session?.user.id ?? null) as UserId | null);
        } catch {
          return err({ code: "AUTH_SERVICE_UNAVAILABLE", message: "Unable to read the session" });
        }
      },
    });
    return handled;
  });
}
