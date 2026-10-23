import { chromium, expect as browserExpect, request as browserRequest } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test as base } from "vitest";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const port = process.env.CORE_E2E_PORT ?? "4173";
const baseURL = `http://127.0.0.1:${port}`;

/** The subdomain a spec gives a company: unique per company and valid under the shared format. */
export const subdomainOf = (companyId: string) => `s${companyId.replaceAll("-", "").slice(0, 20)}`;

/** The brand address of `subdomain`, e.g. `http://fantasio.localhost:4173/productos/…`. `CATALOG_BASE_URL` is `http://localhost:<port>` in E2E. */
export const storeUrl = (subdomain: string, path = "/") => `http://${subdomain}.localhost:${port}${path}`;

/** Gives the company its subdomain and publishes its catalog directly, for specs about the buyer. Returns the brand address. */
export async function publishCatalog(companyId: string, subdomain = subdomainOf(companyId)) {
  await withTenantIsolation(companyId, async () => await prisma.company.update({ where: { id: companyId }, data: { catalogSubdomain: subdomain, catalogPublished: true } }));
  return storeUrl(subdomain);
}

export async function prepareVerifiedCompany(page: Page, input: { email: string; name: string; companyName: string; country: "PE" | "US" }) {
  const password = "test-password-123";
  const signup = await page.request.post("/api/auth/sign-up/email", { data: { name: input.name, email: input.email, password } });
  if (!signup.ok()) throw new Error(`Account setup failed: ${signup.status()}`);
  await systemPrisma.user.update({ where: { email: input.email }, data: { emailVerified: true } });
  const signin = await page.request.post("/api/auth/sign-in/email", { data: { email: input.email, password } });
  if (!signin.ok()) throw new Error(`Sign-in failed: ${signin.status()}`);
  const company = await page.request.post("/api/company", { data: { name: input.companyName, country: input.country } });
  const result = await company.json();
  if (!company.ok() || typeof result.companyId !== "string") throw new Error(`Company setup failed: ${company.status()}`);
  return result.companyId as string;
}

// Design-system selects are Base UI comboboxes: open the trigger, then pick an option by name or position.
export async function openOptions(page: Page, label: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  return page.getByRole("listbox").getByRole("option");
}

export async function chooseOption(page: Page, label: string, option: string | RegExp | number) {
  const options = await openOptions(page, label);
  await (typeof option === "number" ? options.nth(option) : options.filter({ hasText: option })).click();
}

export const selectedValue = (page: Page, name: string) => page.locator(`input[name="${name}"]`);

const test = base.extend<{ page: Page; request: APIRequestContext }>({
  page: async ({ task }, runFixture) => {
    void task;
    // Chromium resolves *.localhost to loopback by itself; the rule keeps it deterministic (IPv4 versus ::1).
    const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP *.localhost 127.0.0.1"] });
    const context = await browser.newContext({ baseURL });
    try { await runFixture(await context.newPage()); } finally { await browser.close(); }
  },
  request: async ({ task }, runFixture) => {
    void task;
    const context = await browserRequest.newContext({ baseURL });
    try { await runFixture(context); } finally { await context.dispose(); }
  },
});

export { browserExpect, expect, test };
