import { chromium, expect as browserExpect, request as browserRequest } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test as base } from "vitest";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";

const baseURL = `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}`;

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
    const browser = await chromium.launch();
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
