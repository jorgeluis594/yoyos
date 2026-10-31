import { describe, expect, test, vi } from "vitest";
import { ok, err } from "@shared/functional";
import type { UserId } from "@shared/identity";
import type { OAuthClientId } from "@core/src/features/assistants/domain/assistant-connection";
import {
  authorizeParameterSource, dispatchOAuthHook, withConsentMarker,
  type OAuthHookContext, type OAuthHookDependencies,
} from "@core/src/features/assistants/infrastructure/oauth-hooks";

const normalized = "orders:read products:read offline_access";
const clientId = "client-1" as OAuthClientId;
const userId = "user-1" as UserId;

function dependencies(overrides: Partial<OAuthHookDependencies> = {}): OAuthHookDependencies {
  return {
    readSessionUserId: vi.fn(async () => ok(userId)),
    hasActiveConnection: vi.fn(async () => ok(false)),
    alignClientScopes: vi.fn(async () => ok("unchanged" as const)),
    revokePriorGrant: vi.fn(async () => ok({ refreshTokens: 1, accessTokens: 1, consents: 1 })),
    reportFailure: vi.fn(),
    reportRefusedConsent: vi.fn(),
    ...overrides,
  };
}

const authorizeQuery = { client_id: clientId, scope: "openid profile", redirect_uri: "https://claude.ai/cb" };

describe("authorizeParameterSource", () => {
  test("reads authorize parameters from the query for a top-level GET", () => {
    expect(authorizeParameterSource({ path: "/oauth2/authorize", method: "GET" })).toBe("query");
  });

  test("reads authorize parameters from the body for a top-level form POST", () => {
    expect(authorizeParameterSource({ path: "/oauth2/authorize", method: "POST" })).toBe("body");
    expect(authorizeParameterSource({ path: "/oauth2/authorize", method: "POST", authorizeSettings: { isAuthorize: true } })).toBe("body");
  });

  test("reads authorize parameters from the query in the sign-in continuation although it is a POST with a sign-in body", () => {
    expect(authorizeParameterSource({ path: "/oauth2/authorize", method: "POST", authorizeSettings: {} })).toBe("query");
  });

  test("reads authorize parameters from the query in the authorize nested in the consent call although it is a POST with a consent body", () => {
    expect(authorizeParameterSource({ path: "/oauth2/authorize", method: "POST", authorizeSettings: { postLogin: false } })).toBe("query");
    expect(authorizeParameterSource({ path: "/oauth2/authorize", method: "POST", authorizeSettings: { postLogin: true } })).toBe("query");
  });
});

