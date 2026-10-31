import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { app } from "@core/src/app";
import type { CompanyId, UserId } from "@shared/identity";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { authorizationFor } from "@core/src/features/assistants/composition";
import { createOAuthGrant } from "@core/src/features/assistants/infrastructure/oauth-grant";
import { connectionRepository } from "@core/src/features/assistants/infrastructure/connection-repository";
import { revokeEndedConnectionGrant } from "@core/src/features/assistants/infrastructure/oauth-grant-revocation";
import type { AssistantConnectionId, OAuthClientId } from "@core/src/features/assistants/domain/assistant-connection";
import type { SignedAuthorizationRequest } from "@core/src/features/assistants/application/authorize-assistant";

const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const resource = `${baseUrl}/mcp`;
const redirectUri = "https://claude.ai/api/mcp/auth_callback";
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Integration server did not bind");
const api = `http://127.0.0.1:${address.port}`;
const clientIds: string[] = [];
const userIds: string[] = [];
const companyIds: CompanyId[] = [];

type Owner = Readonly<{ email: string; password: string; userId: UserId; companyId: CompanyId; cookie: string }>;
const password = "oauth-flow-password-123";

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${api}${path}`, { method: "POST", headers: { origin: baseUrl, "content-type": "application/json", ...headers }, body: JSON.stringify(body), redirect: "manual" });
}

async function createOwner(options: { verified?: boolean; withCompany?: boolean } = {}): Promise<Owner & { signedIn: boolean }> {
  const { verified = true, withCompany = true } = options;
  const email = `flow-${randomUUID()}@example.test`;
  expect((await post("/api/auth/sign-up/email", { name: "Rosa", email, password })).status).toBe(200);
  const user = await systemPrisma.user.findUniqueOrThrow({ where: { email } });
  userIds.push(user.id);
  const companyId = randomUUID() as CompanyId;
  if (withCompany) {
    await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name: "Tienda Rosa", country: "PE" } }));
    companyIds.push(companyId);
  }
  await systemPrisma.user.update({ where: { id: user.id }, data: { emailVerified: verified, companyId: withCompany ? companyId : null } });
  const owner = { email, password, userId: user.id as UserId, companyId, cookie: "" };
  return { ...owner, cookie: verified ? await signIn(owner) : "", signedIn: verified };
}

async function signIn(owner: Pick<Owner, "email" | "password">, signedQuery?: string) {
  const response = await post("/api/auth/sign-in/email", { email: owner.email, password: owner.password, ...(signedQuery ? { oauth_query: signedQuery } : {}) }, { accept: "application/json" });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

async function registerClient(options: { redirectUris?: string[]; scope?: string; name?: string } = {}) {
  const response = await post("/api/auth/oauth2/register", {
    client_name: options.name ?? "Claude", redirect_uris: options.redirectUris ?? [redirectUri], token_endpoint_auth_method: "none",
    ...(options.scope ? { scope: options.scope } : {}),
  }, { "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 250) + 1}` });
  const body = await response.json();
  if (typeof body.client_id === "string") clientIds.push(body.client_id);
  return { response, body, clientId: body.client_id as string };
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function authorizeParameters(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: "orders:read offline_access", code_challenge: challenge,
    code_challenge_method: "S256", state: "state-1", resource, ...extra,
  });
}

type Step = Readonly<{ kind: "login" | "screen" | "redirect"; url: URL; signed: SignedAuthorizationRequest }>;
function stepOf(location: string | null): Step {
  if (!location) throw new Error("Expected a redirect");
  const url = new URL(location, baseUrl);
  const kind = url.pathname === "/assistants/authorize" ? "screen" : url.pathname === "/login" ? "login" : "redirect";
  return { kind, url, signed: url.search.slice(1) as SignedAuthorizationRequest };
}

/** A navigation answers 302 with a Location; any other fetch gets the same redirect as `{ redirect: true, url }`. */
async function stepOfResponse(response: Response): Promise<Step> {
  const location = response.headers.get("location");
  if (location) return stepOf(location);
  const body = await response.json().catch(() => null);
  if (body && typeof body.url === "string") return stepOf(body.url);
  throw new Error(`Expected a redirect, got ${response.status}`);
}

