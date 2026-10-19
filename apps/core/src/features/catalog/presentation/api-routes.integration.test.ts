import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { app } from "@core/src/app";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Catalog settings server did not bind");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const fixtures: { companyId: string; userId: string }[] = [];

async function call(cookie?: string, body?: unknown) {
  return fetch(`${base}/api/catalog/settings`, { method: body === undefined ? "GET" : "PUT",
    headers: { origin, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function seller() {
  const companyId = randomUUID();
  const email = `catalog-settings-${randomUUID()}@example.test`;
  const password = "test-password-123";
  await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name: "Catalog", country: "PE" } }));
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ name: "Seller", email, password }) });
  expect(signup.status).toBe(200);
  const userId = (await signup.json()).user.id as string;
  fixtures.push({ companyId, userId });
  await systemPrisma.user.update({ where: { id: userId }, data: { emailVerified: true, companyId } });
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email, password }) });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Catalog settings test session missing");
  return { companyId, cookie };
}

afterAll(async () => {
  for (const { companyId, userId } of fixtures.reverse()) await withTenantIsolation(companyId, async () => {
    await systemPrisma.user.delete({ where: { id: userId } });
    await prisma.company.delete({ where: { id: companyId } });
  });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("settings API publishes, hides and keeps the same url", async () => {
  expect((await call()).status).toBe(401);
  const first = await seller();
  const second = await seller();
  const url = new URL(`/catalogo/${first.companyId}`, origin).toString();
  const initial = await call(first.cookie);
  expect(initial.headers.get("cache-control")).toBe("no-store");
  expect(await initial.json()).toEqual({ published: false, url });

  const published = await call(first.cookie, { published: true });
  expect(published.status).toBe(200);
  expect(await published.json()).toEqual({ published: true, url });
  expect(await (await call(first.cookie, { published: true })).json()).toEqual({ published: true, url });
  expect(await (await call(second.cookie)).json()).toEqual({ published: false, url: new URL(`/catalogo/${second.companyId}`, origin).toString() });

  expect(await (await call(first.cookie, { published: false })).json()).toEqual({ published: false, url });
  expect(await (await call(first.cookie, { published: true })).json()).toEqual({ published: true, url });
  expect(await (await call(first.cookie)).json()).toEqual({ published: true, url });

  const invalid = await call(first.cookie, { published: "yes" });
  expect(invalid.status).toBe(400);
  expect((await invalid.json()).code).toBe("INVALID_CATALOG_SETTINGS");
});
