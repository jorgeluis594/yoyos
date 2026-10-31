import { describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { CompanyId, UserId } from "@shared/identity";
import type { AssistantConnectionId } from "@core/src/features/assistants/domain/assistant-connection";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import { checkToolModules, maxToolOutputBytes } from "@core/src/features/assistants/presentation/tool-registry";
import { createSalesToolsModule } from "@core/src/features/assistants/presentation/tools/sales-tools";
import { salesReadFailureMessage, tooManyOrdersMessage } from "@core/src/features/assistants/presentation/tools/sales-texts";
import { createSalesSummaryTool, type SalesSummaryRead, type SalesSummaryToolDependencies } from "@core/src/features/assistants/presentation/tools/sales-summary-tool";

const access: AssistantAccess = {
  companyId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0002" as CompanyId, userId: "user-1" as UserId,
  connectionId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0001" as AssistantConnectionId, scopes: ["orders:read", "products:read"], lastUsedAt: null,
};
const pen = (amount: number) => ({ amount, currency: "PEN" });
const read: SalesSummaryRead = {
  storeCurrency: "PEN",
  summary: {
    current: [{ currency: "PEN", orders: 4, items: pen(640), deliveryCharges: pen(40), total: pen(680), received: pen(380), owed: pen(310), overpaid: pen(10),
      receivedBy: [{ label: "Yape", amount: pen(330) }, { label: "Plin", amount: pen(50) }], cancelled: { orders: 0, total: pen(0), confirmed: pen(0) } }],
    previous: [], pendingReports: { reports: 0, orders: 0 }, storeHasOrders: true,
  },
};

function setup(overrides: Partial<SalesSummaryToolDependencies> = {}, now = "2026-11-05T15:00:00Z") {
  const summarize = vi.fn(async (): ReturnType<SalesSummaryToolDependencies["summarize"]> => ok(read));
  const tool = createSalesSummaryTool({ clock: () => new Date(now), summarize, ...overrides });
  const run = async (raw: unknown) => {
    const parsed = tool.inputSchema.safeParse(raw);
    if (!parsed.success) return { parsed } as const;
    return { parsed, run: await tool.run(parsed.data, access) } as const;
  };
  return { tool, summarize, run };
}

describe("resumen_de_ventas", () => {
  test("refuses invalid periods with their texts and calls no port", async () => {
    const { run, summarize } = setup();
    const refusal = async (raw: unknown) => { const { run: result } = await run(raw); return result && !result.success ? result.error : null; };
    expect(await refusal({ hasta: "2026-10-31" })).toEqual({ code: "INVALID_INPUT", message: "Indica también la fecha inicial (desde)." });
    expect(await refusal({ desde: "2026-10-07", hasta: "2026-10-01" })).toEqual({ code: "INVALID_INPUT", message: "La fecha final (2026-10-01) es anterior a la inicial (2026-10-07)." });
    expect(await refusal({ desde: "2026-11-06" })).toEqual({ code: "INVALID_INPUT", message: "La fecha inicial (2026-11-06) es posterior a hoy (2026-11-05)." });
    expect(await refusal({ desde: "2025-09-01", hasta: "2026-10-31" })).toEqual({ code: "INVALID_INPUT", message: "El periodo puede tener hasta 366 días. Pide uno más corto." });
    expect(summarize).not.toHaveBeenCalled();
    expect((await run({ desde: "01/10/2026" })).parsed.success).toBe(false);
    expect((await run({ mes: "octubre" })).parsed.success).toBe(false);
  });

  test("reads the period and the one before it as Lima midnights, and answers with Hoy es …", async () => {
    const { run, summarize } = setup();
    const { run: result } = await run({ desde: "2026-10-01", hasta: "2026-10-31" });
    expect(summarize).toHaveBeenCalledWith({
      current: { from: new Date("2026-10-01T05:00:00Z"), before: new Date("2026-11-01T05:00:00Z") },
      previous: { from: new Date("2026-09-01T05:00:00Z"), before: new Date("2026-10-01T05:00:00Z") }, periodDays: 31,
    }, access);
    expect(result).toMatchObject({ success: true, data: { empty: false, output: { hoy: "Hoy es 05/11/2026", periodo: "Del 01/10/2026 al 31/10/2026" } } });
  });

  test("defaults to the current month up to today in Lima, even when it is already tomorrow in UTC", async () => {
    const { run, summarize } = setup({}, "2026-11-01T03:00:00Z");
    await run({});
    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({ current: { from: new Date("2026-10-01T05:00:00Z"), before: new Date("2026-11-01T05:00:00Z") }, periodDays: 31 }), access);
  });

  test("marks an empty answer as empty", async () => {
    const { run } = setup({ summarize: async () => ok({ ...read, summary: { ...read.summary, current: [], storeHasOrders: false } }) });
    expect((await run({})).run).toMatchObject({ success: true, data: { empty: true, output: { hoy: "Hoy es 05/11/2026", mensaje: "Tu tienda todavía no tiene pedidos." } } });
  });

  test("answers the too-many-orders text the port chose and the reading-failure text otherwise", async () => {
    for (const message of [tooManyOrdersMessage, salesReadFailureMessage]) {
      const { run } = setup({ summarize: async () => err({ code: "FAILURE" as const, message }) });
      expect((await run({ desde: "2026-01-01" })).run).toEqual({ success: false, error: { code: "FAILURE", message } });
    }
  });

  test("states in its sample outputs the 24 KB worst case of the summary", () => {
    const { tool } = setup();
    expect(tool.sampleOutputs.length).toBeGreaterThan(0);
    for (const sample of tool.sampleOutputs) {
      expect(tool.outputSchema.safeParse(sample).success).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(sample))).toBeLessThan(maxToolOutputBytes);
    }
    expect(checkToolModules([createSalesToolsModule([tool])])).toEqual([]);
  });

  test("describes the meaning of each figure, the next-step tools with the creation dates, Yape and Plin, the open period and the web remedy", () => {
    const { tool } = setup();
    for (const phrase of ["creación", "buscar_pedidos", "creado_desde", "pedidos_por_cobrar", "Yape", "Plin", "Billetera digital", "sigue abierto", "desde la web", "mismos días del mes anterior"]) expect(tool.description).toContain(phrase);
  });
});
