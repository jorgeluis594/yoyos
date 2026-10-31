import { ok } from "@shared/functional";
import type { CompanyId, UserId } from "@shared/identity";
import type { AssistantConnectionId, ConnectionWithPasswordChange, OAuthClientId } from "@core/src/features/assistants/domain/assistant-connection";

export const ownerAccess = { companyId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0002" as CompanyId, userId: "user-1" as UserId };
export const clientId = "client-1" as OAuthClientId;
export const now = new Date("2026-10-30T12:00:00.000Z");

export function storedConnection(overrides: Partial<ConnectionWithPasswordChange> = {}): ConnectionWithPasswordChange {
  return {
    id: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0001" as AssistantConnectionId,
    companyId: ownerAccess.companyId,
    authorizedByUserId: ownerAccess.userId,
    oauthClientId: clientId,
    agentName: null,
    returnTarget: { kind: "web", domain: "claude.ai" },
    scopes: ["orders:read"],
    authorizedAt: new Date("2026-10-01T10:00:00.000Z"),
    lastUsedAt: null,
    passwordChangedAt: null,
    ...overrides,
  };
}

export const resolved = <T>(value: T) => Promise.resolve(ok(value));
