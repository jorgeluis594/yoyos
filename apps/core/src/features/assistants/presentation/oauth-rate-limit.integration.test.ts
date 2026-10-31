import { afterAll, expect, test, vi } from "vitest";

// Better Auth's limiter is on in production only; this test runs the real configuration with it on.
vi.hoisted(() => { process.env.AUTH_RATE_LIMIT_ENABLED = "true"; });
import { app } from "@core/src/app";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";

const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Integration server did not bind");
const api = `http://127.0.0.1:${address.port}`;
const clientIds: string[] = [];

async function register(forwardedFor: string) {
  const response = await fetch(`${api}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { origin: baseUrl, "content-type": "application/json", "x-forwarded-for": forwardedFor },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none" }),
  });
  const body = await response.json().catch(() => ({}));
  if (typeof body.client_id === "string") clientIds.push(body.client_id);
  return response.status;
}

afterAll(async () => {
  await systemPrisma.oauthClient.deleteMany({ where: { clientId: { in: clientIds } } });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await systemPrisma.$disconnect();
});

test("the registration rate limit refuses the sixth registration in a minute from one client IP", async () => {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 6; attempt++) statuses.push(await register("203.0.113.10"));
  expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
});

test("a client that prepends its own x-forwarded-for values stays in the bucket of the IP the proxy saw", async () => {
  // The proxy appends the address it saw: the leftmost values are whatever the client sent.
  expect(await register("198.51.100.1, 203.0.113.20")).toBe(201);
  for (let attempt = 0; attempt < 4; attempt++) expect(await register(`198.51.100.${attempt + 2}, 203.0.113.20`)).toBe(201);
  expect(await register("198.51.100.99, 203.0.113.20")).toBe(429);
  expect(await register("203.0.113.21")).toBe(201);
});
