import { browserExpect, expect, test } from "./fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "../../src/shared/infrastructure/persistance";

async function removeAccount(email: string) {
  const user = await systemPrisma.user.findUnique({ where: { email }, select: { companyId: true } });
  await systemPrisma.user.deleteMany({ where: { email } });
  if (user?.companyId) {
    const companyId = user.companyId;
    await withTenantIsolation(companyId, async () => prisma.company.delete({ where: { id: companyId } }));
  }
}

test("register, persist session, sign out, reject bad password, and sign in", async ({ page }) => {
  const email = `auth-${crypto.randomUUID()}@example.test`;

  try {
    await page.goto("/dashboard");
    await browserExpect(page).toHaveURL(/\/login$/);
    await page.goto("/es-PE/dashboard");
    await browserExpect(page).toHaveURL(/\/es-PE\/login$/);

    await page.getByRole("link", { name: "Regístrate" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Ana Prueba");
    await page.getByLabel("Nombre de empresa").fill("Empresa Ana");
    await browserExpect(page.getByLabel("País")).toHaveValue("");
    await page.getByLabel("País").selectOption("PE");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("test-password-123");
    const createdCompany = page.waitForResponse((response) => response.url().endsWith("/api/company"));
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    expect((await createdCompany).status()).toBe(201);
    await browserExpect(page).toHaveURL(/\/es-PE\/dashboard$/);
    await browserExpect(page.getByRole("heading", { name: "Hola, Ana Prueba" })).toBeVisible();

    await page.goto("/register");
    await browserExpect(page).toHaveURL(/\/es-PE\/dashboard$/);

    await page.reload();
    await browserExpect(page.getByRole("heading", { name: "Hola, Ana Prueba" })).toBeVisible();

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await browserExpect(page).toHaveURL(/\/login$/);
    await page.goto("/es-PE/dashboard");
    await browserExpect(page).toHaveURL(/\/es-PE\/login$/);

    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("wrong-password");
    await page.getByRole("button", { name: "Entrar" }).click();
    await browserExpect(page.getByRole("alert")).toBeVisible();
    await page.goto("/es-PE/dashboard");
    await browserExpect(page).toHaveURL(/\/es-PE\/login$/);

    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("test-password-123");
    await page.getByRole("button", { name: "Entrar" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/dashboard$/);
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
    await page.getByLabel("País").selectOption("CO");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("No se pudo crear la empresa");
    await browserExpect(page.getByRole("button", { name: "Crear empresa" })).toBeVisible();
    await browserExpect(page.getByLabel("País")).toHaveValue("CO");

    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("test-password-123");
    await page.getByRole("button", { name: "Entrar" }).click();
    await browserExpect(page).toHaveURL(/\/register$/);
    await page.goto("/es-PE/dashboard");
    await browserExpect(page).toHaveURL(/\/es-PE\/register$/);
    await browserExpect(page.getByLabel("Correo electrónico")).toHaveCount(0);
    expect((await page.request.get("/api/anything")).status()).toBe(409);
    expect((await page.request.post("/api/company", { data: { name: "   " } })).status()).toBe(400);
    expect((await page.request.post("/api/company", { data: { name: "x".repeat(121) } })).status()).toBe(400);
    expect((await page.request.post("/api/company", { data: { name: "Empresa Pendiente" } })).status()).toBe(400);
    expect((await page.request.post("/api/company", { data: { name: "Empresa Pendiente", country: "ZZ" } })).status()).toBe(400);

    await page.getByLabel("Nombre de empresa").fill("  Empresa Pendiente  ");
    await page.getByLabel("País").selectOption("CO");
    await page.getByRole("button", { name: "Crear empresa" }).click();
    await browserExpect(page).toHaveURL(/\/es-CO\/dashboard$/);
    await page.goto("/dashboard");
    await browserExpect(page).toHaveURL(/\/es-CO\/dashboard$/);
    await page.goto("/es-BR/dashboard");
    await browserExpect(page).toHaveURL(/\/es-CO\/dashboard$/);
    const user = await systemPrisma.user.findUniqueOrThrow({ where: { email }, select: { companyId: true } });
    expect(user.companyId).toBeTruthy();
    if (!user.companyId) throw new Error("Company was not linked");
    const companyId = user.companyId;
    expect(await withTenantIsolation(companyId, async () => prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, country: true } }))).toEqual({ name: "Empresa Pendiente", country: "CO" });
    expect((await page.request.post("/api/company", { data: { name: "Otra empresa", country: "ZZ" } })).status()).toBe(400);
    const retry = await page.request.post("/api/company", { data: { name: "Otra empresa", country: "BR", companyId: crypto.randomUUID() } });
    expect(retry.status()).toBe(200);
    expect((await retry.json()).companyId).toBe(user.companyId);
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await browserExpect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("test-password-123");
    await page.getByRole("button", { name: "Entrar" }).click();
    await browserExpect(page).toHaveURL(/\/es-CO\/dashboard$/);
  } finally {
    await removeAccount(email);
  }
});

test("company endpoint requires a session", async ({ request }) => {
  expect((await request.post("/api/company", { data: { name: "No" } })).status()).toBe(401);
  expect((await request.get("/api/anything")).status()).toBe(401);
});
