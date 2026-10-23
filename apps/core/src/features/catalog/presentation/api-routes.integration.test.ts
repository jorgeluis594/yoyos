import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { apiErrorResponseSchema } from "@shared/contracts/registration";
import { catalogSettingsErrorSchema, subdomainErrorReason } from "@shared/contracts/catalog";
import { app } from "@core/src/app";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Catalog settings server did not bind");
const base = `http://127.0.0.1:${address.port}`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const fixtures: { companyId: string; userId: string }[] = [];

type Session = Awaited<ReturnType<typeof seller>>;

async function request(method: string, path: string, session?: Session, body?: unknown) {
  return fetch(`${base}/api/catalog${path}`, { method,
    headers: { origin, ...(session ? { cookie: session.cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const settings = (session?: Session, body?: unknown) => request(body === undefined ? "GET" : "PUT", "/settings", session, body);
const availability = (session: Session, value: string) => request("GET", `/subdomain-availability?value=${encodeURIComponent(value)}`, session);
const saveSubdomain = (session: Session, subdomain: unknown) => request("PUT", "/subdomain", session, { subdomain });
const unique = () => `s${randomUUID().replaceAll("-", "").slice(0, 20)}`;

async function seller(name = "Catalog") {
  const companyId = randomUUID();
  const email = `catalog-settings-${randomUUID()}@example.test`;
  const password = "test-password-123";
  await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name, country: "PE" } }));
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
  return { companyId, userId, cookie };
}

afterAll(async () => {
  for (const { companyId, userId } of fixtures.reverse()) await withTenantIsolation(companyId, async () => {
    await systemPrisma.user.delete({ where: { id: userId } });
    await prisma.company.delete({ where: { id: companyId } });
  });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

const domain = new URL(origin).host;

test("settings API returns subdomain, brand url, domain and suggestion", async () => {
  const tag = randomUUID().slice(0, 8);
  const cafe = await seller(`Café Fantasío ${tag}`);
  const suggestion = `cafe-fantasio-${tag}`;
  const initial = await settings(cafe);
  expect(initial.headers.get("cache-control")).toBe("no-store");
  expect(await initial.json()).toEqual({ published: false, subdomain: null, url: null, domain: domain, suggestion });

  const fantasio = await seller("Café Fantasío");
  const name = (await (await settings(fantasio)).json()).suggestion;
  expect(name === "cafe-fantasio" || name === null).toBe(true);
  const saved = await saveSubdomain(fantasio, "fantasio-store");
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ published: false, subdomain: "fantasio-store", url: `http://fantasio-store.${domain}/`, domain: domain, suggestion: null });
  expect(await (await settings(fantasio)).json()).toMatchObject({ subdomain: "fantasio-store", suggestion: null });
});

test("the suggestion is null when another company holds it", async () => {
  const holder = await seller();
  const owner = unique();
  await saveSubdomain(holder, owner);
  const other = await seller(owner);
  expect((await (await settings(other)).json()).suggestion).toBeNull();
});

test("availability API answers available, current, in_use, reserved and invalid with reason", async () => {
  const mine = await seller();
  const theirs = await seller();
  const taken = unique();
  expect((await saveSubdomain(theirs, taken)).status).toBe(200);
  const free = unique();
  expect(await (await availability(mine, "pay")).json()).toEqual({ status: "reserved" });
  expect(await (await availability(mine, "fa")).json()).toEqual({ status: "invalid", reason: "too_short" });
  expect(await (await availability(mine, "fantasio-")).json()).toEqual({ status: "invalid", reason: "hyphen_edge" });
  expect(await (await availability(mine, taken)).json()).toEqual({ status: "in_use", subdomain: taken });
  expect(await (await availability(mine, free.toUpperCase())).json()).toEqual({ status: "available", subdomain: free });
  expect(await (await availability(theirs, taken)).json()).toEqual({ status: "current", subdomain: taken });
  expect((await availability(mine, "fa")).headers.get("cache-control")).toBe("no-store");
  expect((await request("GET", "/subdomain-availability", mine)).status).toBe(400);
  expect((await request("GET", `/subdomain-availability?value=${"a".repeat(201)}`, mine)).status).toBe(400);
});

test("availability API answers 429 RATE_LIMITED after the per-user limit", async () => {
  const limited = await seller();
  const other = await seller();
  for (let call = 0; call < 60; call++) expect((await availability(limited, "fa")).status).toBe(200);
  const refused = await availability(limited, "fa");
  expect(refused.status).toBe(429);
  expect(await refused.json()).toMatchObject({ code: "RATE_LIMITED" });
  expect((await availability(other, "fa")).status).toBe(200);
});

test("subdomain API saves, repeats the same value as success, and answers 422 for invalid and reserved and 409 for taken", async () => {
  const mine = await seller();
  const theirs = await seller();
  const name = unique();
  const first = await saveSubdomain(mine, name);
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ subdomain: name, url: `http://${name}.${domain}/` });
  expect((await saveSubdomain(mine, name)).status).toBe(200);

  for (const value of ["pay", "fa", "-fantasio", "fan--tasio", "café"]) {
    const rejected = await saveSubdomain(theirs, value);
    expect(rejected.status, value).toBe(422);
  }
  expect(await (await settings(theirs)).json()).toMatchObject({ subdomain: null });
  expect((await saveSubdomain(theirs, name)).status).toBe(409);
  const replaced = unique();
  expect((await saveSubdomain(mine, replaced)).status).toBe(200);
  expect((await saveSubdomain(theirs, name)).status).toBe(200);
  expect((await request("PUT", "/subdomain", mine, { subdomain: 5 })).status).toBe(400);
  expect((await request("PUT", "/subdomain", mine, { subdomain: "abc", extra: true })).status).toBe(400);
});

