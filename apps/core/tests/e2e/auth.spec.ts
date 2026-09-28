import { browserExpect, expect, test } from "./fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "../../src/shared/infrastructure/persistance";

const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";

async function findEmail(email: string) {
  const response = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  if (!response.ok) throw new Error(`Mailpit search failed: ${response.status}`);
  const result = await response.json();
  const first = result.messages?.[0];
  if (!first?.ID) return null;
  const message = await fetch(`${mailpit}/api/v1/message/${first.ID}`);
  if (!message.ok) throw new Error(`Mailpit message request failed: ${message.status}`);
  return message.json();
}

async function emailLink(email: string, action: "verify-email" | "reset-password") {
  let message: Awaited<ReturnType<typeof findEmail>> = null;
  await browserExpect.poll(async () => {
    message = await findEmail(email);
    return message?.HTML ?? "";
  }, { timeout: 10_000 }).toContain(action);
  const links = [...(message?.HTML ?? "").matchAll(/href="([^"]+)"/g)].map(([, href]) => href.replaceAll("&amp;", "&"));
  const link = links.find((value) => value.includes(`/api/auth/${action}`));
  if (!link) throw new Error(`Mailpit message has no ${action} link`);
  return link;
}

async function removeAccount(email: string) {
  const user = await systemPrisma.user.findUnique({ where: { email }, select: { companyId: true } });
  await systemPrisma.user.deleteMany({ where: { email } });
  const companyId = user?.companyId;
  if (companyId) await withTenantIsolation(companyId, async () => { await prisma.company.deleteMany({ where: { id: companyId } }); });
}

test("registration verifies through Mailpit, requires explicit sign-in, and completes company onboarding", async ({ page }) => {
  const email = `verify-${crypto.randomUUID()}@example.test`;
  try {
    await page.goto("/register");
    await page.getByLabel("Nombre", { exact: true }).fill("Ana Prueba");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("test-password-123");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await browserExpect(page.getByRole("heading", { name: "Revisa tu correo" })).toBeVisible();
    await browserExpect(page.getByText(/Si ya tienes cuenta/)).toBeVisible();

    const link = await emailLink(email, "verify-email");
    await page.goto(link);
    await browserExpect(page).toHaveURL(/\/account-verified$/);
    await browserExpect(page.getByRole("heading", { name: "Verificación completada" })).toBeVisible();
    const user = await systemPrisma.user.findUniqueOrThrow({ where: { email }, select: { emailVerified: true, companyId: true } });
    expect(user).toEqual({ emailVerified: true, companyId: null });

    await page.getByRole("link", { name: "Iniciar sesión" }).click();
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("test-password-123");
    await page.getByRole("button", { name: "Entrar" }).click();
    await browserExpect(page).toHaveURL(/\/register$/);
    await page.getByLabel("Nombre de empresa").fill("Empresa Ana");
    await page.getByLabel("País").click();
    await page.getByRole("option", { name: "Perú" }).click();
    await page.getByRole("button", { name: "Crear empresa" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/dashboard$/);
    await browserExpect(page.getByRole("heading", { name: "Hola, Ana Prueba" })).toBeVisible();
    const access = await page.request.get("/api/me");
    expect(await access.json()).toMatchObject({ status: "ready", user: { name: "Ana Prueba" }, company: { name: "Empresa Ana", country: "PE" } });
  } finally { await removeAccount(email); }
});

test("password recovery opens its form without consuming the link, then resets and signs in", async ({ page, request }) => {
  const email = `reset-${crypto.randomUUID()}@example.test`;
  const password = "initial-password-123";
  try {
    const registration = await request.post("/api/auth/sign-up/email", { data: { name: "Reset User", email, password } });
    const registrationText = await registration.text();
    expect(registration.status()).toBe(200);
    const user = JSON.parse(registrationText).user;
    await systemPrisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    const login = await request.post("/api/auth/sign-in/email", { data: { email, password } });
    expect(login.status()).toBe(200);
    const company = await request.post("/api/company", { data: { name: "Reset company", country: "PE" } });
    expect(company.status()).toBe(201);
    await request.post("/api/auth/sign-out");

    await page.goto("/forgot-password");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByRole("button", { name: "Enviar enlace" }).click();
    await browserExpect(page.getByRole("status")).toContainText("Si existe una cuenta");
    const link = await emailLink(email, "reset-password");
    await page.goto(link);
    await browserExpect(page).toHaveURL(/\/reset-password\?token=/);
    const before = await systemPrisma.account.findFirstOrThrow({ where: { userId: user.id, providerId: "credential" }, select: { password: true } });
    await page.reload();
    const afterOpen = await systemPrisma.account.findFirstOrThrow({ where: { userId: user.id, providerId: "credential" }, select: { password: true } });
    expect(afterOpen.password).toBe(before.password);

    await page.getByLabel("Nueva contraseña").fill("updated-password-456");
    await page.getByRole("button", { name: "Cambiar contraseña" }).click();
    await browserExpect(page.getByText("La contraseña se cambió.")).toBeVisible();
    const updated = await systemPrisma.account.findFirstOrThrow({ where: { userId: user.id, providerId: "credential" }, select: { password: true } });
    expect(updated.password).not.toBe(before.password);
    await page.getByRole("link", { name: "Iniciar sesión" }).click();
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("updated-password-456");
    await page.getByRole("button", { name: "Entrar" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/dashboard$/);
  } finally { await removeAccount(email); }
});

test("company creation remains private without a session", async ({ request }) => {
  expect((await request.post("/api/company", { data: { name: "No" } })).status()).toBe(401);
  const access = await request.get("/api/me");
  expect(access.status()).toBe(401);
  expect(await access.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  expect((await request.get("/api/anything")).status()).toBe(401);
});
