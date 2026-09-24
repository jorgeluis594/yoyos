import assert from "node:assert/strict";
import { test, vi } from "vitest";

test("JWT uses the same access and becomes invalid after session revocation", async () => {
  const { app } = await import("../../app.ts");
  const { systemPrisma, withTenantIsolation, prisma } = await import("./persistance.ts");
  const { auth } = await import("./auth.ts");
  const server = app.listen(0);
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const email = `${crypto.randomUUID()}@example.test`;
  let userId;
  let companyId;
  try {
    const [permissions] = await systemPrisma.$queryRaw`SELECT
      pg_get_userbyid(c.relowner) AS owner,
      has_table_privilege(current_user, 'public.jwks', 'SELECT')
        AND has_table_privilege(current_user, 'public.jwks', 'INSERT')
        AND has_table_privilege(current_user, 'public.jwks', 'UPDATE')
        AND has_table_privilege(current_user, 'public.jwks', 'DELETE') AS can_use,
      (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass_rls
      FROM pg_class c WHERE c.oid = 'public.jwks'::regclass`;
    assert.equal(permissions.can_use, true);
    assert.equal(permissions.bypass_rls, false);
    assert.notEqual(permissions.owner, "core_app");
    const registered = await fetch(`${base}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "JWT test", email, password: "correct-horse-battery-staple" }),
    });
    if (registered.status !== 200) throw new Error(`Sign-up failed: ${registered.status} ${await registered.text()}`);
    const registration = await registered.json();
    userId = registration.user.id;
    assert.equal(registration.user.emailVerified, false);
    const cookie = registered.headers.get("set-cookie")?.split(";")[0];
    assert(cookie);
    const tokenResponse = await fetch(`${base}/api/auth/token`, { headers: { cookie } });
    if (tokenResponse.status !== 200) throw new Error(`Token failed: ${tokenResponse.status} ${await tokenResponse.text()}`);
    const { token } = await tokenResponse.json();
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    assert.deepEqual(Object.keys(payload).sort(), ["aud", "exp", "iat", "iss", "sid", "sub"]);
    assert.equal(payload.sub, userId);
    assert.equal(payload.aud, "yoyos-core-api");
    assert.equal(payload.exp - payload.iat, 900);
    const jwks = await fetch(`${base}/api/auth/jwks`);
    assert.equal(jwks.status, 200);
    assert.equal(JSON.stringify(await jwks.json()).includes("privateKey"), false);
    const bearer = { authorization: `Bearer ${token}` };
    const [viaCookie, viaJwt] = await Promise.all([
      fetch(`${base}/api/me`, { headers: { cookie } }),
      fetch(`${base}/api/me`, { headers: bearer }),
    ]);
    assert.equal(viaCookie.status, 200);
    assert.equal(viaJwt.status, 200);
    assert.deepEqual(await viaJwt.json(), await viaCookie.json());
    const sessionLookup = vi.spyOn(systemPrisma.session, "findFirst").mockRejectedValueOnce(new Error("database unavailable"));
    try {
      const unavailable = await fetch(`${base}/api/me`, { headers: bearer });
      assert.equal(unavailable.status, 503);
      assert.deepEqual(await unavailable.json(), { code: "SERVICE_UNAVAILABLE", error: "Service unavailable" });
    } finally { sessionLookup.mockRestore(); }
    const signature = token.split(".")[2];
    const tampered = `${token.slice(0, -signature.length)}${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`;
    assert.equal((await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${tampered}` } })).status, 401);
    const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
    const wrongAlgorithm = `${Buffer.from(JSON.stringify({ ...header, alg: "HS256" })).toString("base64url")}.${token.split(".").slice(1).join(".")}`;
    assert.equal((await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${wrongAlgorithm}` } })).status, 401);
    const sign = async (changes) => (await auth.api.signJWT({ body: { payload: { ...payload, ...changes } } })).token;
    for (const changes of [
      { iss: "https://other.example" },
      { aud: "other-api" },
      { sid: "another-session" },
      { sub: "another-user" },
      { exp: Math.floor(Date.now() / 1000) - 1 },
      { extra: "unexpected" },
    ]) {
      const invalid = await sign(changes);
      assert.equal((await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${invalid}` } })).status, 401);
    }
    const invalidAuthorization = await fetch(`${base}/api/me`, { headers: { cookie, authorization: "Basic invalid" } });
    assert.equal(invalidAuthorization.status, 401);
    assert.equal((await fetch(`${base}/api/private`, { headers: bearer })).status, 409);
    const company = await fetch(`${base}/api/company`, {
      method: "POST", headers: { ...bearer, "content-type": "application/json" },
      body: JSON.stringify({ name: "JWT Company", country: "PE" }),
    });
    assert.equal(company.status, 201);
    ({ companyId } = await company.json());
    const repeatedCompany = await fetch(`${base}/api/company`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Ignored", country: "US" }),
    });
    assert.equal(repeatedCompany.status, 200);
    assert.deepEqual(await repeatedCompany.json(), { companyId });
    assert.equal((await fetch(`${base}/api/me`, { headers: bearer })).status, 200);
    assert.equal((await fetch(`${base}/api/private`, { headers: bearer })).status, 404);
    const before = await systemPrisma.session.update({ where: { id: payload.sid }, data: { expiresAt: new Date(Date.now() + 5 * 60 * 60 * 1000) } });
    assert.equal((await fetch(`${base}/api/me`, { headers: bearer })).status, 200);
    const afterJwt = await systemPrisma.session.findUniqueOrThrow({ where: { id: payload.sid } });
    assert.equal(afterJwt.expiresAt.getTime(), before.expiresAt.getTime());
    const renewed = await fetch(`${base}/api/auth/get-session`, { headers: { cookie } });
    assert.equal(renewed.status, 200);
    const afterSession = await systemPrisma.session.findUniqueOrThrow({ where: { id: payload.sid } });
    assert(afterSession.expiresAt.getTime() > before.expiresAt.getTime());
    await systemPrisma.session.update({ where: { id: payload.sid }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await fetch(`${base}/api/me`, { headers: bearer })).status, 401);
    await systemPrisma.session.update({ where: { id: payload.sid }, data: { expiresAt: afterSession.expiresAt } });
    const revoked = await fetch(`${base}/api/auth/sign-out`, { method: "POST", headers: { cookie, origin: "http://localhost:3000" } });
    assert.equal(revoked.status, 200, await revoked.text());
    assert.equal((await fetch(`${base}/api/me`, { headers: bearer })).status, 401);
    const signedIn = await fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
    });
    assert.equal(signedIn.status, 200);
    const newCookie = signedIn.headers.get("set-cookie")?.split(";")[0];
    assert(newCookie);
    const newToken = await fetch(`${base}/api/auth/token`, { headers: { cookie: newCookie } });
    assert.equal(newToken.status, 200);
    const loginJwt = (await newToken.json()).token;
    assert.equal((await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${loginJwt}` } })).status, 200);
  } finally {
    if (userId) await systemPrisma.user.delete({ where: { id: userId } });
    if (companyId) await withTenantIsolation(companyId, async () => { await prisma.company.delete({ where: { id: companyId } }); });
    server.close();
  }
});
