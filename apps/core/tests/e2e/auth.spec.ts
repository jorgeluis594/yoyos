import designTokens from "../../../../docs/design-tokens.json";
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
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("test-password-123");
    expect(await page.locator("form").evaluate((element) => (element as HTMLFormElement).checkValidity())).toBe(false);
    expect(await page.locator("form").evaluate((element) => new FormData(element as HTMLFormElement).get("country"))).toBeNull();
    await page.getByLabel("País").click();
    await page.getByRole("option", { name: "Perú" }).click();
    expect(await page.locator("form").evaluate((element) => new FormData(element as HTMLFormElement).get("country"))).toBe("PE");
    const createdCompany = page.waitForResponse((response) => response.url().endsWith("/api/company"));
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    expect((await createdCompany).status()).toBe(201);
    await browserExpect(page).toHaveURL(/\/es-PE\/dashboard$/);
    await browserExpect(page.getByRole("heading", { name: "Hola, Ana Prueba" })).toBeVisible();
    await page.getByRole("link", { name: "Saltar al contenido" }).focus();
    await page.keyboard.press("Enter");
    await browserExpect(page.getByRole("main")).toBeFocused();
    await page.setViewportSize({ width: 1440, height: 900 });
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
    const sidebar = page.getByRole("complementary");
    await browserExpect(sidebar).toHaveCSS("width", `${designTokens.layout.sidebarWidth}px`);
    await browserExpect(page.getByRole("banner")).toHaveCSS("min-height", `${designTokens.layout.appHeaderMinHeight}px`);
    await browserExpect(sidebar.getByRole("button", { name: "Alternar tema" })).toHaveCSS("min-height", `${designTokens.sizing.controlDesktopMinHeight}px`);
    await browserExpect(sidebar).toContainText("Empresa Ana");
    await browserExpect(sidebar).toContainText("Ana Prueba");
    await browserExpect(sidebar.getByRole("link", { name: "Inicio" })).toHaveAttribute("href", "/es-PE/dashboard");
    await browserExpect(sidebar.getByRole("link", { name: "Inicio" })).toHaveAttribute("aria-current", "page");
    await sidebar.getByRole("link", { name: "Inicio" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/dashboard$/);

    await page.goto("/register");
    await browserExpect(page).toHaveURL(/\/es-PE\/dashboard$/);

    await page.reload();
    await browserExpect(page.getByRole("heading", { name: "Hola, Ana Prueba" })).toBeVisible();
    await page.emulateMedia({ colorScheme: "dark" });
    await browserExpect(page.locator("html")).toHaveClass(/dark/);
    await page.emulateMedia({ colorScheme: "light" });
    await browserExpect(page.locator("html")).not.toHaveClass(/dark/);
    await sidebar.getByRole("button", { name: "Alternar tema" }).click();
    await browserExpect(page.locator("html")).toHaveClass(/dark/);
    await browserExpect(sidebar.getByRole("button", { name: "Cerrar sesión" })).toHaveCSS("color", "rgb(238, 232, 223)");
    await page.setViewportSize({ width: 390, height: 780 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const menuButton = page.getByRole("button", { name: "Abrir menú" });
    await menuButton.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("dialog", { name: "Menú principal" });
    await browserExpect(menu).toBeVisible();
    await browserExpect(menu).toHaveCSS("width", `${designTokens.layout.navigationDrawerWidth}px`);
    await browserExpect(menu.getByRole("button", { name: "Alternar tema" })).toHaveCSS("min-height", `${designTokens.sizing.touchTargetMinSize}px`);
    await browserExpect(menu.getByRole("link", { name: "Inicio" })).toHaveAttribute("href", "/es-PE/dashboard");
    await browserExpect(menu.getByRole("button", { name: "Cerrar menú" })).toBeFocused();
    await page.keyboard.press("Tab");
    await browserExpect(menu.getByRole("link", { name: "yoyos" })).toBeFocused();
    await page.keyboard.press("Escape");
    await browserExpect(menu).not.toBeVisible();
    await browserExpect(menuButton).toBeFocused();
    await menuButton.click();
    await menu.getByRole("button", { name: "Alternar tema" }).click();
    await browserExpect(page.locator("html")).not.toHaveClass(/dark/);
    await browserExpect(menu.getByRole("button", { name: "Cerrar sesión" })).toHaveCSS("color", "rgb(36, 35, 38)");
    await menu.getByRole("button", { name: "Cerrar menú" }).click();
    await browserExpect(menu).not.toBeVisible();
    await menuButton.click();
    await menu.getByRole("button", { name: "Cerrar sesión" }).click();
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
    await page.getByLabel("País").click();
    await page.getByRole("option", { name: "Colombia" }).click();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("No se recibió una respuesta válida");
    await browserExpect(page.getByRole("button", { name: "Crear empresa" })).toBeVisible();
    await browserExpect(page.getByLabel("País")).toHaveText("Colombia");
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
    await page.getByLabel("País").click();
    await page.getByRole("option", { name: "Colombia" }).click();
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
