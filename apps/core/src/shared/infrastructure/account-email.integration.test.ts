import { afterAll, expect, test } from "vitest";
import { app } from "@core/src/app";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";

const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const mailpitUrl = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Integration server did not bind");
const api = `http://127.0.0.1:${address.port}`;
const accounts: string[] = [];

async function call(path: string, body?: unknown, cookie?: string, method = "POST") {
  return fetch(`${api}${path}`, {
    method,
    headers: { origin: baseUrl, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "manual",
  });
}

async function mail(email: string) {
  const search = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  if (!search.ok) return null;
  const result = await search.json();
  const first = result.messages?.[0];
  if (!first?.ID) return null;
  const response = await fetch(`${mailpitUrl}/api/v1/message/${first.ID}`);
  return response.ok ? response.json() : null;
}

async function capturedLink(email: string, route: "verify-email" | "reset-password") {
  let message: Awaited<ReturnType<typeof mail>> = null;
  await expect.poll(async () => {
    message = await mail(email);
    return message?.HTML ?? "";
  }, { timeout: 10_000 }).toContain(route);
  const link = [...(message?.HTML ?? "").matchAll(/href="([^"]+)"/g)]
    .map(([, value]) => value.replaceAll("&amp;", "&"))
    .find((value) => value.includes(`/api/auth/${route}`));
  if (!link) throw new Error(`Email did not contain ${route}`);
  const url = new URL(link);
  url.host = new URL(api).host;
  url.protocol = new URL(api).protocol;
  return url;
}

afterAll(async () => {
  for (const email of accounts) {
    const user = await systemPrisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) await systemPrisma.verification.deleteMany({ where: { identifier: { startsWith: "reset-password:" }, value: user.id } });
    await systemPrisma.user.deleteMany({ where: { email } });
  }
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await systemPrisma.$disconnect();
});

test("signup, verification, access, recovery, and session revocation use Better Auth and Mailpit", async () => {
  const email = `account-${crypto.randomUUID()}@example.test`;
  const password = "initial-password-123";
  accounts.push(email);
  const signup = await call("/api/auth/sign-up/email", { name: "Account test", email, password, callbackURL: `${baseUrl}/account-verified` });
  expect(signup.status).toBe(200);
  expect(signup.headers.get("set-cookie")).toBeNull();
  const signupBody = await signup.json();
  expect(signupBody.token).toBeNull();
  expect(signupBody.user.emailVerified).toBe(false);
  const userId = signupBody.user.id;
  expect(await systemPrisma.user.findUniqueOrThrow({ where: { id: userId }, select: { companyId: true } })).toEqual({ companyId: null });

  const rejectedLogin = await call("/api/auth/sign-in/email", { email, password });
  expect(rejectedLogin.status).toBe(403);
  expect(rejectedLogin.headers.get("set-cookie")).toBeNull();
  expect((await call("/api/me", undefined, undefined, "GET")).status).toBe(401);

  const accountBeforeDuplicate = await systemPrisma.account.findFirstOrThrow({ where: { userId, providerId: "credential" }, select: { password: true } });
  const duplicate = await call("/api/auth/sign-up/email", { name: "Changed name", email, password: "changed-password-456", callbackURL: `${baseUrl}/account-verified` });
  expect(duplicate.status).toBe(200);
  expect(duplicate.headers.get("set-cookie")).toBeNull();
  expect(await duplicate.json()).toMatchObject({ token: null, user: { email, emailVerified: false } });
  expect(await systemPrisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, emailVerified: true } })).toEqual({ name: "Account test", emailVerified: false });
  expect(await systemPrisma.account.findFirstOrThrow({ where: { userId, providerId: "credential" }, select: { password: true } })).toEqual(accountBeforeDuplicate);

  const verificationLink = await capturedLink(email, "verify-email");
  const verified = await fetch(verificationLink, { redirect: "manual" });
  expect(verified.status).toBe(302);
  expect(verified.headers.get("location")).toContain("account-verified");
  expect(await systemPrisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerified: true, companyId: true } })).toEqual({ emailVerified: true, companyId: null });
  expect(await systemPrisma.session.count({ where: { userId } })).toBe(0);

  const signedIn = await call("/api/auth/sign-in/email", { email, password });
  expect(signedIn.status).toBe(200);
  const cookie = signedIn.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeTruthy();
  expect(await (await call("/api/me", undefined, cookie, "GET")).json()).toMatchObject({ status: "company_required", company: null });
  expect((await call("/api/company", { name: "Unauthorized", country: "PE" })).status).toBe(401);

  const resetResponse = await call("/api/auth/request-password-reset", { email, redirectTo: `${baseUrl}/reset-password` });
  expect(resetResponse.status).toBe(200);
  const resetLink = await capturedLink(email, "reset-password");
  const resetPreview = await fetch(resetLink, { redirect: "manual" });
  expect(resetPreview.status).toBe(302);
  expect(resetPreview.headers.get("location")).toContain("reset-password?token=");
  const token = decodeURIComponent(resetLink.pathname.split("/").at(-1) ?? "");
  const reset = await call("/api/auth/reset-password", { token, newPassword: "updated-password-456" });
  expect(reset.status).toBe(200);
  expect(await reset.json()).toMatchObject({ status: true });
  expect((await call("/api/me", undefined, cookie, "GET")).status).toBe(401);
  expect(await systemPrisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerified: true } })).toEqual({ emailVerified: true });
  expect(await systemPrisma.verification.findFirst({ where: { identifier: `reset-password:${token}` } })).toBeNull();

  const newLogin = await call("/api/auth/sign-in/email", { email, password: "updated-password-456" });
  expect(newLogin.status).toBe(200);
});

test("recovery requests return the same contract for existing and missing emails", async () => {
  const existingEmail = `request-${crypto.randomUUID()}@example.test`;
  accounts.push(existingEmail);
  const signup = await call("/api/auth/sign-up/email", { name: "Request test", email: existingEmail, password: "test-password-123", callbackURL: `${baseUrl}/account-verified` });
  expect(signup.status).toBe(200);
  const existing = await call("/api/auth/request-password-reset", { email: existingEmail, redirectTo: `${baseUrl}/reset-password` });
  const missing = await call("/api/auth/request-password-reset", { email: `missing-${crypto.randomUUID()}@example.test`, redirectTo: `${baseUrl}/reset-password` });
  expect(await existing.json()).toEqual(await missing.json());
  expect(existing.status).toBe(missing.status);
});
