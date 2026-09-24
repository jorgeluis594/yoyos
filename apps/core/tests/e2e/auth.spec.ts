import { browserExpect, expect, test } from "./fixtures";
import express, { type Response } from "express";
import { prisma, systemPrisma, withTenantIsolation, getCompanyId } from "../../src/shared/infrastructure/persistance";
import { loadApiAccess, requireApiCompany, type PrivateLocals } from "../../src/shared/infrastructure/api-auth-middleware";

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
    const access = await page.request.get("/api/me");
    expect(access.status()).toBe(200);
    expect(access.headers()["cache-control"]).toBe("no-store");
    const currentAccess = await access.json();
    expect(currentAccess).toMatchObject({ status: "ready", user: { name: "Ana Prueba" }, company: { name: "Empresa Ana", country: "PE" } });
    const privateProbe = express();
    privateProbe.use(loadApiAccess, requireApiCompany);
    privateProbe.get("/", (_request, response: Response<unknown, PrivateLocals>) =>
      response.json({ tenantId: getCompanyId(), status: response.locals.auth.status, companyId: response.locals.auth.company.id }),
    );
    const probeServer = privateProbe.listen(0);
    try {
      const address = probeServer.address();
      if (!address || typeof address === "string") throw new Error("Private probe did not bind a port");
      const cookies = (await page.context().cookies()).map(({ name, value }) => `${name}=${value}`).join("; ");
      const response = await fetch(`http://127.0.0.1:${address.port}/`, { headers: { cookie: cookies } });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ status: "ready", tenantId: currentAccess.company.id, companyId: currentAccess.company.id });
    } finally {
      probeServer.close();
    }

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
    await browserExpect(page.getByRole("alert")).toContainText("No se recibió una respuesta válida");
    await browserExpect(page.getByRole("button", { name: "Crear empresa" })).toBeVisible();
    await browserExpect(page.getByLabel("País")).toHaveValue("CO");
    const pendingAccess = await page.request.get("/api/me");
    expect(pendingAccess.status()).toBe(200);
    expect(await pendingAccess.json()).toMatchObject({ status: "company_required", company: null, user: { companyId: null } });

    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("test-password-123");
    await page.getByRole("button", { name: "Entrar" }).click();
    await browserExpect(page).toHaveURL(/\/register$/);
    await page.goto("/es-PE/dashboard");
    await browserExpect(page).toHaveURL(/\/es-PE\/register$/);
    await browserExpect(page.getByLabel("Correo electrónico")).toHaveCount(0);
    expect((await page.request.get("/api/anything")).status()).toBe(409);
    expect(await (await page.request.get("/api/anything")).json()).toMatchObject({ code: "COMPANY_REQUIRED" });
    expect((await page.request.post("/api/company", { data: { name: "   " } })).status()).toBe(400);
    expect((await page.request.post("/api/company", { data: { name: "x".repeat(121) } })).status()).toBe(400);
    expect((await page.request.post("/api/company", { data: { name: "Empresa Pendiente" } })).status()).toBe(400);
    expect((await page.request.post("/api/company", { data: { name: "Empresa Pendiente", country: "ZZ" } })).status()).toBe(400);
    const malformed = await page.request.post("/api/company", { data: "{", headers: { "Content-Type": "application/json" } });
    expect(malformed.status()).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: "INVALID_COMPANY" });

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
    const retry = await page.request.post("/api/company", { data: { name: "Otra empresa", country: "BR", companyId: crypto.randomUUID(), userId: "other-user" } });
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
  const access = await request.get("/api/me");
  expect(access.status()).toBe(401);
  expect(await access.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  expect((await request.get("/api/anything")).status()).toBe(401);
});
