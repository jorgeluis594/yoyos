import { browserExpect, prepareVerifiedCompany, test } from "./fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { Page } from "@playwright/test";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
const publicBase = `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}/test-images`;
const file = (name: string, buffer = png) => ({ name, mimeType: "image/png", buffer });

const texts = {
  es: { path: "/es-PE/products/new", chips: ["Subiendo…", "No se subió", "Se quitará"], remove: "Quitar la foto 1 de 4" },
  pt: { path: "/pt-BR/products/new", chips: ["Enviando…", "Não enviada", "Será removida"], remove: "Remover a foto 1 de 4" },
} as const;

for (const language of ["es", "pt"] as const) {
  test(`state chips fit whole inside the 68 px tiles of the form column in ${language}`, async ({ page }) => {
    const email = `chips-${crypto.randomUUID()}@example.test`;
    const spec = texts[language];
    let release: (() => void) | null = null;
    try {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.route("**/test-images/*", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
      await page.route("**/api/images", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const name = (route.request().postData() ?? "").match(/filename="([^"]+)"/)?.[1] ?? "x.png";
        if (name === "falla.png") return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL_ERROR", message: "x" }) });
        if (name === "lenta.png") await new Promise<void>((resolve) => { release = resolve; });
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: crypto.randomUUID(), url: `${publicBase}/${name}` }) });
      });
      await prepareVerifiedCompany(page, { email, name: "Ana Foto", companyName: "Empresa Foto", country: "PE" });
      await page.goto(spec.path);
      await page.locator("input[type=file]").setInputFiles([file("a.png"), file("b.png"), file("falla.png"), file("lenta.png")]);
      await browserExpect(page.locator("[data-photo]")).toHaveCount(4);
      await browserExpect(page.getByText(spec.chips[1], { exact: true })).toBeVisible();
      await browserExpect(page.getByText(spec.chips[0], { exact: true })).toBeVisible();
      await page.locator("[data-photo]").nth(1).hover();
      await page.locator("[data-photo]").nth(1).locator("[data-action=remove]").click();
      await browserExpect(page.getByText(spec.chips[2], { exact: true })).toBeVisible();

      const chips = await page.locator("[data-photo] span.absolute.bottom-0\\.5").evaluateAll((nodes) => nodes.map((node) => {
        const box = node.getBoundingClientRect();
        const tile = node.closest("[data-photo]")!.getBoundingClientRect();
        return { text: node.textContent, fits: node.scrollWidth <= node.clientWidth, size: parseFloat(getComputedStyle(node).fontSize), inside: box.left >= tile.left && box.right <= tile.right, tile: Math.round(tile.width) };
      }));
      browserExpect(chips.map((chip) => chip.text).sort()).toEqual([...spec.chips].sort());
      for (const chip of chips) browserExpect(chip, chip.text ?? "").toMatchObject({ fits: true, inside: true });
      for (const chip of chips) browserExpect(chip.size).toBeGreaterThanOrEqual(12);
      for (const chip of chips) browserExpect(chip.tile).toBeLessThan(75);
    } finally {
      (release as (() => void) | null)?.();
      await systemPrisma.user.deleteMany({ where: { email } });
    }
  });
}

async function mockImages(page: Page, saved: ReadonlyMap<string, string> = new Map()) {
  await page.route("**/test-images/*", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
  await page.route("**/api/images", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const name = (route.request().postData() ?? "").match(/filename="([^"]+)"/)?.[1] ?? "x.png";
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: saved.get(name) ?? crypto.randomUUID(), url: `${publicBase}/${name}` }) });
  });
}
const boxHeight = (page: Page) => page.locator("[aria-label='Fotos del producto'], [aria-label='Fotos do produto']").evaluate((node) => Math.round(node.getBoundingClientRect().height));
const photos = (count: number) => Array.from({ length: count }, (_, at) => file(`f${at + 1}.png`));
const cleanup = async (email: string) => {
  const user = await systemPrisma.user.findUnique({ where: { email }, select: { companyId: true } });
  await systemPrisma.user.deleteMany({ where: { email } });
  if (user?.companyId) {
    await withTenantIsolation(user.companyId, async () => {
      for (const model of [prisma.productPhoto, prisma.productStock, prisma.productVariant, prisma.productOption, prisma.product, prisma.image] as const) await (model as unknown as { deleteMany: (args: object) => Promise<unknown> }).deleteMany({ where: { companyId: user.companyId! } });
      await prisma.company.delete({ where: { id: user.companyId! } });
    });
  }
};