test("two companies saving the same subdomain at the same time: one gets 200, the other 409 and keeps its previous value", async () => {
  const first = await seller();
  const second = await seller();
  const [firstPrevious, secondPrevious] = [unique(), unique()];
  await saveSubdomain(first, firstPrevious);
  await saveSubdomain(second, secondPrevious);
  const contested = unique();
  const answers = await Promise.all([saveSubdomain(first, contested), saveSubdomain(second, contested)]);
  expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
  const winner = answers[0].status === 200 ? 0 : 1;
  const sessions = [first, second];
  expect((await (await settings(sessions[winner])).json()).subdomain).toBe(contested);
  expect((await (await settings(sessions[1 - winner])).json()).subdomain).toBe(winner === 0 ? secondPrevious : firstPrevious);
});

test("the real 422 INVALID_SUBDOMAIN, 422 SUBDOMAIN_RESERVED, 409 SUBDOMAIN_TAKEN, 409 SUBDOMAIN_REQUIRED and 429 RATE_LIMITED bodies parse with apiErrorResponseSchema and catalogSettingsErrorSchema, and subdomainErrorReason returns the format reason", async () => {
  const mine = await seller();
  const theirs = await seller();
  const name = unique();
  await saveSubdomain(theirs, name);
  const responses = [await saveSubdomain(mine, "fan--tasio"), await saveSubdomain(mine, "pay"), await saveSubdomain(mine, name),
    await settings(mine, { published: true }), await settings(mine, { published: "yes" })];
  const bodies = await Promise.all(responses.map((response) => response.json()));
  expect(bodies.map((body) => body.code)).toEqual(["INVALID_SUBDOMAIN", "SUBDOMAIN_RESERVED", "SUBDOMAIN_TAKEN", "SUBDOMAIN_REQUIRED", "INVALID_CATALOG_SETTINGS"]);
  const limited = await seller();
  for (let call = 0; call < 60; call++) await availability(limited, "fa");
  bodies.push(await (await availability(limited, "fa")).json());
  for (const body of bodies) {
    expect(apiErrorResponseSchema.safeParse(body).success, body.code).toBe(true);
    expect(catalogSettingsErrorSchema.safeParse(body).success, body.code).toBe(true);
  }
  expect(bodies[0].issues).toEqual([{ field: "subdomain", reason: "double_hyphen" }]);
  expect(subdomainErrorReason(catalogSettingsErrorSchema.parse(bodies[0]))).toBe("double_hyphen");
  expect(subdomainErrorReason(catalogSettingsErrorSchema.parse(bodies[1]))).toBeNull();
});

test("publishing without a subdomain answers 409 SUBDOMAIN_REQUIRED and keeps the catalog hidden", async () => {
  const mine = await seller();
  const refused = await settings(mine, { published: true });
  expect(refused.status).toBe(409);
  expect((await refused.json()).code).toBe("SUBDOMAIN_REQUIRED");
  expect(await (await settings(mine)).json()).toMatchObject({ published: false, subdomain: null });
});

test("settings API publishes with a subdomain, hides, keeps the same url and survives a repeated publish", async () => {
  const mine = await seller();
  const name = unique();
  await saveSubdomain(mine, name);
  const url = `http://${name}.${domain}/`;
  const published = await settings(mine, { published: true });
  expect(published.status).toBe(200);
  expect(await published.json()).toMatchObject({ published: true, subdomain: name, url, suggestion: null });
  expect(await (await settings(mine, { published: true })).json()).toMatchObject({ published: true, url });
  expect(await (await settings(mine, { published: false })).json()).toMatchObject({ published: false, subdomain: name, url });
  expect(await (await settings(mine, { published: true })).json()).toMatchObject({ published: true, url });
  const invalid = await settings(mine, { published: "yes" });
  expect(invalid.status).toBe(400);
  expect((await invalid.json()).code).toBe("INVALID_CATALOG_SETTINGS");
  expect((await request("PUT", "/settings", mine)).status).toBe(415);
});

test("hiding a catalog without a subdomain is always allowed", async () => {
  const mine = await seller();
  expect(await (await settings(mine, { published: false })).json()).toMatchObject({ published: false, subdomain: null });
});

test("catalog settings routes reject requests without a session", async () => {
  expect((await settings()).status).toBe(401);
  expect((await request("GET", "/subdomain-availability?value=abc")).status).toBe(401);
  expect((await request("PUT", "/subdomain", undefined, { subdomain: "abcd" })).status).toBe(401);
});
