import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { request as httpRequest, type Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { SignJWT, generateKeyPair } from "jose";
import { signJWT } from "better-auth/plugins";
import { ok } from "@shared/functional";
import { app } from "@core/src/app";
import { auth, authIssuer, mcpResourceUrl } from "@core/src/shared/infrastructure/auth";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { userRepository } from "@core/src/features/users/infrastructure/user-repository";
import { createAssistantMcpRoutes } from "@core/src/composition/assistant-server";
import type { ToolModule } from "@core/src/features/assistants/presentation/tool-module";

const suffix = randomUUID();
const clientId = `mcp-client-${suffix}`;
const day = 24 * 60 * 60 * 1000;

type Store = { companyId: string; userId: string; connectionId: string };
const rosa: Store = { companyId: randomUUID(), userId: `rosa-${suffix}`, connectionId: randomUUID() };
const luis: Store = { companyId: randomUUID(), userId: `luis-${suffix}`, connectionId: randomUUID() };

const fixtureModule: ToolModule = {
  scope: "orders:read", access: "read", instructions: "Las herramientas de prueba solo leen.", readFailureMessage: "No pudimos leer los datos de prueba.",
  tools: [{
    name: "consulta_de_prueba", title: "Consulta de prueba", description: "Devuelve un total fijo para probar el servidor.",
    inputSchema: z.strictObject({ texto: z.string().max(20).optional() }),
    outputSchema: z.strictObject({ total: z.number() }),
    sampleOutputs: [{ total: 1 }],
    run: async () => ok({ output: { total: 1 }, empty: false }),
  }],
};

const servers: Server[] = [];
async function serve(build: (api: express.Express) => void): Promise<string> {
  const api = express();
  build(api);
  const server = api.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const serveFixture = () => serve((api) => { api.use(createAssistantMcpRoutes([fixtureModule])); });

async function mint(subject: string, claims: Record<string, unknown> = {}, header: Record<string, unknown> = { typ: "at+jwt" }) {
  const now = Math.floor(Date.now() / 1000);
  return signJWT({ context: await auth.$context } as never, {
    options: {}, header,
    payload: {
      sub: subject, aud: mcpResourceUrl, client_id: clientId, azp: clientId, scope: "orders:read products:read offline_access", iss: authIssuer,
      iat: now, exp: now + 3600, jti: randomUUID(), ...claims,
    },
  } as never);
}

const rpc = (method: string, params: unknown = {}) => ({ jsonrpc: "2.0", id: 1, method, params });
async function post(base: string, token: string | null, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/mcp`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: JSON.stringify(body),
  });
}
const callTool = (base: string, token: string | null, args: unknown = {}) => post(base, token, rpc("tools/call", { name: "consulta_de_prueba", arguments: args }));
// 2025-era clients that accept event streams get the answer as one SSE message.
async function readRpc(response: Response) {
  const text = await response.text();
  const data = response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data:"))?.slice(5) ?? "" : text;
  return JSON.parse(data);
}
const callResult = async (response: Response) => (await readRpc(response)).result as { isError?: boolean; structuredContent?: Record<string, unknown>; content: { text: string }[] };

async function createStore(store: Store, name: string) {
  await withTenantIsolation(store.companyId, async () => {
    await prisma.company.create({ data: { id: store.companyId, name, country: "PE" } });
    await systemPrisma.user.create({ data: { id: store.userId, name, email: `${store.userId}@example.test`, emailVerified: true, companyId: store.companyId } });
  });
}
async function connect(store: Store, data: Record<string, unknown> = {}) {
  await withTenantIsolation(store.companyId, async () => await prisma.assistantConnection.create({ data: {
    id: store.connectionId, authorizedByUserId: store.userId, oauthClientId: clientId, agentName: "Claude", returnKind: "web", returnDomain: "claude.ai",
    scopes: ["orders:read", "products:read"], authorizedAt: new Date(Date.now() - 10 * day), ...data,
  } }));
}
// Prisma promises are lazy: await inside the tenant callback so the query runs with the company context.
const connectionRows = (store: Store) => withTenantIsolation(store.companyId, async () => await prisma.assistantConnection.findMany());

let appBase: string;
beforeAll(async () => {
  appBase = await serve((api) => { api.use(app); });
  await createStore(rosa, "Tienda Rosa");
  await createStore(luis, "Tienda Luis");
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of [rosa, luis]) await withTenantIsolation(store.companyId, async () => {
    await prisma.assistantConnection.deleteMany();
  });
  await systemPrisma.account.deleteMany({ where: { userId: { in: [rosa.userId, luis.userId] } } });
});
afterAll(async () => {
  for (const store of [rosa, luis]) {
    await withTenantIsolation(store.companyId, async () => await prisma.assistantConnection.deleteMany());
    await systemPrisma.user.deleteMany({ where: { id: store.userId } });
    await withTenantIsolation(store.companyId, async () => await prisma.company.deleteMany({ where: { id: store.companyId } }));
  }
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await systemPrisma.$disconnect();
});

describe("authentication", () => {
  test("answers 401 with the protected resource metadata URL when no token is sent", async () => {
    const response = await post(appBase, null, rpc("tools/list"));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(`resource_metadata="${authIssuer}/.well-known/oauth-protected-resource/mcp"`);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  test("refuses a mobile JWT, a token for another audience and a token of another type", async () => {
    await connect(rosa);
    const base = await serveFixture();
    const mobile = await mint(rosa.userId, { aud: "yoyos-core-api", azp: undefined, client_id: undefined, scope: undefined, sid: "session-1" }, {});
    expect((await callTool(base, mobile)).status).toBe(401);
    expect((await callTool(base, await mint(rosa.userId, { aud: "https://other.example/mcp" }))).status).toBe(401);
    expect((await callTool(base, await mint(rosa.userId, {}, { typ: "JWT" }))).status).toBe(401);
    expect((await callTool(base, await mint(rosa.userId, { exp: Math.floor(Date.now() / 1000) - 10, iat: Math.floor(Date.now() / 1000) - 3610 }))).status).toBe(401);
    expect((await callTool(base, "not-a-jwt")).status).toBe(401);
    expect((await callTool(base, await mint(rosa.userId))).status).toBe(200);
  });

  test("refuses an MCP token on /api", async () => {
    await connect(rosa);
    const response = await fetch(`${appBase}/api/me`, { headers: { authorization: `Bearer ${await mint(rosa.userId)}` } });
    expect(response.status).toBe(401);
  });

  test("ignores the session cookie on /mcp", async () => {
    await connect(rosa);
    const base = await serveFixture();
    // A real signed-in session of the store's owner is still no credential for /mcp.
    const email = `${rosa.userId}-cookie@example.test`;
    const password = "mcp-cookie-password-123";
    const headers = { origin: authIssuer, "content-type": "application/json" };
    expect((await fetch(`${appBase}/api/auth/sign-up/email`, { method: "POST", headers, body: JSON.stringify({ name: "Cookie", email, password }) })).status).toBe(200);
    await systemPrisma.user.update({ where: { email }, data: { emailVerified: true } });
    const signedIn = await fetch(`${appBase}/api/auth/sign-in/email`, { method: "POST", headers, body: JSON.stringify({ email, password }) });
    const cookie = signedIn.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).not.toBe("");
    try {
      const response = await post(base, null, rpc("tools/list"), { cookie });
      expect(response.status).toBe(401);
    } finally {
      await systemPrisma.user.deleteMany({ where: { email } });
    }
  });

  test("answers 401 when the connection row is gone or unused for 90 days", async () => {
    const base = await serveFixture();
    const token = await mint(rosa.userId);
    expect((await callTool(base, token)).status).toBe(401);
    await connect(rosa, { lastUsedAt: new Date(Date.now() - 90 * day) });
    expect((await callTool(base, token)).status).toBe(401);
    expect(await connectionRows(rosa)).toEqual([]);
  });

  test("answers 401 and ends a connection authorized before the account's last password change", async () => {
    const base = await serveFixture();
    await connect(rosa, { authorizedAt: new Date(Date.now() - 10 * day) });
    await systemPrisma.account.create({ data: { id: randomUUID(), accountId: rosa.userId, providerId: "credential", userId: rosa.userId, password: "hash", updatedAt: new Date(Date.now() - 2 * day) } });
    expect((await callTool(base, await mint(rosa.userId))).status).toBe(401);
    expect(await connectionRows(rosa)).toEqual([]);
  });

  test("a call with an ended connection creates or updates no connection row", async () => {
    const base = await serveFixture();
    expect((await callTool(base, await mint(rosa.userId))).status).toBe(401);
    expect((await callTool(base, await mint(luis.userId))).status).toBe(401);
    expect(await connectionRows(rosa)).toEqual([]);
    expect(await connectionRows(luis)).toEqual([]);
  });

  test("a token for a connection of another account of the store does not work", async () => {
    await connect(rosa);
    const base = await serveFixture();
    expect((await callTool(base, await mint(luis.userId))).status).toBe(401);
    expect((await callTool(base, await mint(rosa.userId, { azp: "other-client", client_id: "other-client" }))).status).toBe(401);
  });
});

describe("calls", () => {
  test("lists the tools of a connected store and answers a call with structured content, updating last use", async () => {
    await connect(rosa);
    const base = await serveFixture();
    const token = await mint(rosa.userId);
    const list = await readRpc(await post(base, token, rpc("tools/list")));
    expect(list.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["consulta_de_prueba"]);
    expect(list.result.tools[0].annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    const result = await callResult(await callTool(base, token));
    expect(result.structuredContent).toEqual({ total: 1 });
    expect((await connectionRows(rosa))[0].lastUsedAt).not.toBeNull();
  });

  test("refuses the 61st call of a store while another store keeps answering, with one log line per call", async () => {
    await connect(rosa);
    await connect(luis);
    const base = await serveFixture();
    const info = vi.spyOn(log, "info");
    const rosaToken = await mint(rosa.userId);
    for (let call = 1; call <= 60; call++) expect((await callResult(await callTool(base, rosaToken))).isError).toBeFalsy();
    const refused = await callResult(await callTool(base, rosaToken));
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/^Llegaste al límite de 60 consultas por minuto de tu tienda\. No reintentes antes de \d+ segundos\.$/);
    expect(refused.structuredContent).toBeUndefined();
    expect((await callResult(await callTool(base, await mint(luis.userId)))).isError).toBeFalsy();
    const called = info.mock.calls.map(([fields]) => fields as { event?: string; outcome?: string }).filter((fields) => fields.event === "assistant_tool_called");
    expect(called).toHaveLength(62);
    expect(called.filter((fields) => fields.outcome === "rate_limited")).toHaveLength(1);
    expect(called.filter((fields) => fields.outcome === "answered")).toHaveLength(61);
  });

  test("answers an invalid input as a tool error and keeps the connection", async () => {
    await connect(rosa);
    const base = await serveFixture();
    const result = await callResult(await callTool(base, await mint(rosa.userId), { texto: "x".repeat(21) }));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("texto");
  });

  test("one hundred tokens with unknown key ids cause at most one key set reload", async () => {
    const base = await serveFixture();
    const getJwks = vi.spyOn(auth.api, "getJwks");
    const { privateKey } = await generateKeyPair("EdDSA");
    const now = Math.floor(Date.now() / 1000);
    for (let attempt = 0; attempt < 100; attempt++) {
      const forged = await new SignJWT({ sub: rosa.userId, azp: clientId, client_id: clientId, scope: "orders:read", jti: randomUUID() })
        .setProtectedHeader({ alg: "EdDSA", typ: "at+jwt", kid: randomUUID() }).setIssuer(authIssuer).setAudience(mcpResourceUrl).setIssuedAt(now).setExpirationTime(now + 3600).sign(privateKey);
      expect((await callTool(base, forged)).status).toBe(401);
    }
    expect(getJwks.mock.calls.length).toBeLessThanOrEqual(1);
  });

  test("answers 429 past the request limit without reading the database", async () => {
    const base = await serveFixture();
    const info = vi.spyOn(log, "info");
    const token = await mint(rosa.userId);
    for (let request = 1; request <= 300; request++) expect((await post(base, token, rpc("ping"))).status).toBe(401);
    const readUser = vi.spyOn(userRepository, "findUser");
    const limited = await post(base, token, rpc("ping"));
    expect(readUser).not.toHaveBeenCalled();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    const reasons = info.mock.calls.map(([fields]) => fields as { event?: string; reason?: string }).filter((fields) => fields.event === "assistant_access_refused").map((fields) => fields.reason);
    expect(reasons.at(-1)).toBe("request_limit");
    expect(reasons.filter((reason) => reason === "no_connection")).toHaveLength(300);
  }, 60_000);
});

describe("transport", () => {
  test("answers 405 to GET and DELETE on /mcp", async () => {
    const base = await serveFixture();
    expect((await fetch(`${base}/mcp`, { method: "GET", headers: { accept: "text/event-stream" } })).status).toBe(405);
    expect((await fetch(`${base}/mcp`, { method: "DELETE" })).status).toBe(405);
  });

  test("rejects a body over 100 kB and malformed JSON", async () => {
    await connect(rosa);
    const base = await serveFixture();
    const token = await mint(rosa.userId);
    expect((await post(base, token, { ...rpc("tools/call"), padding: "x".repeat(101 * 1024) })).status).toBe(413);
    const malformed = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: "{not json" });
    expect(malformed.status).toBe(400);
  });

  test("serves the authorization server and protected resource metadata", async () => {
    const resource = await (await fetch(`${appBase}/.well-known/oauth-protected-resource/mcp`)).json();
    expect(resource).toMatchObject({ resource: mcpResourceUrl, authorization_servers: [authIssuer] });
    const server = await (await fetch(`${appBase}/.well-known/oauth-authorization-server`)).json();
    expect(server).toMatchObject({ issuer: authIssuer, code_challenge_methods_supported: ["S256"] });
  });

  test("does not serve /mcp or the well-known documents on a catalog brand host", async () => {
    const host = `tienda-${suffix.slice(0, 8)}.${new URL(process.env.CATALOG_BASE_URL ?? "http://localhost:3000").hostname}`;
    // fetch ignores a Host override, so the brand host goes through node:http.
    const statusOf = (method: string, path: string, hostHeader: string) => new Promise<number>((resolve, reject) => {
      const url = new URL(appBase);
      const request = httpRequest({ host: url.hostname, port: url.port, method, path, headers: { host: hostHeader, "content-type": "application/json" } }, (response) => { response.resume(); resolve(response.statusCode ?? 0); });
      request.on("error", reject);
      request.end(method === "POST" ? "{}" : undefined);
    });
    for (const [method, path] of [["GET", "/.well-known/oauth-authorization-server"], ["GET", "/.well-known/oauth-protected-resource/mcp"], ["POST", "/mcp"]]) {
      expect(await statusOf(method, path, host), path).toBe(404);
      expect(await statusOf(method, path, new URL(authIssuer).host), `${path} on the app host`).not.toBe(404);
    }
  });
});
