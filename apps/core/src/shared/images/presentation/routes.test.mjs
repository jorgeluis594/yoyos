import { expect, test } from "vitest";

test("authenticated image routes validate uploads and isolate companies", async () => {
  expect(process.env.DATABASE_URL, "run with the isolated integration database").toBeTruthy();
  process.env.BETTER_AUTH_SECRET = "integration-test-secret-at-least-32-characters";
  process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000";
  process.env.CLOUDFLARE_IMAGES_ACCOUNT_ID = "account";
  process.env.CLOUDFLARE_IMAGES_API_TOKEN = "token";
  process.env.CLOUDFLARE_IMAGES_DELIVERY_HASH = "hash";
  const { app } = await import("../../../app.ts");
  const { prisma, systemPrisma, withTenantIsolation } = await import("../../infrastructure/persistance.ts");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = globalThis.fetch;
  let providerStatus = 200;
  let uploaded = 0;
  const deleted = [];
  const users = [];
  const companies = [];
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://api.cloudflare.com/")) {
      if (init.method === "DELETE") {
        deleted.push(String(input).split("/").at(-1));
        return Response.json({ success: true });
      }
      uploaded += 1;
      return Response.json(providerStatus === 200
        ? { success: true, result: { id: `remote-${uploaded}` } }
        : { success: false, errors: [{ message: "provider failure" }] }, { status: providerStatus });
    }
    return originalFetch(input, init);
  };
  const request = (path, options = {}, cookie = "") => originalFetch(`${base}${path}`, {
    ...options,
    headers: { ...(options.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });
  const form = (bytes, type = "image/png", name = "a.png") => {
    const data = new FormData();
    data.set("file", new File([bytes], name, { type }));
    return data;
  };
  const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 0);
  async function register(withCompany) {
    const email = `image-${crypto.randomUUID()}@example.test`;
    const signup = await request("/api/auth/sign-up/email", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Image tester", email, password: "test-password-123" }),
    });
    expect(signup.status, await signup.clone().text()).toBe(200);
    users.push(email);
    const cookie = signup.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    if (withCompany) {
      const company = await request("/api/company", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Image company", country: "PE" }),
      }, cookie);
      expect(company.status, await company.clone().text()).toBe(201);
      companies.push((await company.json()).companyId);
    }
    return cookie;
  }
  try {
    expect((await request("/api/images/missing")).status).toBe(401);
    expect((await request("/api/images", { method: "POST", body: form(png) })).status).toBe(401);
    const pending = await register(false);
    expect((await request("/api/images/missing", {}, pending)).status).toBe(409);
    expect((await request("/api/images", { method: "POST", body: form(png) }, pending)).status).toBe(409);
    const owner = await register(true);
    const other = await register(true);
    const multiple = form(png);
    multiple.set("extra", "unexpected");
    expect((await request("/api/images", { method: "POST", body: multiple }, owner)).status).toBe(400);
    expect((await request("/api/images", { method: "POST", body: form(png.subarray(0, 3)) }, owner)).status).toBe(400);
    expect((await request("/api/images", { method: "POST", body: form(png, "image/jpeg") }, owner)).status).toBe(400);
    expect((await request("/api/images", { method: "POST", body: form(new Uint8Array(10_000_001)) }, owner)).status).toBe(413);
    expect(uploaded).toBe(0);
    const created = await request("/api/images", { method: "POST", body: form(png) }, owner);
    expect(created.status, await created.clone().text()).toBe(201);
    const image = await created.json();
    expect(image.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(image.url).toBe("https://imagedelivery.net/hash/remote-1/public");
    expect(await systemPrisma.image.findUnique({ where: { id: image.id } })).toBeNull();
    await expect(withTenantIsolation(companies[0], async () => await prisma.image.create({
      data: { companyId: companies[1], storageKey: "cross-tenant" },
    }))).rejects.toThrow();
    expect(await (await request(`/api/images/${image.id}`, {}, owner)).json()).toEqual(image);
    expect((await request(`/api/images/${image.id}`, {}, other)).status).toBe(404);
    providerStatus = 503;
    expect((await request("/api/images", { method: "POST", body: form(png) }, owner)).status).toBe(502);
    expect(deleted).toHaveLength(0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const companyId of companies) {
      await withTenantIsolation(companyId, async () => {
        await prisma.image.deleteMany({ where: { companyId } });
      });
    }
    for (const email of users) await systemPrisma.user.deleteMany({ where: { email } });
    for (const companyId of companies) await withTenantIsolation(companyId, async () => await prisma.company.delete({ where: { id: companyId } }));
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await systemPrisma.$disconnect();
  }
});
