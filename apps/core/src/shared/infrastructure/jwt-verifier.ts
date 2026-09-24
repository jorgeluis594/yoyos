import { createLocalJWKSet, jwtVerify, errors, type JSONWebKeySet } from "jose";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { auth, authIssuer } from "@core/src/shared/infrastructure/auth";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";
import type { AuthenticatedPrincipal, AuthenticationError } from "@core/src/shared/infrastructure/current-user";

const claimsSchema = z.object({
  sub: z.string().min(1),
  sid: z.string().min(1),
  iss: z.literal(authIssuer),
  aud: z.literal("yoyos-core-api"),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
}).strict().refine((claims) => claims.exp > claims.iat && claims.exp - claims.iat <= 900);

let cachedKeys: { verify: ReturnType<typeof createLocalJWKSet>; until: number } | undefined;

async function keys(refresh = false) {
  if (!refresh && cachedKeys && cachedKeys.until > Date.now()) return cachedKeys.verify;
  const jwks = await auth.api.getJwks();
  const verify = createLocalJWKSet(jwks as JSONWebKeySet);
  cachedKeys = { verify, until: Date.now() + 60_000 };
  return verify;
}

export async function authenticateJwt(token: string): Promise<Result<AuthenticatedPrincipal, AuthenticationError>> {
  let verify: ReturnType<typeof createLocalJWKSet>;
  try { verify = await keys(); }
  catch (cause) {
    console.error("Unable to load JWT public keys", cause);
    return err({ code: "AUTH_SERVICE_UNAVAILABLE", message: "Unable to load JWT public keys" });
  }

  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, verify, { algorithms: ["EdDSA"], issuer: authIssuer, audience: "yoyos-core-api" }));
  } catch (cause) {
    if (cause instanceof errors.JWKSNoMatchingKey) {
      try {
        ({ payload } = await jwtVerify(token, await keys(true), { algorithms: ["EdDSA"], issuer: authIssuer, audience: "yoyos-core-api" }));
      } catch (retryCause) {
        if (!(retryCause instanceof errors.JOSEError)) {
          console.error("Unable to refresh JWT public keys", retryCause);
          return err({ code: "AUTH_SERVICE_UNAVAILABLE", message: "Unable to load JWT public keys" });
        }
        return err({ code: "UNAUTHENTICATED", message: "Invalid token" });
      }
    } else return err({ code: "UNAUTHENTICATED", message: "Invalid token" });
  }

  const claims = claimsSchema.safeParse(payload);
  if (!claims.success) return err({ code: "UNAUTHENTICATED", message: "Invalid token" });
  try {
    const session = await systemPrisma.session.findFirst({
      where: { id: claims.data.sid, userId: claims.data.sub, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!session) return err({ code: "UNAUTHENTICATED", message: "Session expired or revoked" });
    return ok({ userId: claims.data.sub, sessionId: session.id });
  } catch (cause) {
    console.error("Unable to validate JWT session", cause);
    return err({ code: "AUTH_SERVICE_UNAVAILABLE", message: "Unable to validate JWT session" });
  }
}
