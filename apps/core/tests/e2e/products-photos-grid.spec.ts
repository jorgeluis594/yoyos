import { browserExpect, prepareVerifiedCompany, test } from "./fixtures";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";

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
      await page.locator("[data-photo]").nth(1).getByRole("button").last().click();
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
