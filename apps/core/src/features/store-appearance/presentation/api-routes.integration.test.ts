import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { storeAppearanceResponseSchema } from "@shared/contracts/store-appearance";

// The images module reads R2_* at import time, so the URL base is set before the app is imported.
process.env.R2_ENDPOINT ??= "http://127.0.0.1:9";
process.env.R2_BUCKET ??= "test-images";
process.env.R2_ACCESS_KEY_ID ??= "test";
process.env.R2_SECRET_ACCESS_KEY ??= "test";
process.env.R2_PUBLIC_BASE_URL = "http://127.0.0.1:9/test-images";
const { app } = await import("@core/src/app");
const { prisma, systemPrisma, withTenantIsolation } = await import("@core/src/shared/infrastructure/persistance");

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Store appearance server did not bind");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const fixtures: { companyId: string; userId: string }[] = [];
type Seller = Awaited<ReturnType<typeof seller>>;

async function call(auth: { cookie?: string; bearer?: string }, body?: unknown, method = body === undefined ? "GET" : "PUT", raw?: string) {
  return fetch(`${base}/api/store-appearance`, { method, headers: { origin,
    ...(auth.cookie ? { cookie: auth.cookie } : {}), ...(auth.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}),
    ...(body === undefined && raw === undefined ? {} : { "content-type": "application/json" }) },
  ...(raw !== undefined ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function seller(withCompany = true) {
  const companyId = randomUUID();
  const email = `store-appearance-${randomUUID()}@example.test`;
  const password = "test-password-123";
  if (withCompany) await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name: "Appearance", country: "PE" } }));
  const signup = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ name: "Seller", email, password }) });
  expect(signup.status).toBe(200);
  const userId = (await signup.json()).user.id as string;
  if (withCompany) fixtures.push({ companyId, userId });
  await systemPrisma.user.update({ where: { id: userId }, data: { emailVerified: true, companyId: withCompany ? companyId : null } });
  const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email, password }) });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Store appearance test session missing");
  const token = await fetch(`${base}/api/auth/token`, { headers: { origin, cookie } });
  const bearer = (await token.json()).token as string;
  return { companyId, userId, cookie, bearer };
}

async function image(s: Seller) {
  const id = randomUUID();
  await withTenantIsolation(s.companyId, async () => await prisma.image.create({ data: { id, storageKey: `images/${id}.png` } }));
  return id;
}

async function storedRows(s: Seller) {
  return await withTenantIsolation(s.companyId, async () => await prisma.companyCheckoutAppearance.findMany());
}

afterAll(async () => {
  for (const { companyId, userId } of fixtures.reverse()) await withTenantIsolation(companyId, async () => {
    await prisma.companyCheckoutAppearance.deleteMany();
    await prisma.image.deleteMany();
    await systemPrisma.user.delete({ where: { id: userId } });
    await prisma.company.delete({ where: { id: companyId } });
  });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("GET store appearance returns the saved theme and logo of the token's company only", async () => {
  const a = await seller();
  const b = await seller();
  const logoId = await image(a);
  expect((await call({ bearer: a.bearer }, { theme: "suave", logoImageId: logoId })).status).toBe(200);
  const own = await call({ bearer: a.bearer });
  expect(own.headers.get("cache-control")).toBe("no-store");
  const body = storeAppearanceResponseSchema.parse(await own.json());
  expect(body).toEqual({ kind: "readable", appearance: { theme: "suave", logo: { id: logoId, url: `http://127.0.0.1:9/test-images/images/${logoId}.png` } } });
  expect(await (await call({ bearer: b.bearer })).json()).toEqual({ kind: "readable", appearance: { theme: "classic", logo: null } });
});

test("GET store appearance returns Clásico without logo for a company that never saved one", async () => {
  const s = await seller();
  const response = await call({ cookie: s.cookie });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ kind: "readable", appearance: { theme: "classic", logo: null } });
});

