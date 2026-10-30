import { describe, expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import type { CompanyId, UserId } from "@shared/identity";
import type { UserAccess } from "@core/src/features/users";
import type { AssistantConnectionId, ConnectionWithPasswordChange, OAuthClientId } from "@core/src/features/assistants/domain/assistant-connection";
import {
  resolveAssistantAccess, type ResolveAssistantAccessDependencies, type VerifiedAssistantToken,
} from "@core/src/features/assistants/application/resolve-assistant-access";

const now = new Date("2026-10-30T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const companyId = "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0002" as CompanyId;
const token: VerifiedAssistantToken = { userId: "user-1" as UserId, oauthClientId: "client-1" as OAuthClientId, scopes: ["orders:read"] };

const ready = { status: "ready", user: { id: "user-1", name: "Rosa", emailVerified: true, companyId }, company: { id: companyId } } as unknown as UserAccess;

function connection(overrides: Partial<ConnectionWithPasswordChange> = {}): ConnectionWithPasswordChange {
  return {
    id: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0001" as AssistantConnectionId, companyId, authorizedByUserId: "user-1" as UserId,
    oauthClientId: "client-1" as OAuthClientId, agentName: null, returnTarget: { kind: "this_device" }, scopes: ["orders:read"],
    authorizedAt: daysAgo(20), lastUsedAt: daysAgo(1), passwordChangedAt: null, ...overrides,
  };
}

function dependencies(overrides: Partial<ResolveAssistantAccessDependencies> = {}): ResolveAssistantAccessDependencies {
  return {
    loadUserAccess: async () => ok(ready),
    inTenant: (_company, work) => work(),
    findConnection: async () => ok(connection()),
    endConnection: vi.fn(async () => ok(null)),
    clock: () => now,
    inactivityDays: 90,
    ...overrides,
  };
}

describe("resolveAssistantAccess", () => {
  test("resolves the store, connection and scopes of an active connection", async () => {
    const result = await resolveAssistantAccess(token, dependencies());
    expect(result).toEqual({ success: true, data: { companyId, userId: "user-1", connectionId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0001", scopes: ["orders:read"], lastUsedAt: daysAgo(1) } });
  });

  test("refuses access when the account is not ready, has no connection or the connection is inactive", async () => {
    const notReady = await resolveAssistantAccess(token, dependencies({ loadUserAccess: async () => ok({ ...ready, status: "company_required" } as unknown as UserAccess) }));
    expect(notReady).toMatchObject({ success: false, error: { code: "NOT_AUTHORIZED", reason: "not_ready" } });
    const deleted = await resolveAssistantAccess(token, dependencies({ loadUserAccess: async () => ok(null) }));
    expect(deleted).toMatchObject({ success: false, error: { code: "NOT_AUTHORIZED", reason: "not_ready" } });
    const missing = await resolveAssistantAccess(token, dependencies({ findConnection: async () => ok(null) }));
    expect(missing).toMatchObject({ success: false, error: { code: "NOT_AUTHORIZED", reason: "no_connection" } });
    const inactive = await resolveAssistantAccess(token, dependencies({ findConnection: async () => ok(connection({ lastUsedAt: daysAgo(90) })) }));
    expect(inactive).toMatchObject({ success: false, error: { code: "NOT_AUTHORIZED", reason: "inactive" } });
  });

  test("ends an inactive connection when its token is used", async () => {
    const endConnection = vi.fn(async () => ok(null));
    const stale = connection({ lastUsedAt: daysAgo(91) });
    await resolveAssistantAccess(token, dependencies({ findConnection: async () => ok(stale), endConnection }));
    expect(endConnection).toHaveBeenCalledWith(stale, "inactive");
  });

  test("ends a connection authorized before the last password change and says so", async () => {
    const endConnection = vi.fn(async () => ok(null));
    const changed = connection({ authorizedAt: daysAgo(10), passwordChangedAt: daysAgo(2) });
    const result = await resolveAssistantAccess(token, dependencies({ findConnection: async () => ok(changed), endConnection }));
    expect(result).toMatchObject({ success: false, error: { reason: "password_changed" } });
    expect(endConnection).toHaveBeenCalledWith(changed, "password_reset");
  });

  test("refuses a token without the orders scope or a connection without it", async () => {
    const noTokenScope = await resolveAssistantAccess({ ...token, scopes: [] }, dependencies());
    expect(noTokenScope).toMatchObject({ success: false, error: { reason: "scope" } });
  });

  test("reads the connection inside the store's tenant", async () => {
    const tenants: CompanyId[] = [];
    await resolveAssistantAccess(token, dependencies({ inTenant: (company, work) => { tenants.push(company); return work(); } }));
    expect(tenants).toEqual([companyId]);
  });

  test("passes a persistence failure through instead of refusing the token", async () => {
    const failure = { success: false as const, error: { code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" } };
    expect(await resolveAssistantAccess(token, dependencies({ findConnection: async () => failure }))).toEqual(failure);
    expect(await resolveAssistantAccess(token, dependencies({ loadUserAccess: async () => failure }))).toEqual(failure);
  });
});
