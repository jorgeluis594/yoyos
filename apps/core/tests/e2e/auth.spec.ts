import { expect, test } from "@playwright/test";
import { authPrisma } from "../../src/shared/infrastructure/prisma";
import { prisma, withCompanyContext } from "../../src/shared/infrastructure/prisma";

async function removeAccount(email: string) {
  const user = await authPrisma.user.findUnique({ where: { email }, select: { companyId: true } });
  await authPrisma.user.deleteMany({ where: { email } });
  if (user?.companyId) {
    const companyId = user.companyId;
    await withCompanyContext(companyId, async () => prisma.company.delete({ where: { id: companyId } }));
  }
}

test("register, persist session, sign out, reject bad password, and sign in", async ({ page }) => {
  const email = `auth-${crypto.randomUUID()}@example.test`;

  try {
    await page.goto("/es-PE/dashboard");
    await expect(page).toHaveURL(/\/es-PE\/login$/);

    await page.getByRole("link", { name: "Regístrate" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Ana Prueba");
    await page.getByLabel("Nombre de empresa").fill("Empresa Ana");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("test-password-123");
    const createdCompany = page.waitForResponse((response) => response.url().endsWith("/api/company"));
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    expect((await createdCompany).status()).toBe(201);
    await expect(page).toHaveURL(/\/es-PE\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Hola, Ana Prueba" })).toBeVisible();

    await page.goto("/es-PE/register");
    await expect(page).toHaveURL(/\/es-PE\/dashboard$/);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Hola, Ana Prueba" })).toBeVisible();

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/es-PE\/login$/);
    await page.goto("/es-PE/dashboard");
    await expect(page).toHaveURL(/\/es-PE\/login$/);

    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("wrong-password");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.goto("/es-PE/dashboard");
    await expect(page).toHaveURL(/\/es-PE\/login$/);

    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("test-password-123");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/es-PE\/dashboard$/);
  } finally {
    await removeAccount(email);
  }
});

test("company creation can be retried after registration", async ({ page }) => {
  const email = `pending-${crypto.randomUUID()}@example.test`;
  try {
    await page.route("**/api/company", async (route) => {
      await route.fulfill({ status: 503, body: "unavailable" });
      await page.unroute("**/api/company");
    });
    await page.goto("/es-PE/register");
    await page.getByLabel("Nombre", { exact: true }).fill("Pendiente");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("test-password-123");
    await page.getByLabel("Nombre de empresa").fill("Empresa Pendiente");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByRole("alert")).toContainText("No se pudo crear la empresa");
    await expect(page.getByRole("button", { name: "Crear empresa" })).toBeVisible();

    await page.goto("/es-PE/login");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("test-password-123");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/es-PE\/register$/);
    await page.goto("/es-PE/dashboard");
    await expect(page).toHaveURL(/\/es-PE\/register$/);
    await expect(page.getByLabel("Correo electrónico")).toHaveCount(0);
    expect((await page.request.get("/api/anything")).status()).toBe(409);
    expect((await page.request.post("/api/company", { data: { name: "   " } })).status()).toBe(400);
    expect((await page.request.post("/api/company", { data: { name: "x".repeat(121) } })).status()).toBe(400);

    await page.getByLabel("Nombre de empresa").fill("  Empresa Pendiente  ");
    await page.getByRole("button", { name: "Crear empresa" }).click();
    await expect(page).toHaveURL(/\/es-PE\/dashboard$/);
    const user = await authPrisma.user.findUniqueOrThrow({ where: { email }, select: { companyId: true } });
    expect(user.companyId).toBeTruthy();
    if (!user.companyId) throw new Error("Company was not linked");
    const companyId = user.companyId;
    expect((await withCompanyContext(companyId, async () => prisma.company.findUniqueOrThrow({ where: { id: companyId } }))).name).toBe("Empresa Pendiente");
    const retry = await page.request.post("/api/company", { data: { name: "Otra empresa", companyId: crypto.randomUUID() } });
    expect(retry.status()).toBe(200);
    expect((await retry.json()).companyId).toBe(user.companyId);
  } finally {
    await removeAccount(email);
  }
});

test("company endpoint requires a session", async ({ request }) => {
  expect((await request.post("/api/company", { data: { name: "No" } })).status()).toBe(401);
  expect((await request.get("/api/anything")).status()).toBe(401);
});