test("PUT store appearance publishes theme and logo together and returns them with the logo url", async () => {
  const s = await seller();
  const logoId = await image(s);
  const response = await call({ bearer: s.bearer }, { theme: "suave", logoImageId: logoId });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(storeAppearanceResponseSchema.parse(await response.json())).toEqual({ kind: "readable",
    appearance: { theme: "suave", logo: { id: logoId, url: `http://127.0.0.1:9/test-images/images/${logoId}.png` } } });
  const rows = await storedRows(s);
  expect(rows.map((row) => [row.theme, row.logoImageId])).toEqual([["suave", logoId]]);
});

test("PUT store appearance rejects a logo of another company with 422 INVALID_IMAGE and keeps the published appearance", async () => {
  const a = await seller();
  const b = await seller();
  const own = await image(a);
  await call({ bearer: a.bearer }, { theme: "boutique", logoImageId: own });
  const foreign = await image(b);
  const response = await call({ bearer: a.bearer }, { theme: "suave", logoImageId: foreign });
  expect(response.status).toBe(422);
  expect((await response.json()).code).toBe("INVALID_IMAGE");
  expect((await storedRows(a)).map((row) => [row.theme, row.logoImageId])).toEqual([["boutique", own]]);
});

test("PUT store appearance rejects an unknown theme or an unknown key with 400 INVALID_STORE_APPEARANCE", async () => {
  const s = await seller();
  for (const body of [{ theme: "rojo", logoImageId: null }, { theme: "suave", logoImageId: null, color: "#fff" }]) {
    const response = await call({ bearer: s.bearer }, body);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_STORE_APPEARANCE");
  }
  expect(await storedRows(s)).toEqual([]);
});

test("PUT store appearance answers malformed JSON with 400 INVALID_INPUT", async () => {
  const s = await seller();
  const response = await call({ bearer: s.bearer }, undefined, "PUT", "{ not json");
  expect(response.status).toBe(400);
  expect((await response.json()).code).toBe("INVALID_INPUT");
  expect(await storedRows(s)).toEqual([]);
});

test("store appearance API requires a session or bearer token with an active company", async () => {
  expect((await call({})).status).toBe(401);
  expect((await call({}, { theme: "suave", logoImageId: null })).status).toBe(401);
  const withoutCompany = await seller(false);
  expect((await call({ bearer: withoutCompany.bearer })).status).toBe(403);
  const s = await seller();
  expect((await call({ cookie: s.cookie })).status).toBe(200);
  expect((await call({ bearer: s.bearer })).status).toBe(200);
});

test("repeating the same PUT leaves one row with the same values", async () => {
  const s = await seller();
  const logoId = await image(s);
  const body = { theme: "noche", logoImageId: logoId };
  const first = await (await call({ bearer: s.bearer }, body)).json();
  const second = await (await call({ bearer: s.bearer }, body)).json();
  expect(second).toEqual(first);
  expect((await storedRows(s)).map((row) => [row.theme, row.logoImageId])).toEqual([["noche", logoId]]);
});

test("saving the appearance never changes catalog publication and publishing never changes the appearance", async () => {
  const s = await seller();
  const published = async () => (await withTenantIsolation(s.companyId, async () => await prisma.company.findUniqueOrThrow({ where: { id: s.companyId } }))).catalogPublished;
  expect(await published()).toBe(false);
  await call({ bearer: s.bearer }, { theme: "antojo", logoImageId: null });
  expect(await published()).toBe(false);
  const publish = await fetch(`${base}/api/catalog/settings`, { method: "PUT", headers: { origin, authorization: `Bearer ${s.bearer}`, "content-type": "application/json" },
    body: JSON.stringify({ published: true }) });
  expect(publish.status).toBe(200);
  expect(await published()).toBe(true);
  expect(await (await call({ bearer: s.bearer })).json()).toEqual({ kind: "readable", appearance: { theme: "antojo", logo: null } });
  await call({ bearer: s.bearer }, { theme: "noche", logoImageId: null });
  expect(await published()).toBe(true);
});
