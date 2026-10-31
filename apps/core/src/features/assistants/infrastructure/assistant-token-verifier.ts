import { jwtVerify, errors } from "jose";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { UserId } from "@shared/identity";
import { log } from "@core/src/shared/infrastructure/logger";
import type { JwksCache } from "@core/src/shared/infrastructure/jwks-cache";
import type { OAuthClientId } from "@core/src/features/assistants/domain/assistant-connection";
import { assistantScopes, type AssistantScope } from "@core/src/features/assistants/domain/scopes";
import type { AssistantTokenError, VerifiedToken } from "@core/src/features/assistants/application/resolve-assistant-access";

export type AssistantTokenVerifier = Readonly<{ verify: (token: string) => Promise<Result<VerifiedToken, AssistantTokenError>> }>;
export type AssistantTokenVerifierOptions = Readonly<{
  keys: JwksCache;
  issuer: string;
  resource: string;
  maxLifetimeSeconds: number;
  now: () => Date;
}>;

const invalid = () => err({ code: "INVALID_TOKEN" as const, message: "Invalid token" });

// The claims Better Auth's oauth-provider puts in a JWT access token. Strict: a claim this version does not know is a refusal.
function claimsSchema(options: AssistantTokenVerifierOptions) {
  return z.strictObject({
    sub: z.string().min(1),
    azp: z.string().min(1),
    client_id: z.string().min(1),
    scope: z.string(),
    iss: z.literal(options.issuer),
    aud: z.literal(options.resource),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
    jti: z.string().min(1),
    sid: z.string().min(1).optional(),
  }).refine((claims) => claims.azp === claims.client_id && claims.exp > claims.iat && claims.exp - claims.iat <= options.maxLifetimeSeconds);
}

function dataScopes(scope: string): AssistantScope[] {
  return scope.split(" ").filter((candidate): candidate is AssistantScope => (assistantScopes as readonly string[]).includes(candidate));
}

/**
 * Verifies the JWT access token of an assistant: `alg` EdDSA, `typ` `at+jwt`, issuer, the MCP resource as audience and a strict claim schema.
 * The token is not checked against a live session: it outlives sign-out by design, and the connection row decides if it still works.
 */
export function createAssistantTokenVerifier(options: AssistantTokenVerifierOptions): AssistantTokenVerifier {
  const claims = claimsSchema(options);
  const verifyOptions = () => ({ algorithms: ["EdDSA"], typ: "at+jwt", issuer: options.issuer, audience: options.resource, currentDate: options.now() });

  return {
    async verify(token) {
      let payload: unknown;
      try {
        ({ payload } = await jwtVerify(token, await options.keys.get(), verifyOptions()));
      } catch (cause) {
        if (cause instanceof errors.JWKSNoMatchingKey) {
          try {
            ({ payload } = await jwtVerify(token, await options.keys.refresh(), verifyOptions()));
          } catch (retryCause) {
            return failure(retryCause, "unable_to_refresh_assistant_public_keys");
          }
        } else return failure(cause, "unable_to_load_assistant_public_keys");
      }
      const parsed = claims.safeParse(payload);
      if (!parsed.success) return invalid();
      return ok({ userId: parsed.data.sub as UserId, oauthClientId: parsed.data.client_id as OAuthClientId, scopes: dataScopes(parsed.data.scope), expiresAt: parsed.data.exp });
    },
  };
}

function failure(cause: unknown, event: string): Result<never, AssistantTokenError> {
  if (cause instanceof errors.JOSEError) return invalid();
  log.error({ event, err: cause }, event);
  return err({ code: "AUTH_SERVICE_UNAVAILABLE", message: "Unable to load assistant public keys" });
}
