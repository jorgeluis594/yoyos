import { describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { UserId } from "@shared/identity";
import { listAssistantConnections } from "@core/src/features/assistants/application/list-assistant-connections";
import { disconnectAssistant, endAccountAssistantConnections, type EndedConnection } from "@core/src/features/assistants/application/disconnect-assistant";
import type { AssistantConnectionId, OAuthClientId } from "@core/src/features/assistants/domain/assistant-connection";
import { now, ownerAccess, resolved, storedConnection } from "@core/src/features/assistants/application/assistant-fixtures";

const days = (count: number) => new Date(now.getTime() - count * 24 * 60 * 60 * 1000);

describe("listAssistantConnections", () => {
  test("lists active connections newest first and hides ended ones", async () => {
    const older = storedConnection({ id: "00000000-0000-4000-8000-000000000001" as AssistantConnectionId, authorizedAt: days(20), lastUsedAt: days(1) });
    const newer = storedConnection({ id: "00000000-0000-4000-8000-000000000002" as AssistantConnectionId, oauthClientId: "c2" as OAuthClientId, authorizedAt: days(2) });
    const idle = storedConnection({ id: "00000000-0000-4000-8000-000000000003" as AssistantConnectionId, oauthClientId: "c3" as OAuthClientId, authorizedAt: days(200), lastUsedAt: days(91) });
    const afterReset = storedConnection({ id: "00000000-0000-4000-8000-000000000004" as AssistantConnectionId, oauthClientId: "c4" as OAuthClientId, authorizedAt: days(10), passwordChangedAt: days(5) });
    const result = await listAssistantConnections({}, ownerAccess, {
      findConnections: vi.fn(() => resolved([older, idle, newer, afterReset])), clock: () => now, inactivityDays: 90,
    });
    expect(result).toEqual(ok([newer, older]));
  });

  test("passes the company of the access to the read", async () => {
    const findConnections = vi.fn(() => resolved([]));
    await listAssistantConnections({}, ownerAccess, { findConnections, clock: () => now, inactivityDays: 90 });
    expect(findConnections).toHaveBeenCalledWith(ownerAccess.companyId);
  });

  test("returns the persistence failure instead of an empty list", async () => {
    const result = await listAssistantConnections({}, ownerAccess, {
      findConnections: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }), clock: () => now, inactivityDays: 90,
    });
    expect(result).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
  });
});

const ended: EndedConnection = { id: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0001" as AssistantConnectionId, oauthClientId: "client-1" as OAuthClientId, authorizedByUserId: "user-1" as UserId };

describe("disconnectAssistant", () => {
  test("deletes the connection and revokes the client's grant", async () => {
    const deps = { deleteConnection: vi.fn(() => resolved<EndedConnection | null>(ended)), revokeClientGrant: vi.fn(() => resolved(null)) };
    expect(await disconnectAssistant({ connectionId: ended.id }, ownerAccess, deps)).toEqual(ok(null));
    expect(deps.deleteConnection).toHaveBeenCalledWith(ended.id, ownerAccess.companyId);
    expect(deps.revokeClientGrant).toHaveBeenCalledWith(ended);
  });

  test("disconnecting an already ended connection succeeds", async () => {
    const deps = { deleteConnection: vi.fn(() => resolved<EndedConnection | null>(null)), revokeClientGrant: vi.fn(() => resolved(null)) };
    expect(await disconnectAssistant({ connectionId: ended.id }, ownerAccess, deps)).toEqual(ok(null));
    expect(deps.revokeClientGrant).not.toHaveBeenCalled();
  });

  test("disconnect succeeds when token revocation fails", async () => {
    const deps = { deleteConnection: async () => ok<EndedConnection | null>(ended), revokeClientGrant: async () => err({ code: "REVOCATION_FAILED" as const, message: "down" }) };
    expect(await disconnectAssistant({ connectionId: ended.id }, ownerAccess, deps)).toEqual(ok(null));
  });

  test("fails when the row cannot be deleted", async () => {
    const deps = { deleteConnection: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" }), revokeClientGrant: vi.fn(() => resolved(null)) };
    expect(await disconnectAssistant({ connectionId: ended.id }, ownerAccess, deps)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    expect(deps.revokeClientGrant).not.toHaveBeenCalled();
  });
});

describe("endAccountAssistantConnections", () => {
  const readyAccess = { status: "ready" as const, company: { id: ownerAccess.companyId } };
  test("deletes the account's connections in its store and revokes each grant", async () => {
    const other: EndedConnection = { ...ended, id: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0008" as AssistantConnectionId, oauthClientId: "client-2" as OAuthClientId };
    const deps = {
      loadAccess: vi.fn(() => resolved(readyAccess)),
      deleteAccountConnections: vi.fn(() => resolved([ended, other])),
      revokeClientGrant: vi.fn(() => resolved(null)),
    };
    expect(await endAccountAssistantConnections({ userId: ownerAccess.userId }, deps)).toEqual(ok(2));
    expect(deps.deleteAccountConnections).toHaveBeenCalledWith(ownerAccess.companyId, ownerAccess.userId);
    expect(deps.revokeClientGrant).toHaveBeenCalledTimes(2);
  });

  test("ends nothing for an account without a store", async () => {
    const deps = { loadAccess: async () => ok({ status: "company_required" as const, company: null }), deleteAccountConnections: vi.fn(() => resolved([])), revokeClientGrant: vi.fn(() => resolved(null)) };
    expect(await endAccountAssistantConnections({ userId: ownerAccess.userId }, deps)).toEqual(ok(0));
    expect(deps.deleteAccountConnections).not.toHaveBeenCalled();
  });

  test("reports a failure to load or delete and still revokes what was deleted before", async () => {
    const failing = { loadAccess: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" }), deleteAccountConnections: vi.fn(() => resolved([])), revokeClientGrant: vi.fn(() => resolved(null)) };
    expect(await endAccountAssistantConnections({ userId: ownerAccess.userId }, failing)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    const revokeFails = { loadAccess: async () => ok(readyAccess), deleteAccountConnections: async () => ok([ended]), revokeClientGrant: async () => err({ code: "REVOCATION_FAILED" as const, message: "x" }) };
    expect(await endAccountAssistantConnections({ userId: ownerAccess.userId }, revokeFails)).toEqual(ok(1));
  });
});
