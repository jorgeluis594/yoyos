import { describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { CompanyId, UserId } from "@shared/identity";
import type { AssistantConnectionId } from "@core/src/features/assistants/domain/assistant-connection";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import type { ProjectableSaleDates, ProjectableStockedProduct } from "@core/src/features/assistants/domain/product-sales-projection";
import { checkToolModules, maxToolOutputBytes } from "@core/src/features/assistants/presentation/tool-registry";
import { createSalesToolsModule } from "@core/src/features/assistants/presentation/tools/sales-tools";
import { createUnsoldProductsTool, type UnsoldProductsAnswer, type UnsoldProductsDependencies, type UnsoldProductsOutput } from "@core/src/features/assistants/presentation/tools/unsold-products-tool";
import { pageOutOfRangeMessage } from "@core/src/features/assistants/presentation/tools/products-texts";
import { salesReadFailureMessage } from "@core/src/features/assistants/presentation/tools/sales-texts";

const access: AssistantAccess = {
  companyId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0002" as CompanyId, userId: "user-1" as UserId,
  connectionId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0001" as AssistantConnectionId, scopes: ["orders:read", "products:read"], lastUsedAt: null,
};
const now = new Date("2026-11-05T15:00:00Z");
const october = { desde: "2026-10-01", hasta: "2026-10-31" };

const product = (name: string, total: number, variantIds: readonly string[], createdAt = "2026-01-01", stock: Partial<ProjectableStockedProduct["stock"]> = {}): ProjectableStockedProduct =>
  ({ id: `id-${name}`, name, createdAt: new Date(`${createdAt}T15:00:00Z`), stock: { total, soldOut: 0, low: 0, onlyLevel: null, ...stock }, variantIds });
const dates = (variantId: string, soldInWindow: boolean, lastBefore: string | null, firstAfter: string | null = null): ProjectableSaleDates =>
  ({ variantId, soldInWindow, lastBefore: lastBefore ? new Date(`${lastBefore}T15:00:00Z`) : null, firstAfter: firstAfter ? new Date(`${firstAfter}T15:00:00Z`) : null });

// The October example: five products checked; Polo básico and Casaca sold, so Bufanda, Gorro and Polo estampado did not.
const exampleAnswer = (): UnsoldProductsAnswer => ({
  storeHasProducts: true, matching: 8, withStock: 6,
  checked: [product("Polo básico", 20, ["polo"]), product("Casaca", 4, ["casaca"]), product("Bufanda", 12, ["bufanda"], "2026-01-01", { low: 1 }), product("Gorro", 8, ["gorro"]),
    product("Polo estampado", 6, ["estampado"], "2026-10-25")],
  dates: [dates("polo", true, null), dates("casaca", true, null), dates("bufanda", false, "2026-08-14"), dates("gorro", false, null), dates("estampado", false, null)],
});

function setup(answer: UnsoldProductsAnswer = exampleAnswer()) {
  const read = vi.fn<UnsoldProductsDependencies["read"]>(async () => ok(answer));
  const tool = createUnsoldProductsTool({ clock: () => now, appLink: (id) => `https://app.yoyos.lat/products/${id}`, read });
  const run = async (raw: unknown) => {
    const parsed = tool.inputSchema.safeParse(raw);
    if (!parsed.success) return { parsed } as const;
    return { parsed, run: await tool.run(parsed.data, access) } as const;
  };
  return { tool, read, run };
}
const outputOf = async (raw: unknown, answer?: UnsoldProductsAnswer): Promise<UnsoldProductsOutput> => {
  const result = (await setup(answer).run(raw)).run!;
  if (!result.success) throw new Error(result.error.message);
  return result.data.output;
};
const none = (overrides: Partial<UnsoldProductsAnswer>): UnsoldProductsAnswer => ({ storeHasProducts: true, matching: 0, withStock: 0, checked: [], dates: [], ...overrides });

describe("productos_sin_ventas", () => {
  test("lists Bufanda, Gorro and Polo estampado of the October example in order with their texts", async () => {
    const output = await outputOf(october);
    expect(output.hoy).toBe("Hoy es 05/11/2026");
    expect(output.resumen).toBe("3 de tus 5 productos con stock no se vendieron del 01/10/2026 al 31/10/2026.");
    expect(output.stock_nota).toBe("El stock es el de hoy.");
    expect(output.productos).toEqual([
      { id: "id-Bufanda", nombre: "Bufanda", stock: "Stock: 12 · 1 con stock bajo", fechas: "Última venta antes del periodo: 14/08/2026", enlace: "https://app.yoyos.lat/products/id-Bufanda" },
      { id: "id-Gorro", nombre: "Gorro", stock: "Stock: 8", fechas: "Ninguna venta antes del periodo", enlace: "https://app.yoyos.lat/products/id-Gorro" },
      { id: "id-Polo estampado", nombre: "Polo estampado", stock: "Stock: 6", fechas: "Ninguna venta antes del periodo · Creado el 25/10/2026", enlace: "https://app.yoyos.lat/products/id-Polo estampado" },
    ]);
    expect(output.aviso).toBeUndefined();
  });

  test("says Volvió a venderse only for a period that ended before today and asks the read for first sales after it", async () => {
    const answer: UnsoldProductsAnswer = { ...exampleAnswer(), checked: [product("Casaca", 4, ["casaca"])], dates: [dates("casaca", false, "2026-08-20", "2026-10-10")] };
    const { run, read } = setup(answer);
    const september = { desde: "2026-09-01", hasta: "2026-09-30" };
    const result = (await run(september)).run!;
    expect(read).toHaveBeenCalledWith({ period: { from: "2026-09-01", through: "2026-09-30", cutToToday: false }, needFirstAfter: true }, access);
    expect(result.success && result.data.output.productos[0]!.fechas).toBe("Última venta antes del periodo: 20/08/2026 · Volvió a venderse el 10/10/2026");
    await run({ desde: "2026-10-07", hasta: "2026-11-05" });
    expect(read).toHaveBeenLastCalledWith({ period: { from: "2026-10-07", through: "2026-11-05", cutToToday: false }, needFirstAfter: false }, access);
    const open = (await outputOf({ desde: "2026-10-07" }, answer));
    expect(open.productos[0]!.fechas).toBe("Última venta antes del periodo: 20/08/2026");
  });

  test("picks the empty text in order: no products, no match, no stock, all created after, all sold", async () => {
    expect((await outputOf(october, none({ storeHasProducts: false }))).mensaje).toBe("Tu tienda todavía no tiene productos.");
    expect((await outputOf({ ...october, texto: "zapato" }, none({}))).mensaje).toBe('Ningún producto coincide con "zapato".');
    expect((await outputOf(october, none({ matching: 3 }))).mensaje).toBe("Ninguno de tus productos tiene stock hoy, así que no hay productos parados que revisar.");
    expect((await outputOf({ ...october, texto: "casac" }, none({ matching: 3 }))).mensaje).toBe('Ninguno de tus productos que coinciden con "casac" tiene stock hoy, así que no hay productos parados que revisar.');
    expect((await outputOf({ desde: "2026-09-01", hasta: "2026-09-30" }, none({ matching: 3, withStock: 2 }))).mensaje)
      .toBe("Tus productos con stock se crearon después del 30/09/2026: ninguno estaba a la venta en esas fechas.");
    const allSold: UnsoldProductsAnswer = { ...exampleAnswer(), checked: exampleAnswer().checked.slice(0, 2), dates: exampleAnswer().dates.slice(0, 2) };
    expect((await outputOf(october, allSold)).mensaje).toBe("Tus 2 productos con stock tuvieron ventas del 01/10/2026 al 31/10/2026.");
    expect((await outputOf({ ...october, texto: "polo" }, allSold)).mensaje).toBe('Tus 2 productos con stock que coinciden con "polo" tuvieron ventas del 01/10/2026 al 31/10/2026.');
    const single: UnsoldProductsAnswer = { ...exampleAnswer(), checked: exampleAnswer().checked.slice(0, 1), dates: exampleAnswer().dates.slice(0, 1) };
    expect((await outputOf(october, single)).mensaje).toBe("Tu único producto con stock tuvo ventas del 01/10/2026 al 31/10/2026.");
    for (const empty of [none({ storeHasProducts: false }), allSold]) expect((await setup(empty).run(october)).run).toMatchObject({ success: true, data: { empty: true } });
  });

  test("uses the singular and names the filter in the header", async () => {
    const answer: UnsoldProductsAnswer = { ...exampleAnswer(), checked: [product("Casaca", 4, ["c1"]), product("Casaca vieja", 2, ["c2"])], dates: [dates("c1", true, null), dates("c2", false, null)] };
    expect((await outputOf({ ...october, texto: "casac" }, answer)).resumen).toBe('1 de tus 2 productos con stock que coinciden con "casac" no se vendió del 01/10/2026 al 31/10/2026.');
    const lone: UnsoldProductsAnswer = { ...exampleAnswer(), checked: [product("Gorro", 2, ["g"])], dates: [dates("g", false, null)] };
    expect((await outputOf(october, lone)).resumen).toBe("Tu único producto con stock no se vendió del 01/10/2026 al 31/10/2026.");
  });

  test("adds the short-period line under 14 days", async () => {
    const short = await outputOf({ desde: "2026-11-01", hasta: "2026-11-03" });
    expect(short.aviso).toBe("Este periodo tiene solo 3 días: para ver lo que no rota, pide al menos un mes.");
    expect((await outputOf({ desde: "2026-10-01", hasta: "2026-10-14" })).aviso).toBeUndefined();
    expect((await outputOf({ desde: "2026-11-05", hasta: "2026-11-05" })).aviso).toBe("Este periodo tiene solo 1 día: para ver lo que no rota, pide al menos un mes.");
  });

  test("states the period read when a future hasta was cut to today", async () => {
    const { run, read } = setup();
    const result = (await run({ desde: "2026-10-07", hasta: "2026-12-31" })).run!;
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ period: { from: "2026-10-07", through: "2026-11-05", cutToToday: true } }), access);
    expect(result.success && result.data.output.resumen).toContain("del 07/10/2026 al 05/11/2026 (hasta hoy)");
  });

  test("pages 20 products with the more line and answers a page beyond the last with the existing page text", async () => {
    const checked = Array.from({ length: 23 }, (_, index) => product(`P${String(index).padStart(2, "0")}`, 100 - index, [`v${index}`]));
    const answer: UnsoldProductsAnswer = { storeHasProducts: true, matching: 23, withStock: 23, checked, dates: [] };
    const first = await outputOf(october, answer);
    expect(first).toMatchObject({ pagina: 1, total: 23, hay_mas: "hay más: pide la página 2" });
    expect(first.productos).toHaveLength(20);
    const second = await outputOf({ ...october, pagina: 2 }, answer);
    expect(second.productos.map((item) => item.nombre)).toEqual(["P20", "P21", "P22"]);
    expect(second.hay_mas).toBeUndefined();
    expect(await outputOf({ ...october, pagina: 3 }, answer)).toMatchObject({ mensaje: pageOutOfRangeMessage(23), total: 23, productos: [] });
  });

  test("refuses a period of 400 days, a desde after today, a reversed range and only hasta with their texts and calls no port", async () => {
    const { run, read } = setup();
    const refused = async (raw: unknown) => { const result = (await run(raw)).run!; return result.success ? "answered" : result.error; };
    expect(await refused({ desde: "2025-09-01", hasta: "2026-10-05" })).toEqual({ code: "INVALID_INPUT", message: "El periodo puede tener hasta 366 días. Pide uno más corto." });
    expect(await refused({ desde: "2026-11-06" })).toEqual({ code: "INVALID_INPUT", message: "La fecha inicial (2026-11-06) es posterior a hoy (2026-11-05)." });
    expect(await refused({ desde: "2026-10-07", hasta: "2026-10-01" })).toEqual({ code: "INVALID_INPUT", message: "La fecha final (2026-10-01) es anterior a la inicial (2026-10-07)." });
    expect(await refused({ hasta: "2026-10-31" })).toEqual({ code: "INVALID_INPUT", message: "Indica también la fecha inicial (desde)." });
    expect(read).not.toHaveBeenCalled();
  });

  test("passes the reading-failure text the port chose and never an empty list", async () => {
    const tool = createUnsoldProductsTool({ clock: () => now, appLink: (id) => id, read: async () => err({ code: "FAILURE", message: salesReadFailureMessage }) });
    expect(await tool.run({ ...october, pagina: 1 }, access)).toEqual({ success: false, error: { code: "FAILURE", message: salesReadFailureMessage } });
  });

  test("a page of 20 products at maximum name lengths fits 24 KB and validates", () => {
    const { tool } = setup();
    expect(checkToolModules([createSalesToolsModule([tool])])).toEqual([]);
    const [sample] = tool.sampleOutputs;
    expect(sample!.productos).toHaveLength(20);
    expect(Buffer.byteLength(JSON.stringify(sample))).toBeLessThan(maxToolOutputBytes);
    expect(tool.outputSchema.safeParse(sample).success).toBe(true);
  });
});
