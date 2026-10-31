import { describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { CompanyId, UserId } from "@shared/identity";
import type { AssistantConnectionId } from "@core/src/features/assistants/domain/assistant-connection";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import type { ProjectableDescribedVariant, ProjectableSoldVariant } from "@core/src/features/assistants/domain/product-sales-projection";
import { checkToolModules, maxToolOutputBytes } from "@core/src/features/assistants/presentation/tool-registry";
import { createSalesToolsModule } from "@core/src/features/assistants/presentation/tools/sales-tools";
import { createBestSellersTool, type BestSellersAnswer, type BestSellersDependencies, type BestSellersOutput } from "@core/src/features/assistants/presentation/tools/best-sellers-tool";
import { noProductMessage, pageOutOfRangeMessage } from "@core/src/features/assistants/presentation/tools/products-texts";
import { salesReadFailureMessage, tooManyOrdersMessage } from "@core/src/features/assistants/presentation/tools/sales-texts";

const access: AssistantAccess = {
  companyId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0002" as CompanyId, userId: "user-1" as UserId,
  connectionId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0001" as AssistantConnectionId, scopes: ["orders:read", "products:read"], lastUsedAt: null,
};
const pen = (amount: number) => ({ amount, currency: "PEN" as const });
const usd = (amount: number) => ({ amount, currency: "USD" as const });
const sold = (variantId: string, units: number, amount: number, currency: "PEN" | "USD" = "PEN"): ProjectableSoldVariant => ({ variantId, currency, units, amount: { amount, currency } });
const described = (variantId: string, productId: string, productName: string, values: readonly string[], matchesText = true): ProjectableDescribedVariant => ({ variantId, productId, productName, values, matchesText });
const poloId = "00000000-0000-4000-8000-000000000001";

// «Hoy es 05/11/2026»: October 2026 has ended and was asked for explicitly.
const now = new Date("2026-11-05T15:00:00Z");
const october = { desde: "2026-10-01", hasta: "2026-10-31" };
const answerOf = (overrides: Partial<Extract<BestSellersAnswer, { kind: "sold" }>> = {}): BestSellersAnswer => ({
  kind: "sold", storeCurrency: "PEN",
  sold: {
    variants: [sold("polo-m", 5, 175), sold("polo-l", 3, 105), sold("casaca-m", 2, 240), sold("casaca-l", 1, 120)],
    currencies: [{ currency: "PEN", orders: 4, units: 11, amount: pen(640) }],
  },
  described: [described("polo-m", "polo", "Polo básico", ["M", "Azul"]), described("polo-l", "polo", "Polo básico", ["L", "Negro"]),
    described("casaca-m", "casaca", "Casaca", ["M", "Negro"]), described("casaca-l", "casaca", "Casaca", ["L", "Negro"])],
  ...overrides,
});

function setup(answer: BestSellersAnswer = answerOf()) {
  const read = vi.fn<BestSellersDependencies["read"]>(async () => ok(answer));
  const tool = createBestSellersTool({ clock: () => now, appLink: (id) => `https://app.yoyos.lat/products/${id}`, read });
  const run = async (raw: unknown) => {
    const parsed = tool.inputSchema.safeParse(raw);
    if (!parsed.success) return { parsed } as const;
    return { parsed, run: await tool.run(parsed.data, access) } as const;
  };
  return { tool, read, run };
}
const outputOf = async (raw: unknown, answer?: BestSellersAnswer): Promise<BestSellersOutput> => {
  const { run } = setup(answer);
  const result = (await run(raw)).run!;
  if (!result.success) throw new Error(result.error.message);
  return result.data.output;
};

describe("lo_mas_vendido", () => {
  test("ranks the October example by units with the header, shares and the variants sold", async () => {
    const output = await outputOf(october);
    expect(output.hoy).toBe("Hoy es 05/11/2026");
    expect(output.resumen).toBe("Del 01/10/2026 al 31/10/2026: 11 unidades de 2 productos, S/ 640.00 en productos.");
    expect(output).toMatchObject({ pagina: 1, total: 2 });
    expect(output.productos[0]).toMatchObject({ nombre: "Polo básico", unidades: 8, monto: "S/ 280.00", participacion: "44% de tus ventas de productos del periodo" });
    expect(output.productos[0]!.variantes).toEqual([{ combinacion: "M / Azul", unidades: 5, monto: "S/ 175.00" }, { combinacion: "L / Negro", unidades: 3, monto: "S/ 105.00" }]);
    expect(output.productos[1]).toMatchObject({ nombre: "Casaca", unidades: 3, monto: "S/ 360.00", participacion: "56% de tus ventas de productos del periodo" });
    expect((await outputOf({ ...october, orden: "monto" })).productos.map((item) => item.nombre)).toEqual(["Casaca", "Polo básico"]);
  });

  test("reads the period as whole Lima days and states the one actually read when a future hasta was cut", async () => {
    const { run, read } = setup();
    const result = (await run({ desde: "2026-11-01", hasta: "2026-11-30" })).run!;
    expect(result.success && result.data.output.resumen).toMatch(/^Del 01\/11\/2026 al 05\/11\/2026 \(hasta hoy\): /);
    expect(read).toHaveBeenCalledWith({ kind: "ranking", period: { from: "2026-11-01", through: "2026-11-05", cutToToday: true } }, access);
    await run({});
    expect(read).toHaveBeenLastCalledWith({ kind: "ranking", period: { from: "2026-11-01", through: "2026-11-05", cutToToday: false } }, access);
  });

  test("keeps the whole-period share and names the denominator when texto narrows the ranking", async () => {
    const narrowed = answerOf({ described: answerOf().kind === "sold" ? [described("polo-m", "polo", "Polo básico", ["M", "Azul"]), described("polo-l", "polo", "Polo básico", ["L", "Negro"]),
      described("casaca-m", "casaca", "Casaca", ["M", "Negro"], false), described("casaca-l", "casaca", "Casaca", ["L", "Negro"], false)] : [] });
    const { run, read } = setup(narrowed);
    const result = (await run({ ...october, texto: "polo" })).run!;
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ kind: "ranking", text: "polo" }), access);
    const output = result.success ? result.data.output : undefined;
    expect(output?.resumen).toBe('Del 01/10/2026 al 31/10/2026, productos que coinciden con "polo": 8 unidades de 1 producto, S/ 280.00 de los S/ 640.00 que vendiste en productos.');
    expect(output?.productos).toHaveLength(1);
    expect(output?.productos[0]!.participacion).toBe("44% de tus ventas de productos del periodo");
  });

  test("shows three variants and the remaining count, and every variant for one product with its header", async () => {
    const variants = ["a", "b", "c", "d", "e"].map((id, index) => sold(id, 5 - index, (5 - index) * 10));
    const names = variants.map((variant, index) => described(variant.variantId, poloId, "Polo básico", [`T${index}`]));
    const answer = answerOf({ sold: { variants, currencies: [{ currency: "PEN", orders: 5, units: 15, amount: pen(150) }] }, described: names });
    const ranked = await outputOf(october, answer);
    expect(ranked.productos[0]!.variantes).toHaveLength(3);
    expect(ranked.productos[0]!.mas_variantes).toBe("y 2 variantes más: pide este producto para verlas todas");
    const one = await outputOf({ ...october, producto: poloId }, answer);
    expect(one.productos[0]!.variantes).toHaveLength(5);
    expect(one.productos[0]!.mas_variantes).toBeUndefined();
    expect(one.resumen).toBe('"Polo básico" del 01/10/2026 al 31/10/2026: 15 unidades, S/ 150.00, 100% de tus ventas de productos del periodo (S/ 150.00).');
    expect(one.productos[0]!.mas_variantes).toBeUndefined();
    const singular = await outputOf(october, answerOf({ sold: { variants: variants.slice(0, 4), currencies: [{ currency: "PEN", orders: 4, units: 14, amount: pen(140) }] }, described: names }));
    expect(singular.productos[0]!.mas_variantes).toBe("y 1 variante más: pide este producto para verlas todas");
  });

  test("a product without options shows its line and no variant line", async () => {
    const answer = answerOf({ sold: { variants: [sold("g", 4, 100)], currencies: [{ currency: "PEN", orders: 1, units: 4, amount: pen(100) }] }, described: [described("g", "gorro", "Gorro", [])] });
    const output = await outputOf(october, answer);
    expect(output.productos[0]).not.toHaveProperty("variantes");
    expect(output.resumen).toBe("Del 01/10/2026 al 31/10/2026: 4 unidades de 1 producto, S/ 100.00 en productos.");
  });

  test("uses the singular for one unit and one product", async () => {
    const answer = answerOf({ sold: { variants: [sold("g", 1, 30)], currencies: [{ currency: "PEN", orders: 1, units: 1, amount: pen(30) }] }, described: [described("g", "gorro", "Gorro", [])] });
    expect((await outputOf(october, answer)).resumen).toBe("Del 01/10/2026 al 31/10/2026: 1 unidad de 1 producto, S/ 30.00 en productos.");
  });

  test("ranks only the store currency and adds one line per other currency, filtered without order count", async () => {
    const mixed = answerOf({ sold: {
      variants: [...(answerOf() as Extract<BestSellersAnswer, { kind: "sold" }>).sold.variants, sold("polo-m", 3, 90, "USD")],
      currencies: [{ currency: "PEN", orders: 4, units: 11, amount: pen(640) }, { currency: "USD", orders: 1, units: 3, amount: usd(90) }],
    } });
    const output = await outputOf(october, mixed);
    expect(output.resumen).toContain("11 unidades de 2 productos, S/ 640.00 en productos");
    expect(output.otras_monedas).toEqual(["Además vendiste en USD: 1 pedido, 3 unidades, USD 90.00 en productos, fuera de este ranking."]);
    const one = await outputOf({ ...october, producto: poloId }, mixed);
    expect(one.otras_monedas).toEqual(['Además vendiste "Polo básico" en USD: 3 unidades, USD 90.00, fuera de estas cifras.']);
    const text = await outputOf({ ...october, texto: "polo" }, mixed);
    expect(text.otras_monedas).toEqual(['Además vendiste en USD, entre los productos que coinciden con "polo": 3 unidades, USD 90.00, fuera de estas cifras.']);
  });

  test("with October sales only in USD answers No vendiste productos en PEN del … followed by the USD line", async () => {
    const onlyUsd = answerOf({ sold: { variants: [sold("polo-m", 3, 90, "USD")], currencies: [{ currency: "USD", orders: 1, units: 3, amount: usd(90) }] } });
    const output = await outputOf(october, onlyUsd);
    expect(output).toMatchObject({ mensaje: "No vendiste productos en PEN del 01/10/2026 al 31/10/2026.", total: 0, productos: [] });
    expect(output.otras_monedas).toEqual(["Además vendiste en USD: 1 pedido, 3 unidades, USD 90.00 en productos, fuera de este ranking."]);
    const { run } = setup(onlyUsd);
    expect((await run(october)).run).toMatchObject({ success: true, data: { empty: true } });
  });

  test("answers the empty texts: no sales at all, texto without sales and a producto that sold nothing", async () => {
    const none = answerOf({ sold: { variants: [], currencies: [] } });
    expect((await outputOf(october, none)).mensaje).toBe("No vendiste productos del 01/10/2026 al 31/10/2026.");
    const gorro = answerOf({ described: (answerOf() as Extract<BestSellersAnswer, { kind: "sold" }>).described.map((variant) => ({ ...variant, matchesText: false })) });
    expect((await outputOf({ ...october, texto: "gorro" }, gorro)).mensaje).toBe('Ningún producto que coincida con "gorro" se vendió del 01/10/2026 al 31/10/2026.');
    const unsold = answerOf({ sold: { variants: [], currencies: [{ currency: "PEN", orders: 4, units: 11, amount: pen(640) }] }, described: [described("polo-m", poloId, "Polo básico", ["M"])] });
    expect((await outputOf({ ...october, producto: poloId }, unsold)).mensaje).toBe('"Polo básico" no tuvo ventas del 01/10/2026 al 31/10/2026.');
    const onlyUsd = answerOf({ sold: { variants: [sold("polo-m", 3, 90, "USD")], currencies: [{ currency: "USD", orders: 1, units: 3, amount: usd(90) }] }, described: [described("polo-m", poloId, "Polo básico", ["M"])] });
    expect((await outputOf({ ...october, producto: poloId }, onlyUsd)).mensaje).toBe('"Polo básico" no tuvo ventas en PEN del 01/10/2026 al 31/10/2026.');
  });

  test("answers a page beyond the last with the existing page text", async () => {
    const output = await outputOf({ ...october, pagina: 3 });
    expect(output).toMatchObject({ mensaje: pageOutOfRangeMessage(2), total: 2, productos: [] });
  });

  test("answers a producto that is not an identifier with the not-found text without reading", async () => {
    const { run, read } = setup();
    expect((await run({ ...october, producto: "no-es-un-id" })).run).toEqual({ success: false, error: { code: "NOT_FOUND", message: noProductMessage } });
    expect(read).not.toHaveBeenCalled();
    const unknown = setup({ kind: "product_not_found" });
    expect((await unknown.run({ ...october, producto: poloId })).run).toEqual({ success: false, error: { code: "NOT_FOUND", message: noProductMessage } });
  });

  test("adds Con producto se ignoran texto, orden y pagina when any of them was sent with producto", async () => {
    for (const extra of [{ texto: "polo" }, { orden: "monto" }, { pagina: 2 }]) {
      expect((await outputOf({ ...october, producto: poloId, ...extra })).nota).toBe("Con producto se ignoran texto, orden y pagina.");
    }
    expect((await outputOf({ ...october, producto: poloId })).nota).toBeUndefined();
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

  test("refuses an unknown order, a long texto and unknown fields with their texts", async () => {
    const { run } = setup();
    const bad = (await run({ orden: "precio" })).parsed;
    expect(!bad.success && bad.error.issues[0]!.message).toBe('El orden puede ser "unidades" o "monto".');
    expect((await run({ texto: "x".repeat(121) })).parsed.success).toBe(false);
    expect((await run({ pagina: 0 })).parsed.success).toBe(false);
    expect((await run({ campo: 1 })).parsed.success).toBe(false);
  });

  test("passes the failure the port chose: too many orders or the reading failure", async () => {
    for (const message of [tooManyOrdersMessage, salesReadFailureMessage]) {
      const tool = createBestSellersTool({ clock: () => now, appLink: (id) => id, read: async () => err({ code: "FAILURE", message }) });
      expect(await tool.run({ ...october, pagina: undefined } as never, access)).toEqual({ success: false, error: { code: "FAILURE", message } });
    }
  });

  test("a page of 20 products at maximum lengths with 3 variants each and a producto answer of 60 variants fit 24 KB and validate", () => {
    const { tool } = setup();
    expect(checkToolModules([createSalesToolsModule([tool])])).toEqual([]);
    expect(tool.sampleOutputs).toHaveLength(2);
    for (const sample of tool.sampleOutputs) {
      expect(tool.outputSchema.safeParse(sample).success).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(sample))).toBeLessThan(maxToolOutputBytes);
    }
    expect(tool.sampleOutputs[0]!.productos).toHaveLength(20);
    expect(tool.sampleOutputs[1]!.productos[0]!.variantes).toHaveLength(60);
  });
});
