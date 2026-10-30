import { afterAll, expect, test } from "vitest";
import { app } from "@core/src/app";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";

const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Integration server did not bind");
const api = `http://127.0.0.1:${address.port}`;
const clientIds: string[] = [];
const emails: string[] = [];

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${api}${path}`, { method: "POST", headers: { origin: baseUrl, "content-type": "application/json", ...headers }, body: JSON.stringify(body), redirect: "manual" });

async function register(redirectUris: string[]) {
  const response = await post("/api/auth/oauth2/register", { client_name: "Claude", redirect_uris: redirectUris, token_endpoint_auth_method: "none" });
  const body = await response.json();
  if (typeof body.client_id === "string") clientIds.push(body.client_id);
  return { response, body };
}

afterAll(async () => {
  await systemPrisma.oauthClient.deleteMany({ where: { clientId: { in: clientIds } } });
  await systemPrisma.user.deleteMany({ where: { email: { in: emails } } });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await systemPrisma.$disconnect();
});

test("serves the authorization server metadata with the OAuth endpoints and S256", async () => {
  const response = await fetch(`${api}/.well-known/oauth-authorization-server`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/api/auth/oauth2/authorize`,
    token_endpoint: `${baseUrl}/api/auth/oauth2/token`,
    registration_endpoint: `${baseUrl}/api/auth/oauth2/register`,
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
  });
});

test("serves the protected resource metadata of the MCP endpoint", async () => {
  for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
    const response = await fetch(`${api}${path}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      resource: `${baseUrl}/mcp`,
      authorization_servers: [baseUrl],
      scopes_supported: ["orders:read", "offline_access"],
      bearer_methods_supported: ["header"],
      resource_name: "Yoyos",
    });
  }
});

test("does not serve the OpenID configuration", async () => {
  expect((await fetch(`${api}/api/auth/.well-known/openid-configuration`)).status).toBe(404);
});

test("registers a public client with an https redirect URI", async () => {
  const { response, body } = await register(["https://claude.ai/api/mcp/auth_callback"]);
  expect(response.status).toBe(201);
  expect(body).toMatchObject({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none" });
  expect(await systemPrisma.oauthClientResource.findMany({ where: { clientId: body.client_id }, select: { resourceId: true } })).toEqual([{ resourceId: `${baseUrl}/mcp` }]);
});

test("answers 404 on the plugin endpoints this version does not use, also for a signed-in account", async () => {
  const email = `oauth-${crypto.randomUUID()}@example.test`;
  const password = "oauth-test-password-123";
  emails.push(email);
  expect((await post("/api/auth/sign-up/email", { name: "OAuth test", email, password })).status).toBe(200);
  await systemPrisma.user.update({ where: { email }, data: { emailVerified: true } });
  const signedIn = await post("/api/auth/sign-in/email", { email, password });
  expect(signedIn.status).toBe(200);
  const cookie = signedIn.headers.get("set-cookie")?.split(";")[0] ?? "";
  expect(cookie).not.toBe("");

  const create = await post("/api/auth/oauth2/create-client", { client_name: "Evil", redirect_uris: ["https://evil.example/cb"] }, { cookie });
  expect(create.status).toBe(404);
  for (const path of ["/oauth2/get-clients", "/oauth2/public-client", "/oauth2/userinfo", "/oauth2/introspect", "/oauth2/get-consents"]) {
    const response = await fetch(`${api}/api/auth${path}`, { headers: { cookie } });
    expect(response.status, path).toBe(404);
  }
});

test("authorize refuses an allowed https redirect URI that is not registered for the client", async () => {
  const { body } = await register(["https://claude.ai/api/mcp/auth_callback"]);
  const query = new URLSearchParams({
    response_type: "code", client_id: body.client_id, redirect_uri: "https://other.example/callback",
    scope: "orders:read offline_access", code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", code_challenge_method: "S256",
    state: "state-1", resource: `${baseUrl}/mcp`,
  });
  const response = await fetch(`${api}/api/auth/oauth2/authorize?${query}`, { redirect: "manual" });
  const text = await response.text();
  expect(`${response.headers.get("location") ?? ""} ${text}`).toContain("invalid_redirect");
  expect(response.headers.get("location") ?? "").not.toContain("other.example");
});
