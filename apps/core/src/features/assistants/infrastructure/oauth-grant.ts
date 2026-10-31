import { z } from "zod";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import { auth, authIssuer } from "@core/src/shared/infrastructure/auth";
import { isAllowedRedirectUri, type OAuthClientId } from "@core/src/features/assistants/domain/assistant-connection";
import type {
  AuthorizationGrant, AuthorizationRequest, AuthorizeAssistantError, RedirectUrl, SignedAuthorizationRequest,
} from "@core/src/features/assistants/application/authorize-assistant";
import { withConsentMarker } from "@core/src/features/assistants/infrastructure/oauth-hooks";
import { signedRequestFailure } from "@core/src/features/assistants/infrastructure/signed-request";

/**
 * The server-side side of the authorization screen: reads the signed request and answers the plugin's consent endpoint
 * under the Yoyos consent marker. `request` carries the owner's cookie; it is the action's request.
 */

const consentAnswerSchema = z.object({ redirect: z.literal(true), url: z.string().min(1) });
const invalid = (message: string): AuthorizeAssistantError => ({ code: "REQUEST_INVALID", message });

async function readRequest(signed: SignedAuthorizationRequest, now: Date): Promise<Result<AuthorizationRequest, AuthorizeAssistantError>> {
  try {
    const { secret } = await auth.$context;
    if (!await verifyOAuthQueryParams(signed, secret)) {
      const code = signedRequestFailure(signed, now);
      return err({ code, message: code === "REQUEST_EXPIRED" ? "The authorization request expired" : "The authorization request is not valid" });
    }
    const query = new URLSearchParams(signed);
    const clientId = query.get("client_id");
    const redirectUri = query.get("redirect_uri");
    if (!clientId || !redirectUri) return err(invalid("The authorization request is incomplete"));
    const client = await systemPrisma.oauthClient.findUnique({ where: { clientId }, select: { name: true, redirectUris: true, disabled: true } });
    if (client === null || client.disabled === true) return err(invalid("Unknown client"));
    if (!client.redirectUris.includes(redirectUri) || !isAllowedRedirectUri(redirectUri)) return err(invalid("The redirect URI is not registered for this client"));
    return ok({ oauthClientId: clientId as OAuthClientId, clientName: client.name, redirectUri });
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "assistant_authorization_failed", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "assistant_authorization_failed");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Authorization unavailable" });
  }
}

/** Reads the OAuth error code of a Better Auth API error, which the plugin sets as `body.error`. */
function oauthErrorCode(cause: unknown): string | null {
  if (typeof cause !== "object" || cause === null || !("body" in cause)) return null;
  const body = (cause as { body?: unknown }).body;
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : null;
}

async function answerConsent(request: Request, signed: SignedAuthorizationRequest, grant: AuthorizationGrant, accept: boolean, now: Date): Promise<Result<RedirectUrl, AuthorizeAssistantError>> {
  const consentUrl = new URL("/api/auth/oauth2/consent", authIssuer);
  const headers = new Headers({ cookie: request.headers.get("cookie") ?? "", "content-type": "application/json", accept: "application/json" });
  const body = { accept, oauth_query: signed };
  // The plugin's nested authorize throws "request not found" without ctx.request, so the call carries a built Request.
  const consentRequest = new Request(consentUrl, { method: "POST", headers, body: JSON.stringify(body) });
  try {
    const answer = await withConsentMarker({ oauthClientId: grant.oauthClientId, userId: grant.userId }, () =>
      auth.api.oauth2Consent({ body, headers, request: consentRequest, asResponse: false }));
    const parsed = consentAnswerSchema.safeParse(answer);
    if (!parsed.success) throw new Error("Unexpected consent answer");
    return ok(parsed.data.url as RedirectUrl);
  } catch (cause) {
    if (oauthErrorCode(cause) === "invalid_signature") {
      const code = signedRequestFailure(signed, now);
      return err({ code, message: code === "REQUEST_EXPIRED" ? "The authorization request expired" : "The authorization request is not valid" });
    }
    log.error({ event: "assistant_authorization_failed", userId: grant.userId, oauthClientId: grant.oauthClientId, errorCode: oauthErrorCode(cause) ?? "UNEXPECTED_ERROR", err: cause }, "assistant_authorization_failed");
    return err({ code: "AUTHORIZATION_UNAVAILABLE", message: "Unable to answer the authorization request" });
  }
}

export function createOAuthGrant(request: Request, clock: () => Date) {
  return {
    readRequest,
    acceptRequest: (signed: SignedAuthorizationRequest, grant: AuthorizationGrant) => answerConsent(request, signed, grant, true, clock()),
    rejectRequest: (signed: SignedAuthorizationRequest, grant: AuthorizationGrant) => answerConsent(request, signed, grant, false, clock()),
  };
}