async function authorizeGet(clientId: string, cookie: string, extra: Record<string, string> = {}, challenge = pkce().challenge) {
  const response = await fetch(`${api}/api/auth/oauth2/authorize?${authorizeParameters(clientId, challenge, extra)}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  return stepOfResponse(response);
}

const accessFor = (owner: Owner) => ({ companyId: owner.companyId, userId: owner.userId });
const requestOf = (cookie: string) => new Request(`${baseUrl}/assistants/authorize`, { method: "POST", headers: { cookie } });
const connectionsOf = (owner: Owner) => withTenantIsolation(owner.companyId, async () => await prisma.assistantConnection.findMany());

/** Walks signed-in authorize → screen → allow → redirect carrying the code. */
async function connect(owner: Owner, clientId: string, challenge: string) {
  const screen = await authorizeGet(clientId, owner.cookie, {}, challenge);
  expect(screen.kind).toBe("screen");
  const allowed = await authorizationFor(requestOf(owner.cookie)).allow(screen.signed, accessFor(owner));
  if (!allowed.success) throw new Error(`Allow failed: ${allowed.error.code}`);
  return allowed.data;
}

const exchange = (clientId: string, code: string, verifier: string) => fetch(`${api}/api/auth/oauth2/token`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource }),
});
const refresh = (clientId: string, refreshToken: string) => fetch(`${api}/api/auth/oauth2/token`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, resource }),
});
const codeOf = (redirect: string) => new URL(redirect).searchParams.get("code") ?? "";

afterAll(async () => {
  for (const id of companyIds) await withTenantIsolation(id, async () => {
    await prisma.assistantConnection.deleteMany({});
    await prisma.company.deleteMany({ where: { id } });
  });
  await systemPrisma.oauthClient.deleteMany({ where: { clientId: { in: clientIds } } });
  await systemPrisma.user.deleteMany({ where: { id: { in: userIds } } });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await systemPrisma.$disconnect();
});

test("a registered public client completes authorization code with PKCE and gets a token for the MCP resource", async () => {
  const owner = await createOwner();
  const { clientId } = await registerClient();
  const { verifier, challenge } = pkce();
  const redirect = await connect(owner, clientId, challenge);
  expect(redirect.startsWith(`${redirectUri}?`)).toBe(true);
  expect(new URL(redirect).searchParams.get("state")).toBe("state-1");
  const token = await exchange(clientId, codeOf(redirect), verifier);
  expect(token.status).toBe(200);
  const body = await token.json();
  expect(body.refresh_token).toEqual(expect.any(String));
  const claims = JSON.parse(Buffer.from(String(body.access_token).split(".")[1], "base64url").toString());
  expect(claims).toMatchObject({ sub: owner.userId, azp: clientId, iss: baseUrl, aud: resource });
});

test("allowing a first-time request returns the agent redirect with a code on the first tap and lists the connection", async () => {
  const owner = await createOwner();
  const { clientId } = await registerClient({ name: "Claude" });
  const redirect = await connect(owner, clientId, pkce().challenge);
  expect(codeOf(redirect)).not.toBe("");
  const rows = await connectionsOf(owner);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ agentName: "Claude", returnKind: "web", returnDomain: "claude.ai", scopes: ["orders:read"], lastUsedAt: null, oauthClientId: clientId });
});

test("registration refuses a custom scheme redirect URI and accepts a loopback one", async () => {
  const custom = await registerClient({ redirectUris: ["evil://chatgpt.com/cb"] });
  expect(custom.response.status).toBe(400);
  expect(custom.body.error).toBe("invalid_redirect_uri");
  const loopback = await registerClient({ redirectUris: ["http://localhost:6274/oauth/callback"] });
  expect(loopback.response.status).toBe(201);
});

test("registration with openid profile email scopes succeeds and the connection holds orders and offline access", async () => {
  const owner = await createOwner();
  const { response, clientId } = await registerClient({ scope: "openid profile email" });
  expect(response.status).toBe(201);
  const screen = await authorizeGet(clientId, owner.cookie, { scope: "openid profile email" }, pkce().challenge);
  expect(screen.kind).toBe("screen");
  expect(new URLSearchParams(screen.signed).get("scope")).toBe("orders:read offline_access");
  expect((await authorizationFor(requestOf(owner.cookie)).allow(screen.signed, accessFor(owner))).success).toBe(true);
  expect((await systemPrisma.oauthConsent.findFirstOrThrow({ where: { clientId, userId: owner.userId } })).scopes.toSorted()).toEqual(["offline_access", "orders:read"]);
  expect((await connectionsOf(owner))[0].scopes).toEqual(["orders:read"]);
});

test("an authorization asking for openid or only offline_access is normalized to orders and offline access", async () => {
  const owner = await createOwner();
  const { clientId } = await registerClient();
  for (const scope of ["openid", "offline_access", "openid profile email offline_access"]) {
    const screen = await authorizeGet(clientId, owner.cookie, { scope }, pkce().challenge);
    expect(screen.kind, scope).toBe("screen");
    expect(new URLSearchParams(screen.signed).get("scope"), scope).toBe("orders:read offline_access");
  }
});

test("a stored consent without an active connection still shows the authorization screen", async () => {
  const owner = await createOwner();
  const { clientId } = await registerClient();
  await connect(owner, clientId, pkce().challenge);
  // The row is gone (save failure, disconnect whose revocation failed) but the plugin still holds the consent.
  await withTenantIsolation(owner.companyId, async () => await prisma.assistantConnection.deleteMany({}));
  expect(await systemPrisma.oauthConsent.count({ where: { clientId, userId: owner.userId } })).toBe(1);
  expect((await authorizeGet(clientId, owner.cookie)).kind).toBe("screen");
  expect(await systemPrisma.oauthConsent.count({ where: { clientId, userId: owner.userId } })).toBe(0);
});

test("a stored consent without an active connection still shows the authorization screen after signing in from the agent request", async () => {
  const owner = await createOwner();
  const { clientId } = await registerClient();
  await connect(owner, clientId, pkce().challenge);
  await withTenantIsolation(owner.companyId, async () => await prisma.assistantConnection.deleteMany({}));
  const signedOut = await authorizeGet(clientId, "");
  expect(signedOut.kind).toBe("login");
  const response = await post("/api/auth/sign-in/email", { email: owner.email, password, oauth_query: signedOut.signed }, { accept: "application/json" });
  expect(response.status).toBe(200);
  const next = stepOf((await response.json()).url);
  expect(next.kind).toBe("screen");
  expect(next.url.searchParams.get("code")).toBeNull();
});

test("an active connection lets the same client back in without the screen and keeps the row as it is", async () => {
  const owner = await createOwner();
  const { clientId } = await registerClient();
  await connect(owner, clientId, pkce().challenge);
  const [before] = await connectionsOf(owner);
  const again = await authorizeGet(clientId, owner.cookie);
  expect(again.kind).toBe("redirect");
  expect(again.url.searchParams.get("code")).not.toBeNull();
  expect(await connectionsOf(owner)).toEqual([before]);
});

test("a GET authorization drops a stale consent and shows the authorization screen", async () => {
  const owner = await createOwner();
  const { clientId } = await registerClient();
  await connect(owner, clientId, pkce().challenge);
  await withTenantIsolation(owner.companyId, async () => await prisma.assistantConnection.deleteMany({}));
  expect((await authorizeGet(clientId, owner.cookie)).kind).toBe("screen");
});

test("a form POST authorization drops a stale consent, shows the authorization screen and is normalized to orders and offline access", async () => {
  const owner = await createOwner();
  const { clientId } = await registerClient();
  await connect(owner, clientId, pkce().challenge);
  await withTenantIsolation(owner.companyId, async () => await prisma.assistantConnection.deleteMany({}));
  const response = await fetch(`${api}/api/auth/oauth2/authorize`, {
    method: "POST", headers: { cookie: owner.cookie, origin: baseUrl, "content-type": "application/x-www-form-urlencoded" },
    body: authorizeParameters(clientId, pkce().challenge, { scope: "openid" }), redirect: "manual",
  });
  const step = await stepOfResponse(response);
  expect(step.kind).toBe("screen");
  expect(new URLSearchParams(step.signed).get("scope")).toBe("orders:read offline_access");
});

test("authorize refuses an https redirect URI not registered for the client, also when a consent and an active connection exist", async () => {
  const owner = await createOwner();
  const { clientId } = await registerClient();
  await connect(owner, clientId, pkce().challenge);
  const response = await fetch(`${api}/api/auth/oauth2/authorize?${authorizeParameters(clientId, pkce().challenge, { redirect_uri: "https://other.example/callback" })}`, { headers: { cookie: owner.cookie }, redirect: "manual" });
  expect(`${response.headers.get("location") ?? ""} ${await response.text()}`).toContain("invalid_redirect");
  expect(response.headers.get("location") ?? "").not.toContain("other.example");
});

test("denying a request returns the access denied redirect through the consent endpoint under the marker", async () => {
  const owner = await createOwner();
  const { clientId } = await registerClient();
  const screen = await authorizeGet(clientId, owner.cookie);
  const denied = await authorizationFor(requestOf(owner.cookie)).deny(screen.signed, accessFor(owner));
  expect(denied.success && new URL(denied.data).searchParams.get("error")).toBe("access_denied");
  expect(await connectionsOf(owner)).toEqual([]);
});

test("a consent call without the Yoyos marker is refused", async () => {
  const owner = await createOwner();
  const { clientId } = await registerClient();
  const screen = await authorizeGet(clientId, owner.cookie);
  for (const accept of [true, false]) {
    const response = await post("/api/auth/oauth2/consent", { accept, oauth_query: screen.signed }, { cookie: owner.cookie });
    expect(response.status).toBe(403);
  }
  expect(await connectionsOf(owner)).toEqual([]);
  expect(await systemPrisma.oauthConsent.count({ where: { clientId, userId: owner.userId } })).toBe(0);
});

test("the consent endpoint refuses a direct browser call", async () => {
  const owner = await createOwner();
  const { clientId } = await registerClient();
  const screen = await authorizeGet(clientId, owner.cookie);
  const response = await post("/api/auth/oauth2/consent", { accept: true, oauth_query: screen.signed }, { cookie: owner.cookie, "sec-fetch-mode": "cors", accept: "application/json" });
  expect(response.status).toBe(403);
});

test("two concurrent first allows keep one connection and both answer the agent redirect", async () => {
  const owner = await createOwner();
  const { clientId } = await registerClient();
  const screen = await authorizeGet(clientId, owner.cookie);
  const results = await Promise.all([1, 2].map(() => authorizationFor(requestOf(owner.cookie)).allow(screen.signed, accessFor(owner))));
  for (const result of results) expect(result.success && result.data.startsWith(`${redirectUri}?`)).toBe(true);
  expect(await connectionsOf(owner)).toHaveLength(1);
});

test("a request that expires between reading and accepting answers expired", async () => {
  const owner = await createOwner();
  const { clientId } = await registerClient();
  const screen = await authorizeGet(clientId, owner.cookie);
  const expired = screen.signed.replace(/exp=\d+/, `exp=${Math.floor(Date.now() / 1000) - 5}`);
  const grant = createOAuthGrant(requestOf(owner.cookie), () => new Date());
  expect(await grant.acceptRequest(expired as SignedAuthorizationRequest, { oauthClientId: clientId as OAuthClientId, userId: owner.userId }))
    .toMatchObject({ success: false, error: { code: "REQUEST_EXPIRED" } });
  expect(await grant.readRequest(expired as SignedAuthorizationRequest, new Date())).toMatchObject({ success: false, error: { code: "REQUEST_EXPIRED" } });
  const tampered = screen.signed.replace(/client_id=[^&]+/, "client_id=other");
  expect(await grant.readRequest(tampered as SignedAuthorizationRequest, new Date())).toMatchObject({ success: false, error: { code: "REQUEST_INVALID" } });
  expect(await connectionsOf(owner)).toEqual([]);
});

test("an unverified account signing in from an authorization request gets the email-not-verified answer and no code", async () => {
  const unverified = await createOwner({ verified: false });
  const { clientId } = await registerClient();
  const signedOut = await authorizeGet(clientId, "");
  const response = await post("/api/auth/sign-in/email", { email: unverified.email, password, oauth_query: signedOut.signed }, { accept: "application/json" });
  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe("EMAIL_NOT_VERIFIED");
  expect(response.headers.get("set-cookie")).toBeNull();
});

test("switching account keeps the signed request", async () => {
  const first = await createOwner();
  const second = await createOwner();
  const { clientId } = await registerClient();
  const signedOut = await authorizeGet(clientId, "");
  expect(signedOut.kind).toBe("login");
  // The first account signs in, then signs out (Usar otra cuenta); the same signed request still continues for the second.
  await signIn(first, signedOut.signed);
  const response = await post("/api/auth/sign-in/email", { email: second.email, password, oauth_query: signedOut.signed }, { accept: "application/json" });
  expect(response.status).toBe(200);
  expect(stepOf((await response.json()).url).kind).toBe("screen");
});

test("reusing a rotated refresh token within ten seconds keeps the grant", async () => {
  const owner = await createOwner();
  const { clientId } = await registerClient();
  const { verifier, challenge } = pkce();
  const tokens = await (await exchange(clientId, codeOf(await connect(owner, clientId, challenge)), verifier)).json();
  const first = await refresh(clientId, tokens.refresh_token);
  expect(first.status).toBe(200);
  const reused = await refresh(clientId, tokens.refresh_token);
  expect(reused.status).toBe(200);
  const rotated = (await first.json()).refresh_token;
  expect((await refresh(clientId, rotated)).status).toBe(200);
});

test("refresh keeps working after the owner signs out", async () => {
  const owner = await createOwner();
  const { clientId } = await registerClient();
  const { verifier, challenge } = pkce();
  const tokens = await (await exchange(clientId, codeOf(await connect(owner, clientId, challenge)), verifier)).json();
  expect((await post("/api/auth/sign-out", {}, { cookie: owner.cookie })).status).toBe(200);
  expect((await refresh(clientId, tokens.refresh_token)).status).toBe(200);
});

test("refresh fails after disconnect", async () => {
  const owner = await createOwner();
  const { clientId } = await registerClient();
  const { verifier, challenge } = pkce();
  const tokens = await (await exchange(clientId, codeOf(await connect(owner, clientId, challenge)), verifier)).json();
  const [connection] = await connectionsOf(owner);
  const ended = await connectionRepository.deleteConnection(connection.id as AssistantConnectionId, owner.companyId);
  expect(ended.success && ended.data).not.toBeNull();
  if (ended.success && ended.data) expect((await revokeEndedConnectionGrant(ended.data)).success).toBe(true);
  expect((await refresh(clientId, tokens.refresh_token)).status).toBe(400);
  expect((await authorizeGet(clientId, owner.cookie)).kind).toBe("screen");
});

test("the unused plugin endpoints such as create-client answer 404", async () => {
  const owner = await createOwner();
  expect((await post("/api/auth/oauth2/create-client", { client_name: "Evil", redirect_uris: ["https://evil.example/cb"] }, { cookie: owner.cookie })).status).toBe(404);
});

test("a password reset ends the connections that account authorized and not the others, and revokes the grant", async () => {
  const rosa = await createOwner();
  const luis = await createOwner();
  // Luis joins Rosa's store.
  await systemPrisma.user.update({ where: { id: luis.userId }, data: { companyId: rosa.companyId } });
  const { clientId } = await registerClient();
  const { verifier, challenge } = pkce();
  const tokens = await (await exchange(clientId, codeOf(await connect(rosa, clientId, challenge)), verifier)).json();
  const luisScreen = await authorizeGet(clientId, luis.cookie);
  expect((await authorizationFor(requestOf(luis.cookie)).allow(luisScreen.signed, accessFor({ ...luis, companyId: rosa.companyId }))).success).toBe(true);
  expect(await connectionsOf(rosa)).toHaveLength(2);
  const authorizedAt = (await connectionsOf(rosa)).map((row) => row.authorizedAt).sort((a, b) => a.getTime() - b.getTime())[0];

  const token = randomUUID();
  await systemPrisma.verification.create({ data: { id: randomUUID(), identifier: `reset-password:${token}`, value: rosa.userId, expiresAt: new Date(Date.now() + 60_000) } });
  expect((await post("/api/auth/reset-password", { newPassword: "a-new-password-456", token })).status).toBe(200);

  // Better Auth stamps the credential account on a reset: the guarantee rule reads that date.
  const credential = await systemPrisma.account.findFirstOrThrow({ where: { userId: rosa.userId, providerId: "credential" } });
  expect(credential.updatedAt.getTime()).toBeGreaterThan(authorizedAt.getTime());
  expect((await connectionsOf(rosa)).map((row) => row.authorizedByUserId)).toEqual([luis.userId]);
  expect((await refresh(clientId, tokens.refresh_token)).status).toBe(400);
});
