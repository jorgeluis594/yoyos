import { expect, test } from "@playwright/test";
import { authPrisma } from "../../src/shared/infrastructure/prisma";

test("register, persist session, sign out, reject bad password, and sign in", async ({ page }) => {
  const email = `auth-${crypto.randomUUID()}@example.test`;

  try {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);

    await page.getByRole("link", { name: "Regístrate" }).click();
    await page.getByLabel("Nombre").fill("Ana Prueba");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("test-password-123");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Hola, Ana Prueba" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Hola, Ana Prueba" })).toBeVisible();

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("wrong-password");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill("test-password-123");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  } finally {
    await authPrisma.user.deleteMany({ where: { email } });
  }
});
