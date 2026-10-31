import { browserExpect, expect, prepareVerifiedCompany, test, waitForReactHydration } from "./fixtures";
import type { Page } from "@playwright/test";
import { prisma, systemPrisma, withTenantIsolation } from "../../src/shared/infrastructure/persistance";

const redirectUri = "https://claude.ai/api/mcp/auth_callback";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const password = "test-password-123";

async function cleanup(email: string, clientId: string | undefined, companyId: string | undefined) {
  if (clientId) await systemPrisma.oauthClient.deleteMany({ where: { clientId } });
  await systemPrisma.user.deleteMany({ where: { email } });
  if (companyId) await withTenantIsolation(companyId, async () => { await prisma.company.deleteMany({ where: { id: companyId } }); });
}

/** The agent registers itself and sends the owner's browser to authorize; the owner starts signed out. */
async function startAgentRequest(page: Page) {
  await page.route("https://claude.ai/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>Claude</p>" }));
  const registration = await page.request.post("/api/auth/oauth2/register", {
    data: { client_name: "Claude", redirect_uris: [redirectUri], token_endpoint_auth_method: "none" },
    headers: { origin: new URL(page.url() === "about:blank" ? "http://127.0.0.1" : page.url()).origin, "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 250) + 1}` },
  });
  const { client_id: clientId } = await registration.json();
  if (typeof clientId !== "string") throw new Error(`Registration failed: ${registration.status()}`);
  await page.context().clearCookies();
  const query = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: "orders:read offline_access",
    code_challenge: challenge, code_challenge_method: "S256", state: "s1", resource: `${new URL(page.url() === "about:blank" ? "http://127.0.0.1" : page.url()).origin}/mcp`,
  });
  return { clientId, authorizeUrl: `/api/auth/oauth2/authorize?${query}` };
}

async function connectAgent(page: Page, email: string) {
  const { clientId, authorizeUrl } = await startAgentRequest(page);
  const response = await page.goto(authorizeUrl);
  await browserExpect(page).toHaveURL(/\/login\?/);
  await browserExpect(page.getByText("Inicia sesión para conectar tu asistente.")).toBeVisible();
  await waitForReactHydration(page, "form");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await browserExpect(page).toHaveURL(/\/assistants\/authorize\?/);
  void response;
  return clientId;
}

test("an owner signs in from an agent request, allows access and sees the agent listed in Asistentes de IA", async ({ page }) => {
  const email = `assistants-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  let clientId: string | undefined;
  try {
    await page.goto("/login");
    companyId = await prepareVerifiedCompany(page, { email, name: "Rosa", companyName: "Tienda Rosa", country: "PE" });
    clientId = await connectAgent(page, email);

    await browserExpect(page.getByRole("heading", { level: 1 })).toHaveText("Claude quiere leer los pedidos de Tienda Rosa");
    await browserExpect(page.getByText("Volverá a claude.ai")).toBeVisible();
    await browserExpect(page.getByText(`Conectado como ${email}`)).toBeVisible();
    await waitForReactHydration(page, "button");
    const framing = await page.request.get(page.url());
    expect(framing.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(framing.headers()["x-frame-options"]).toBe("DENY");

    await page.getByRole("button", { name: "Permitir acceso" }).click();
    await page.waitForURL(/claude\.ai\/api\/mcp\/auth_callback\?.*code=/);

    await page.goto("/es-PE/settings/assistants");
    await browserExpect(page.getByRole("heading", { name: "Asistentes de IA", level: 1 })).toBeVisible();
    const row = page.locator("li[data-connection]");
    await browserExpect(row).toHaveCount(1);
    await browserExpect(row).toContainText("Claude");
    await browserExpect(row).toContainText("claude.ai");
    await browserExpect(row).toContainText("Sin uso todavía");
  } finally { await cleanup(email, clientId, companyId); }
});

test("an owner disconnects an agent from Asistentes de IA", async ({ page }) => {
  const email = `assistants-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  let clientId: string | undefined;
  try {
    await page.goto("/login");
    companyId = await prepareVerifiedCompany(page, { email, name: "Rosa", companyName: "Tienda Rosa", country: "PE" });
    clientId = await connectAgent(page, email);
    await waitForReactHydration(page, "button");
    await page.getByRole("button", { name: "Permitir acceso" }).click();
    await page.waitForURL(/claude\.ai\/api\/mcp\/auth_callback\?.*code=/);

    await page.goto("/es-PE/settings/assistants");
    await waitForReactHydration(page, "button");
    await page.getByRole("button", { name: "Desconectar", exact: true }).click();
    await browserExpect(page.getByRole("dialog")).toContainText("¿Desconectar Claude, conectado el");
    await page.getByRole("button", { name: "Desconectar asistente" }).click();
    await browserExpect(page.locator("li[data-connection]")).toHaveCount(0);
    await browserExpect(page.getByText(/Desconectaste Claude, conectado el/)).toBeVisible();
    await browserExpect(page.getByText("Todavía no conectaste ningún asistente.")).toBeVisible();
    expect(await withTenantIsolation(companyId, async () => await prisma.assistantConnection.count())).toBe(0);
    expect(await systemPrisma.oauthConsent.count({ where: { clientId } })).toBe(0);
  } finally { await cleanup(email, clientId, companyId); }
});
