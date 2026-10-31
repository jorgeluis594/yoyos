import { beforeAll, describe, expect, test, vi } from "vitest";
import { log } from "@core/src/shared/infrastructure/logger";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWTPayload } from "jose";
import { createAssistantTokenVerifier } from "@core/src/features/assistants/infrastructure/assistant-token-verifier";

const issuer = "https://app.yoyos.test";
const resource = `${issuer}/mcp`;
const nowSeconds = 1_793_000_000;
let signingKey: CryptoKey;
let otherKey: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { extractable: true });
  signingKey = pair.privateKey;
  otherKey = (await generateKeyPair("EdDSA")).privateKey;
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "key-1", alg: "EdDSA" }] });
});

const claims = (overrides: Record<string, unknown> = {}): JWTPayload => ({
  sub: "user-1", azp: "client-1", client_id: "client-1", scope: "orders:read offline_access", iss: issuer, aud: resource,
  iat: nowSeconds, exp: nowSeconds + 3600, jti: "jti-1", ...overrides,
});

async function sign(payload: JWTPayload, header: { typ?: string; alg?: string; kid?: string } = {}, key = signingKey) {
  return new SignJWT(payload).setProtectedHeader({ alg: "EdDSA", typ: "at+jwt", kid: "key-1", ...header }).sign(key);
}

function verifier(refresh = async () => keys) {
  return createAssistantTokenVerifier({
    keys: { get: async () => keys, refresh }, issuer, resource, maxLifetimeSeconds: 3600, now: () => new Date(nowSeconds * 1000 + 1000),
  });
}

describe("assistant token verifier", () => {
  test("verifies an access token for the MCP resource and returns the account, client and data scopes", async () => {
    const result = await verifier().verify(await sign(claims()));
    expect(result).toEqual({ success: true, data: { userId: "user-1", oauthClientId: "client-1", scopes: ["orders:read"], expiresAt: nowSeconds + 3600 } });
  });

  test("accepts the optional session id claim", async () => {
    expect((await verifier().verify(await sign(claims({ sid: "session-1" })))).success).toBe(true);
  });

  test.each([
    ["a token for another audience", claims({ aud: "yoyos-core-api" }), {}],
    ["a mobile JWT shape", claims({ aud: "yoyos-core-api", azp: undefined, client_id: undefined, scope: undefined }), { typ: "JWT" }],
    ["a token of another type", claims(), { typ: "JWT" }],
    ["a token without a type", claims(), { typ: undefined }],
    ["a token of another issuer", claims({ iss: "https://evil.example" }), {}],
    ["an expired token", claims({ iat: nowSeconds - 7200, exp: nowSeconds - 3600 }), {}],
    ["a token living longer than the configured lifetime", claims({ exp: nowSeconds + 3601 }), {}],
    ["a token with an extra claim", claims({ role: "admin" }), {}],
    ["a token without a client", claims({ azp: undefined }), {}],
    ["a token whose client claims differ", claims({ client_id: "client-2" }), {}],
    ["a token with a list audience", claims({ aud: [resource, "other"] }), {}],
    ["a token without an identifier", claims({ jti: undefined }), {}],
    ["a token with a non-string scope", claims({ scope: ["orders:read"] }), {}],
  ])("refuses %s", async (_name, payload, header) => {
    expect(await verifier().verify(await sign(payload, header))).toEqual({ success: false, error: { code: "INVALID_TOKEN", message: "Invalid token" } });
  });

  test("refuses a token signed with another key, an unsigned token and garbage", async () => {
    const forged = await sign(claims(), {}, otherKey);
    expect((await verifier().verify(forged)).success).toBe(false);
    const none = `${Buffer.from('{"alg":"none","typ":"at+jwt"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims())).toString("base64url")}.`;
    expect((await verifier().verify(none)).success).toBe(false);
    expect((await verifier().verify("not a token")).success).toBe(false);
  });

  test("refuses a token signed with another algorithm", async () => {
    const rsa = await generateKeyPair("RS256");
    expect((await verifier().verify(await sign(claims(), { alg: "RS256" }, rsa.privateKey))).success).toBe(false);
  });

  test("refreshes the keys once for an unknown key id and refuses when it is still unknown", async () => {
    let refreshes = 0;
    const result = await verifier(async () => { refreshes += 1; return keys; }).verify(await sign(claims(), { kid: "rotated-key" }));
    expect(result).toMatchObject({ success: false, error: { code: "INVALID_TOKEN" } });
    expect(refreshes).toBe(1);
  });

  test("ignores scopes it does not know and keeps an empty list for a token with only offline access", async () => {
    const result = await verifier().verify(await sign(claims({ scope: "offline_access openid" })));
    expect(result).toMatchObject({ success: true, data: { scopes: [] } });
  });

  test("answers a service error when the keys cannot be loaded", async () => {
    const diagnostic = vi.spyOn(log, "error").mockImplementation(() => undefined);
    const broken = createAssistantTokenVerifier({
      keys: { get: async () => { throw new Error("store down"); }, refresh: async () => keys }, issuer, resource, maxLifetimeSeconds: 3600,
      now: () => new Date(nowSeconds * 1000),
    });
    expect(await broken.verify(await sign(claims()))).toMatchObject({ success: false, error: { code: "AUTH_SERVICE_UNAVAILABLE" } });
    expect(diagnostic).toHaveBeenCalledOnce();
    diagnostic.mockRestore();
  });
});