test("the photos box keeps the same height with 1, 4 and 8 photos and while photos ahead of the primary are marked", async ({ page }) => {
  const email = `height-${crypto.randomUUID()}@example.test`;
  try {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await mockImages(page);
    await prepareVerifiedCompany(page, { email, name: "Ana Foto", companyName: "Empresa Foto", country: "PE" });
    await page.goto("/es-PE/products/new");
    const empty = await boxHeight(page);
    const input = page.locator("input[type=file]");
    await input.setInputFiles(photos(1));
    await browserExpect(page.getByText("1 de 8 fotos")).toBeVisible();
    browserExpect(await boxHeight(page)).toBe(empty);
    await input.setInputFiles(photos(3));
    await browserExpect(page.getByText("4 de 8 fotos")).toBeVisible();
    browserExpect(await boxHeight(page)).toBe(empty);
    await input.setInputFiles(photos(4));
    await browserExpect(page.getByText("8 de 8 fotos. Llegaste al máximo.")).toBeVisible();
    browserExpect(await boxHeight(page)).toBe(empty);
    // Marking from the front passes the primary along the row: the reviewer's repro, and every leading count up to seven.
    for (let marked = 1; marked <= 7; marked += 1) {
      await page.getByRole("button", { name: `Quitar la foto ${marked} de 8` }).click();
      browserExpect(await boxHeight(page), `${marked} marked`).toBe(empty);
    }
    await page.getByRole("button", { name: "Quitar la foto 8 de 8" }).click();
    browserExpect(await boxHeight(page), "all marked").toBe(empty);
  } finally { await cleanup(email); }
});

for (const language of ["es", "pt"] as const) {
  test(`the marks of saved photos fit whole in 1×1 tiles and the box keeps its height after saving, in ${language}`, async ({ page }) => {
    const email = `saved-${crypto.randomUUID()}@example.test`;
    const expected = language === "es" ? ["Se eliminará"] : ["Será excluída"];
    const remove = (n: number) => language === "es" ? `Quitar la foto ${n} de 4` : `Remover a foto ${n} de 4`;
    try {
      await page.setViewportSize({ width: 1280, height: 1000 });
      const ids = new Map<string, string>();
      await mockImages(page, ids);
      const tenantId = await prepareVerifiedCompany(page, { email, name: "Ana Foto", companyName: "Empresa Foto", country: "PE" });
      for (const { name } of photos(4)) ids.set(name, (await withTenantIsolation(tenantId, async () => await prisma.image.create({ data: { companyId: tenantId, storageKey: name } }))).id);
      await page.goto(language === "es" ? "/es-PE/products/new" : "/pt-BR/products/new");
      await page.locator("#name").fill("Polo perro rayas");
      await page.locator("#salePrice").fill("30");
      await page.locator("#initialStock").fill("5");
      await page.locator("input[type=file]").setInputFiles(photos(4));
      await browserExpect(page.locator("[data-photo] button[data-action=remove]")).toHaveCount(4);
      const before = await boxHeight(page);
      await page.locator("form button[type=submit]").click();
      await browserExpect(page).toHaveURL(/\/products\/[0-9a-f-]+$/);
      await browserExpect(page.locator("[data-photo]")).toHaveCount(4);
      browserExpect(await boxHeight(page)).toBe(before);
      for (const n of [1, 2, 3]) {
        await page.getByRole("button", { name: remove(n) }).click();
        browserExpect(await boxHeight(page), `${n} marked`).toBe(before);
      }
      const chips = await page.locator("[data-photo] span.absolute.bottom-0\\.5").evaluateAll((nodes) => nodes.map((node) => ({ text: node.textContent, fits: node.scrollWidth <= node.clientWidth, tile: Math.round(node.closest("[data-photo]")!.getBoundingClientRect().width) })));
      const small = chips.filter((chip) => chip.tile < 75);
      browserExpect(small.length).toBeGreaterThan(0);
      browserExpect(small.map((chip) => chip.text)).toContain(expected[0]);
      for (const chip of small) browserExpect(chip, chip.text ?? "").toMatchObject({ fits: true });
    } finally { await cleanup(email); }
  });
}