describe("authorize hook", () => {
  const get = (query: unknown, overrides: Partial<OAuthHookContext> = {}): OAuthHookContext => ({ path: "/oauth2/authorize", method: "GET", query, ...overrides });

  test("normalizes the scope of a top-level GET in the query", async () => {
    expect(await dispatchOAuthHook(get(authorizeQuery), dependencies())).toEqual({ context: { query: { scope: normalized } } });
  });

  test("normalizes the scope of a form POST in the body", async () => {
    const ctx: OAuthHookContext = { path: "/oauth2/authorize", method: "POST", body: { client_id: clientId }, query: { ignored: "yes" } };
    expect(await dispatchOAuthHook(ctx, dependencies())).toEqual({ context: { body: { scope: normalized } } });
  });

  test("normalizes the scope in the query of the sign-in continuation", async () => {
    const ctx = get({ client_id: clientId, scope: "offline_access" }, { method: "POST", body: { email: "a@b.c", password: "x" }, authorizeSettings: {} });
    expect(await dispatchOAuthHook(ctx, dependencies())).toEqual({ context: { query: { scope: normalized } } });
  });

  test("revokes the prior grant instead of only the consent when the signed-in account has no active connection", async () => {
    const deps = dependencies();
    await dispatchOAuthHook(get(authorizeQuery), deps);
    expect(deps.hasActiveConnection).toHaveBeenCalledWith(userId, clientId);
    expect(deps.revokePriorGrant).toHaveBeenCalledWith(userId, clientId);
  });

  test("keeps the stored consent while the connection is active", async () => {
    const deps = dependencies({ hasActiveConnection: async () => ok(true) });
    await dispatchOAuthHook(get(authorizeQuery), deps);
    expect(deps.revokePriorGrant).not.toHaveBeenCalled();
  });

  test("leaves the request to the plugin when nobody is signed in", async () => {
    const deps = dependencies({ readSessionUserId: async () => ok(null) });
    expect(await dispatchOAuthHook(get(authorizeQuery), deps)).toEqual({ context: { query: { scope: normalized } } });
    expect(deps.hasActiveConnection).not.toHaveBeenCalled();
    expect(deps.revokePriorGrant).not.toHaveBeenCalled();
  });

  test("keeps the fresh consent in the authorize nested in the owner's own allow", async () => {
    const deps = dependencies();
    const result = await withConsentMarker({ oauthClientId: clientId, userId }, () =>
      dispatchOAuthHook(get(authorizeQuery, { method: "POST", authorizeSettings: { postLogin: false } }), deps));
    expect(result).toEqual({ context: { query: { scope: normalized } } });
    expect(deps.revokePriorGrant).not.toHaveBeenCalled();
  });

  test("a marker for another client or account does not protect the consent", async () => {
    const deps = dependencies();
    await withConsentMarker({ oauthClientId: "other-client", userId }, () => dispatchOAuthHook(get(authorizeQuery), deps));
    await withConsentMarker({ oauthClientId: clientId, userId: "other-user" }, () => dispatchOAuthHook(get(authorizeQuery), deps));
    expect(deps.revokePriorGrant).toHaveBeenCalledTimes(2);
  });

  test("refuses an authorize whose parameters do not parse without running the plugin", async () => {
    for (const query of [undefined, "client_id=x", { scope: "orders:read" }, { client_id: "" }, { client_id: 7 }, { client_id: clientId, scope: ["a"] }]) {
      await expect(dispatchOAuthHook(get(query), dependencies())).rejects.toMatchObject({ status: "BAD_REQUEST", body: { error: "invalid_request" } });
    }
  });

  test("refuses an authorize when the connection read fails instead of passing a possibly stale consent", async () => {
    const deps = dependencies({ hasActiveConnection: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }) });
    await expect(dispatchOAuthHook(get(authorizeQuery), deps)).rejects.toMatchObject({ status: "SERVICE_UNAVAILABLE", body: { error: "server_error" } });
    expect(deps.reportFailure).toHaveBeenCalledWith({ userId, oauthClientId: clientId, errorCode: "PERSISTENCE_UNAVAILABLE" });
  });

  test("refuses an authorize when the session read fails", async () => {
    const deps = dependencies({ readSessionUserId: async () => err({ code: "AUTH_SERVICE_UNAVAILABLE", message: "down" }) });
    await expect(dispatchOAuthHook(get(authorizeQuery), deps)).rejects.toMatchObject({ status: "SERVICE_UNAVAILABLE" });
    expect(deps.hasActiveConnection).not.toHaveBeenCalled();
  });

  test("refuses an authorize when dropping the stale consent fails", async () => {
    const deps = dependencies({ revokePriorGrant: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }) });
    await expect(dispatchOAuthHook(get(authorizeQuery), deps)).rejects.toMatchObject({ status: "SERVICE_UNAVAILABLE" });
  });

  test("aligns the client's scopes before the session is read on authorize", async () => {
    const order: string[] = [];
    const deps = dependencies({
      alignClientScopes: vi.fn(async () => { order.push("align"); return ok("aligned" as const); }),
      readSessionUserId: vi.fn(async () => { order.push("session"); return ok(null); }),
    });
    await dispatchOAuthHook(get(authorizeQuery), deps);
    expect(order).toEqual(["align", "session"]);
    expect(deps.alignClientScopes).toHaveBeenCalledWith(clientId);
  });

  test("answers 503 when the client scopes cannot be aligned or the prior grant cannot be revoked", async () => {
    const alignFails = dependencies({ alignClientScopes: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }) });
    await expect(dispatchOAuthHook(get(authorizeQuery), alignFails)).rejects.toMatchObject({ status: "SERVICE_UNAVAILABLE", body: { error: "server_error" } });
    expect(alignFails.reportFailure).toHaveBeenCalledWith({ userId: "unknown", oauthClientId: clientId, errorCode: "PERSISTENCE_UNAVAILABLE" });
    expect(alignFails.readSessionUserId).not.toHaveBeenCalled();
    const revokeFails = dependencies({ revokePriorGrant: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }) });
    await expect(dispatchOAuthHook(get(authorizeQuery), revokeFails)).rejects.toMatchObject({ status: "SERVICE_UNAVAILABLE" });
    expect(revokeFails.reportFailure).toHaveBeenCalledWith({ userId, oauthClientId: clientId, errorCode: "PERSISTENCE_UNAVAILABLE" });
  });
});

