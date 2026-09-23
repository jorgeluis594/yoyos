import { chromium, expect as browserExpect, request as browserRequest } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test as base } from "vitest";

const baseURL = "http://127.0.0.1:4173";

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
