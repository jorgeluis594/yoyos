import { describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import {
  authorizeAssistant, type AuthorizeAssistantDependencies, type AuthorizationRequest, type RedirectUrl, type SignedAuthorizationRequest,
} from "@core/src/features/assistants/application/authorize-assistant";
import { denyAssistant, type DenyAssistantDependencies } from "@core/src/features/assistants/application/deny-assistant";
import type { AssistantConnectionId } from "@core/src/features/assistants/domain/assistant-connection";
import { clientId, now, ownerAccess } from "@core/src/features/assistants/application/assistant-fixtures";

const signed = "client_id=client-1&exp=1&sig=x" as SignedAuthorizationRequest;
const agentRedirect = "https://claude.ai/api/mcp/auth_callback?code=abc" as RedirectUrl;
const request: AuthorizationRequest = { oauthClientId: clientId, clientName: "  Claude ", redirectUri: "https://claude.ai/api/mcp/auth_callback" };

function dependencies(overrides: Partial<AuthorizeAssistantDependencies & DenyAssistantDependencies> = {}) {
  const calls: string[] = [];
  const deps: AuthorizeAssistantDependencies & DenyAssistantDependencies = {
    readRequest: vi.fn(async () => { calls.push("read"); return ok(request); }),
    acceptRequest: vi.fn(async () => { calls.push("accept"); return ok(agentRedirect); }),
    rejectRequest: vi.fn(async () => { calls.push("reject"); return ok("https://claude.ai/api/mcp/auth_callback?error=access_denied" as RedirectUrl); }),
    saveConnection: vi.fn(async () => { calls.push("save"); return ok("inserted" as const); }),
    generateId: () => "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0009" as AssistantConnectionId,
    clock: () => now,
    ...overrides,
  };
  return { deps, calls };
}

describe("authorizeAssistant", () => {
  test("accepts the request before saving the connection and returns the agent redirect", async () => {
    const { deps, calls } = dependencies();
    const result = await authorizeAssistant({ request: signed }, ownerAccess, deps);
    expect(result).toEqual(ok(agentRedirect));
    expect(calls).toEqual(["read", "accept", "save"]);
    expect(deps.saveConnection).toHaveBeenCalledWith({
      id: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0009", companyId: ownerAccess.companyId, authorizedByUserId: ownerAccess.userId, oauthClientId: clientId,
      agentName: "Claude", returnTarget: { kind: "web", domain: "claude.ai" }, scopes: ["orders:read"], authorizedAt: now,
    });
    expect(deps.acceptRequest).toHaveBeenCalledWith(signed, { oauthClientId: clientId, userId: ownerAccess.userId });
  });

  test("saves nothing when the request expired", async () => {
    const { deps } = dependencies({ readRequest: async () => err({ code: "REQUEST_EXPIRED", message: "expired" }) });
    expect(await authorizeAssistant({ request: signed }, ownerAccess, deps)).toMatchObject({ success: false, error: { code: "REQUEST_EXPIRED" } });
    expect(deps.acceptRequest).not.toHaveBeenCalled();
    expect(deps.saveConnection).not.toHaveBeenCalled();
  });

  test("saves nothing when the request expires between reading and accepting", async () => {
    const { deps } = dependencies({ acceptRequest: async () => err({ code: "REQUEST_EXPIRED", message: "expired" }) });
    expect(await authorizeAssistant({ request: signed }, ownerAccess, deps)).toMatchObject({ success: false, error: { code: "REQUEST_EXPIRED" } });
    expect(deps.saveConnection).not.toHaveBeenCalled();
  });

  test("refuses a redirect that cannot be shown honestly without calling the plugin", async () => {
    const { deps } = dependencies({ readRequest: async () => ok({ ...request, redirectUri: "evil://chatgpt.com/cb" }) });
    expect(await authorizeAssistant({ request: signed }, ownerAccess, deps)).toMatchObject({ success: false, error: { code: "REQUEST_INVALID" } });
    expect(deps.acceptRequest).not.toHaveBeenCalled();
  });

  test("keeps no code for the agent when the connection cannot be saved", async () => {
    const { deps } = dependencies({ saveConnection: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }) });
    expect(await authorizeAssistant({ request: signed }, ownerAccess, deps)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
  });

  test("keeps one connection when the same request is allowed twice", async () => {
    const results = ["inserted", "unchanged"] as const;
    let call = 0;
    const { deps } = dependencies({ saveConnection: async () => ok(results[call++]) });
    const first = await authorizeAssistant({ request: signed }, ownerAccess, deps);
    const second = await authorizeAssistant({ request: signed }, ownerAccess, deps);
    expect(first).toEqual(ok(agentRedirect));
    expect(second).toEqual(ok(agentRedirect));
  });

  test("a missing agent name is stored as no name", async () => {
    const { deps } = dependencies({ readRequest: async () => ok({ ...request, clientName: null }) });
    await authorizeAssistant({ request: signed }, ownerAccess, deps);
    expect(deps.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ agentName: null }));
  });
});

describe("denyAssistant", () => {
  test("denying a request returns the access denied redirect and saves nothing", async () => {
    const { deps } = dependencies();
    const result = await denyAssistant({ request: signed }, ownerAccess, deps);
    expect(result).toEqual(ok("https://claude.ai/api/mcp/auth_callback?error=access_denied"));
    expect(deps.rejectRequest).toHaveBeenCalledWith(signed, { oauthClientId: clientId, userId: ownerAccess.userId });
    expect(deps.saveConnection).not.toHaveBeenCalled();
    expect(deps.acceptRequest).not.toHaveBeenCalled();
  });

  test("does not reject a request that is not valid", async () => {
    const { deps } = dependencies({ readRequest: async () => err({ code: "REQUEST_INVALID", message: "bad" }) });
    expect(await denyAssistant({ request: signed }, ownerAccess, deps)).toMatchObject({ success: false, error: { code: "REQUEST_INVALID" } });
    expect(deps.rejectRequest).not.toHaveBeenCalled();
  });
});
