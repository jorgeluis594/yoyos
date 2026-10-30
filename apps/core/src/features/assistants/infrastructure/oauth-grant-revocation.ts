import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId, UserId } from "@shared/identity";
import { log } from "@core/src/shared/infrastructure/logger";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import type { AssistantConnectionId, OAuthClientId } from "@core/src/features/assistants/domain/assistant-connection";

export type RevokeClientGrantInput = Readonly<{
  oauthClientId: OAuthClientId;
  userId: UserId;
  // Only for the failure log line.
  companyId: CompanyId;
  connectionId: AssistantConnectionId;
}>;
export type RevokedGrant = Readonly<{ refreshTokens: number; accessTokens: number; consents: number }>;
export type RevokeClientGrantError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

/**
 * Cleanup after a connection ends: revokes the client's refresh and access tokens for this account and deletes its stored consent.
 * Tokens already revoked keep their revocation time; no other client's or account's rows are touched. The connection row is the
 * authority, so a failure here is logged and returned, never a reason to keep the connection.
 */
export async function revokeClientGrant(input: RevokeClientGrantInput): Promise<Result<RevokedGrant, RevokeClientGrantError>> {
  const { oauthClientId: clientId, userId } = input;
  try {
    const revoked = new Date();
    const grant = await systemPrisma.$transaction(async (tx) => {
      const refresh = await tx.oauthRefreshToken.updateMany({ where: { clientId, userId, revoked: null }, data: { revoked } });
      const access = await tx.oauthAccessToken.updateMany({ where: { clientId, userId, revoked: null }, data: { revoked } });
      const consents = await tx.oauthConsent.deleteMany({ where: { clientId, userId } });
      return { refreshTokens: refresh.count, accessTokens: access.count, consents: consents.count };
    });
    return ok(grant);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.warn({ event: "assistant_grant_revocation_failed", companyId: input.companyId, connectionId: input.connectionId, err: cause }, "assistant_grant_revocation_failed");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to revoke the assistant grant" });
  }
}
