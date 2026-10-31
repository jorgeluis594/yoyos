import { err, ok } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import type { CompanyId, UserId } from "@shared/identity";
import { log } from "@core/src/shared/infrastructure/logger";
import { systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import { loadAccountAccess } from "@core/src/composition/assistant-account-access";
import { isConnectionActive, type ConnectionWithPasswordChange, type OAuthClientId } from "@core/src/features/assistants/domain/assistant-connection";
import { endAccountAssistantConnections, type AccountAccess, type PersistenceError, type EndAccountAssistantConnectionsDependencies } from "@core/src/features/assistants/application/disconnect-assistant";
import { assistantScopes, oauthScopes } from "@core/src/features/assistants/domain/scopes";
import { assistantConfig } from "@core/src/features/assistants/infrastructure/assistant-config";
import { connectionRepository } from "@core/src/features/assistants/infrastructure/connection-repository";
import { findConnectionForClient } from "@core/src/features/assistants/infrastructure/connection-lookup";
import { revokeEndedConnectionGrant, revokeGrantTokens, type RevokedGrant } from "@core/src/features/assistants/infrastructure/oauth-grant-revocation";
import { createOAuthBeforeHook } from "@core/src/features/assistants/infrastructure/oauth-hooks";

/**
 * What `auth.ts` registers: the `hooks.before` dispatcher and the `onPasswordReset` callback. This file and everything it imports
 * must not import `auth.ts`: the hook is defined when `betterAuth({...})` evaluates (technical design, section 5.11).
 */

const unavailable = { code: "PERSISTENCE_UNAVAILABLE", message: "Assistant connections unavailable" } as const;

export type HasActiveConnectionDependencies = Readonly<{
  loadAccess: (userId: UserId) => Promise<Result<AccountAccess | null, PersistenceError>>;
  findConnection: (companyId: CompanyId, oauthClientId: OAuthClientId, userId: UserId) => Promise<Result<ConnectionWithPasswordChange | null, AppError>>;
  now: () => Date;
  inactivityDays: number;
}>;

export function createHasActiveConnection(deps: HasActiveConnectionDependencies) {
  return async (userId: UserId, oauthClientId: OAuthClientId): Promise<Result<boolean, PersistenceError>> => {
    const access = await deps.loadAccess(userId);
    if (!access.success) return err(unavailable);
    // An account that is not ready (no store) has no connection to keep a consent alive.
    if (access.data === null || access.data.status !== "ready") return ok(false);
    const found = await deps.findConnection(access.data.company.id as CompanyId, oauthClientId, userId);
    if (!found.success) return err(unavailable);
    return ok(found.data !== null && isConnectionActive(found.data, deps.now(), deps.inactivityDays, assistantScopes));
  };
}

const loadAccess: EndAccountAssistantConnectionsDependencies["loadAccess"] = async (userId) => {
  const access = await loadAccountAccess(userId);
  return access.success ? ok(access.data) : err(unavailable);
};

const hasActiveConnection = createHasActiveConnection({
  loadAccess,
  findConnection: (companyId, oauthClientId, userId) => withTenantIsolation(companyId, () => findConnectionForClient(oauthClientId, userId)),
  now: () => new Date(),
  inactivityDays: assistantConfig.connectionInactivityDays,
});

/** `oauthClient` is a global table (no company), so the write goes through `systemPrisma`; a row already holding the set is not rewritten. */
async function alignClientScopes(oauthClientId: OAuthClientId): Promise<Result<"aligned" | "unchanged", PersistenceError>> {
  try {
    const scopes = [...oauthScopes];
    const updated = await systemPrisma.$executeRaw`
      UPDATE "oauthClient" SET scopes = ${scopes}::text[]
      WHERE "clientId" = ${oauthClientId} AND NOT (scopes @> ${scopes}::text[] AND scopes <@ ${scopes}::text[])`;
    if (updated === 0) return ok("unchanged");
    log.info({ event: "assistant_client_scopes_aligned", oauthClientId }, "assistant_client_scopes_aligned");
    return ok("aligned");
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    return err(unavailable);
  }
}

/** At `/authorize` there may be no company and no connection row, so the grant is revoked by (client, account) alone. */
async function revokePriorGrant(userId: UserId, oauthClientId: OAuthClientId): Promise<Result<RevokedGrant, PersistenceError>> {
  const revoked = await revokeGrantTokens({ oauthClientId, userId, revokedAt: new Date() });
  if (!revoked.success) return err(unavailable);
  if (revoked.data.consents > 0 || revoked.data.refreshTokens > 0 || revoked.data.accessTokens > 0) {
    log.info({ event: "assistant_prior_grant_revoked", userId, oauthClientId, ...revoked.data }, "assistant_prior_grant_revoked");
  }
  return revoked;
}

export const oauthBeforeHook = createOAuthBeforeHook({
  hasActiveConnection,
  alignClientScopes,
  revokePriorGrant,
  reportFailure: ({ userId, oauthClientId, errorCode }) =>
    log.error({ event: "assistant_authorize_hook_failed", userId, oauthClientId, errorCode }, "assistant_authorize_hook_failed"),
  reportRefusedConsent: ({ userId, oauthClientId }) =>
    log.warn({ event: "assistant_consent_refused", userId, oauthClientId }, "assistant_consent_refused"),
});

type EndAccountConnections = (input: Readonly<{ userId: UserId }>) => Promise<Result<number, PersistenceError>>;

/** Better Auth's `emailAndPassword.onPasswordReset`: best-effort cleanup, logged once on failure; the password-change rule refuses those connections anyway. */
export function createPasswordResetCleanup(end: EndAccountConnections) {
  return async ({ user }: Readonly<{ user: Readonly<{ id: string }> }>): Promise<void> => {
    try {
      const ended = await end({ userId: user.id as UserId });
      if (!ended.success) log.error({ event: "assistant_password_reset_cleanup_failed", userId: user.id, errorCode: ended.error.code }, "assistant_password_reset_cleanup_failed");
    } catch (cause) {
      log.error({ event: "assistant_password_reset_cleanup_failed", userId: user.id, errorCode: "UNEXPECTED_ERROR", err: cause }, "assistant_password_reset_cleanup_failed");
    }
  };
}

const accountConnections: EndAccountAssistantConnectionsDependencies = {
  loadAccess,
  deleteAccountConnections: (companyId: CompanyId, userId: UserId) => connectionRepository.deleteAccountConnections(companyId, userId),
  revokeClientGrant: revokeEndedConnectionGrant,
};

export const onPasswordReset = createPasswordResetCleanup((input) => endAccountAssistantConnections(input, accountConnections));