describe("register hook", () => {
  const register = (body: unknown): OAuthHookContext => ({ path: "/oauth2/register", method: "POST", body });

  test("refuses a redirect URI that is not https or loopback http", async () => {
    for (const uri of ["evil://chatgpt.com/cb", "http://example.com/cb", "https://localhost/cb", "https://user@claude.ai/cb"]) {
      await expect(dispatchOAuthHook(register({ client_name: "X", redirect_uris: ["https://claude.ai/cb", uri] }), dependencies()))
        .rejects.toMatchObject({ status: "BAD_REQUEST", body: { error: "invalid_redirect_uri" } });
    }
  });

  test("replaces the scope sent at registration with orders and offline access", async () => {
    const result = await dispatchOAuthHook(register({ redirect_uris: ["http://localhost:6274/oauth/callback"], scope: "openid profile email" }), dependencies());
    expect(result).toEqual({ context: { body: { scope: normalized } } });
  });

  test("leaves a registration without a scope to the plugin's defaults", async () => {
    expect(await dispatchOAuthHook(register({ redirect_uris: ["https://claude.ai/cb"] }), dependencies())).toBeUndefined();
  });

  test("leaves a body the plugin must reject to the plugin", async () => {
    expect(await dispatchOAuthHook(register("nope"), dependencies())).toBeUndefined();
    expect(await dispatchOAuthHook(register({ redirect_uris: [3] }), dependencies())).toBeUndefined();
  });
});

describe("consent hook", () => {
  const consent: OAuthHookContext = { path: "/oauth2/consent", method: "POST", body: { accept: true, oauth_query: `client_id=${clientId}&sig=x` } };

  test("a consent call without the Yoyos marker is refused", async () => {
    const deps = dependencies();
    await expect(dispatchOAuthHook(consent, deps)).rejects.toMatchObject({ status: "FORBIDDEN" });
    expect(deps.reportRefusedConsent).toHaveBeenCalledWith({ userId, oauthClientId: clientId });
  });

  test("a consent call under the marker of its client and session account passes", async () => {
    const deps = dependencies();
    expect(await withConsentMarker({ oauthClientId: clientId, userId }, () => dispatchOAuthHook(consent, deps))).toBeUndefined();
    expect(deps.reportRefusedConsent).not.toHaveBeenCalled();
  });

  test("a marker for another client or account does not open the consent", async () => {
    await expect(withConsentMarker({ oauthClientId: "other", userId }, () => dispatchOAuthHook(consent, dependencies()))).rejects.toMatchObject({ status: "FORBIDDEN" });
    await expect(withConsentMarker({ oauthClientId: clientId, userId: "other" }, () => dispatchOAuthHook(consent, dependencies()))).rejects.toMatchObject({ status: "FORBIDDEN" });
  });

  test("a consent call without a readable request is refused", async () => {
    await expect(withConsentMarker({ oauthClientId: clientId, userId }, () => dispatchOAuthHook({ ...consent, body: { accept: true } }, dependencies()))).rejects.toMatchObject({ status: "FORBIDDEN" });
  });
});

test("lets every other path through untouched", async () => {
  const deps = dependencies();
  expect(await dispatchOAuthHook({ path: "/sign-in/email", method: "POST", body: { email: "a@b.c" } }, deps)).toBeUndefined();
  expect(await dispatchOAuthHook({ path: "/oauth2/token", method: "POST", body: {} }, deps)).toBeUndefined();
  expect(deps.readSessionUserId).not.toHaveBeenCalled();
});
