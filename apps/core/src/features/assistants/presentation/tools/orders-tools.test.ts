import { describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { CompanyId, UserId } from "@shared/identity";
import type { AssistantConnectionId } from "@core/src/features/assistants/domain/assistant-connection";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import type { ProjectableOrder } from "@core/src/features/assistants/domain/order-projection";
import { createOrderToolsModule, type OrderToolsDependencies } from "@core/src/features/assistants/presentation/tools/orders-tools";

const access: AssistantAccess = {
  companyId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0002" as CompanyId, userId: "user-1" as UserId,
  connectionId: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0001" as AssistantConnectionId, scopes: ["orders:read"], lastUsedAt: null,
};
const pen = (amount: number) => ({ amount, currency: "PEN" });
const order = (number: number, overrides: Partial<ProjectableOrder> = {}): ProjectableOrder => ({
  number, id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`, createdAt: new Date("2026-10-30T15:00:00Z"), scheduledDispatchDate: null, shippedAt: null, deliveredAt: null,
  completedAt: null, cancelled: false, fromCatalog: false, buyer: { name: "Carla Pérez", phone: "987654789" },
  items: [{ variantId: "v", productName: "Camisa", variantAttributes: {}, quantity: 1, unitPrice: pen(80), subtotal: pen(80) }], payments: [], delivery: null,
  deliveryStatus: "pending", itemsTotal: pen(80), deliveryCharge: pen(0), total: pen(80), ...overrides,
});
const couriers = [{ id: "c-olva", name: "Olva Courier" }, { id: "c-shalom", name: "Shalom" }, { id: "c-shalom-2", name: "Shalom Express" }];

function setup(overrides: Partial<OrderToolsDependencies> = {}) {
  const deps: OrderToolsDependencies = {
    clock: () => new Date("2026-10-31T04:30:00Z"), link: (id) => `https://app.yoyos.lat/orders/${id}`,
    listOrders: vi.fn(async () => ok({ items: [order(1001)], page: 1, total: 1 })),
    hasAnyOrder: vi.fn(async () => ok(true)),
    listCouriers: vi.fn(async () => ok(couriers)),
    findOrder: vi.fn(async (number: number) => ok({ order: order(number), stock: { stockDue: null }, readiness: null })),
    summarizeUnpaid: vi.fn(async () => ok({ count: 0, withPendingReport: 0, owed: [] })),
    listDispatchQueue: vi.fn(async () => ok({ entries: [], page: 1, total: 0, summary: { overdue: 0, overdueReady: 0, today: 0, todayReady: 0 }, undatedPending: 0 })),
    ...overrides,
  };
  const module = createOrderToolsModule(deps);
  const tool = (name: string) => module.tools.find((candidate) => candidate.name === name)!;
  const call = async (name: string, input: unknown) => {
    const parsed = tool(name).inputSchema.safeParse(input);
    if (!parsed.success) return { parsed } as const;
    return { parsed, run: await tool(name).run(parsed.data, access) } as const;
  };
  return { deps, module, tool, call };
}

describe("buscar_pedidos", () => {
  test("lists exactly the four tools of the orders scope", () => {
    expect(setup().module.tools.map((tool) => tool.name)).toEqual(["buscar_pedidos", "ver_pedido", "pedidos_por_cobrar", "pedidos_por_despachar_hoy"]);
    expect(setup().module).toMatchObject({ scope: "orders:read", access: "read" });
  });

  test("states today's Lima date in every list", async () => {
    const { call } = setup();
    for (const name of ["buscar_pedidos", "pedidos_por_cobrar", "pedidos_por_despachar_hoy"]) {
      const answer = await call(name, {});
      expect(answer.run?.success && answer.run.data.output).toMatchObject({ hoy: "Hoy es 30/10/2026" });
    }
  });

  test("refuses an end date before the start date naming both dates", async () => {
    const { call, deps } = setup();
    const answer = await call("buscar_pedidos", { creado_desde: "2026-10-07", creado_hasta: "2026-10-01" });
    expect(answer.run).toEqual({ success: false, error: { code: "INVALID_INPUT", message: "La fecha final (2026-10-01) es anterior a la inicial (2026-10-07)." } });
    expect(deps.listOrders).not.toHaveBeenCalled();
  });

  test("refuses a date in another format or page 0 with the remedy", async () => {
    const { call } = setup();
    expect((await call("buscar_pedidos", { creado_desde: "30/10/2026" })).parsed.success).toBe(false);
    expect((await call("buscar_pedidos", { creado_desde: "2026-02-31" })).parsed.success).toBe(false);
    expect((await call("buscar_pedidos", { pagina: 0 })).parsed.success).toBe(false);
    expect((await call("buscar_pedidos", { entrega: "enviada" })).parsed.success).toBe(false);
    expect((await call("buscar_pedidos", { telefono: "987654789" })).parsed.success).toBe(false);
  });

  test("turns whole Lima days into inclusive instants", async () => {
    const { call, deps } = setup();
    await call("buscar_pedidos", { creado_desde: "2026-10-01", creado_hasta: "2026-10-07" });
    expect(deps.listOrders).toHaveBeenCalledWith(expect.objectContaining({ createdFrom: new Date("2026-10-01T05:00:00Z"), createdBefore: new Date("2026-10-08T05:00:00Z") }), access);
  });

  test("refuses an unknown courier listing the store's couriers", async () => {
    const { call } = setup();
    const answer = await call("buscar_pedidos", { courier: "Olba" });
    expect(answer.run).toEqual({ success: false, error: { code: "INVALID_INPUT", message: 'Tu tienda no tiene el courier "Olba". Couriers: Olva Courier, Shalom, Shalom Express.' } });
  });

  test("finds a disabled courier that still has orders by an exact, accent-insensitive or unique partial name", async () => {
    const { call, deps } = setup();
    await call("buscar_pedidos", { courier: "shalom" });
    expect(deps.listOrders).toHaveBeenLastCalledWith(expect.objectContaining({ courierId: "c-shalom" }), access);
    await call("buscar_pedidos", { courier: "OLVA" });
    expect(deps.listOrders).toHaveBeenLastCalledWith(expect.objectContaining({ courierId: "c-olva" }), access);
    expect((await call("buscar_pedidos", { courier: "Sha" })).run).toMatchObject({ success: false, error: { message: expect.stringContaining("varios") } });
  });

  test("tells a store without orders from a search without matches", async () => {
    const empty = { items: [], page: 1, total: 0 };
    const withOrders = setup({ listOrders: vi.fn(async () => ok(empty)), hasAnyOrder: vi.fn(async () => ok(true)) });
    expect((await withOrders.call("buscar_pedidos", { entrega: "entregada" })).run).toMatchObject({ success: true, data: { empty: true, output: { mensaje: "No hay pedidos con esos filtros.", pedidos: [] } } });
    const without = setup({ listOrders: vi.fn(async () => ok(empty)), hasAnyOrder: vi.fn(async () => ok(false)) });
    expect((await without.call("buscar_pedidos", { entrega: "entregada" })).run).toMatchObject({ data: { output: { mensaje: "Tu tienda todavía no tiene pedidos." } } });
    const unfiltered = setup({ listOrders: vi.fn(async () => ok(empty)) });
    expect((await unfiltered.call("buscar_pedidos", {})).run).toMatchObject({ data: { output: { mensaje: "Tu tienda todavía no tiene pedidos." } } });
    expect(unfiltered.deps.hasAnyOrder).not.toHaveBeenCalled();
  });

  test("never answers a failed read as an empty list", async () => {
    const { call } = setup({ listOrders: vi.fn(async () => err({ code: "FAILURE" as const, message: "No pudimos leer tus pedidos en este momento. Inténtalo de nuevo en unos segundos." })) });
    expect((await call("buscar_pedidos", {})).run).toMatchObject({ success: false, error: { code: "FAILURE" } });
  });

  test("excludes cancelled orders unless asked, and a payment filter makes the flag irrelevant", async () => {
    const { call, deps } = setup();
    await call("buscar_pedidos", {});
    expect(deps.listOrders).toHaveBeenLastCalledWith(expect.objectContaining({ excludeCancelled: true }), access);
    await call("buscar_pedidos", { incluir_cancelados: true });
    expect(deps.listOrders).toHaveBeenLastCalledWith(expect.objectContaining({ excludeCancelled: false }), access);
    expect(setup().tool("buscar_pedidos").description).toContain("se ignora cuando das pago");
  });

  test("offers the next page when there are more orders", async () => {
    const { call } = setup({ listOrders: vi.fn(async () => ok({ items: [order(1001)], page: 1, total: 41 })) });
    expect((await call("buscar_pedidos", {})).run).toMatchObject({ data: { output: { total: 41, hay_mas: "hay más: pide la página 2" } } });
  });
});

describe("ver_pedido", () => {
  test("accepts 1001 and #1001 as the same order number", async () => {
    const { call, deps } = setup();
    await call("ver_pedido", { numero: "1001" });
    await call("ver_pedido", { numero: "#1001" });
    expect(vi.mocked(deps.findOrder).mock.calls.map(([number]) => number)).toEqual([1001, 1001]);
    expect((await call("ver_pedido", { numero: "mil" })).parsed.success).toBe(false);
  });

  test("answers the same sentence for an unknown number, another store's number and an unconfirmed catalog order", async () => {
    const { call } = setup({ findOrder: vi.fn(async () => err({ code: "NOT_FOUND" as const, message: "" })) });
    expect((await call("ver_pedido", { numero: "#1042" })).run).toEqual({ success: false, error: { code: "NOT_FOUND", message: "No hay un pedido #1042 en tu tienda." } });
  });
});

describe("pedidos_por_cobrar", () => {
  test("summarizes every unpaid order before the page and counts reported payments", async () => {
    const { call } = setup({
      summarizeUnpaid: vi.fn(async () => ok({ count: 2, withPendingReport: 1, owed: [pen(150)] })),
      listOrders: vi.fn(async () => ok({ items: [order(1060, { total: pen(100) })], page: 1, total: 2 })),
    });
    const answer = await call("pedidos_por_cobrar", {});
    expect(answer.run).toMatchObject({ data: { output: { resumen: "2 pedidos, S/ 150.00 por cobrar. 1 tiene un pago por revisar", total: 2 } } });
  });

  test("answers No tienes pedidos por cobrar for an empty summary", async () => {
    expect((await setup({ listOrders: vi.fn(async () => ok({ items: [], page: 1, total: 0 })) }).call("pedidos_por_cobrar", {})).run).toMatchObject({ data: { empty: true, output: { mensaje: "No tienes pedidos por cobrar." } } });
  });
});

describe("pedidos_por_despachar_hoy", () => {
  test("summarizes, repeats the undated line and uses the Lima day of the clock", async () => {
    const queue = {
      entries: [{ group: "overdue" as const, order: order(1048, { scheduledDispatchDate: "2026-10-28", payments: [{ status: "confirmed" as const, amount: pen(80), method: "digital_wallet" as const, data: { confirmedAt: new Date(), evidence: { kind: "manual" as const } } }] }), readiness: { kind: "ready" as const, operation: "ship" as const } }],
      page: 1, total: 1, summary: { overdue: 1, overdueReady: 1, today: 0, todayReady: 0 }, undatedPending: 1,
    };
    const { call, deps } = setup({ listDispatchQueue: vi.fn(async () => ok(queue)) });
    const answer = await call("pedidos_por_despachar_hoy", {});
    expect(deps.listDispatchQueue).toHaveBeenCalledWith("2026-10-30", 1, access);
    expect(answer.run).toMatchObject({ data: { output: {
      resumen: "Atrasados: 1, 1 listo. Para hoy: 0, 0 listos.", sin_fecha_de_despacho: "Además hay 1 pedido pendiente sin fecha de despacho.",
      pedidos: [{ grupo: "Atrasados", numero: "#1048", despacho_programado: "28/10/2026", preparacion: { listo: true, texto: "Listo para despachar" } }],
    } } });
  });

  test("answers No tienes pedidos para despachar hoy plus the undated line", async () => {
    const { call } = setup({ listDispatchQueue: vi.fn(async () => ok({ entries: [], page: 1, total: 0, summary: { overdue: 0, overdueReady: 0, today: 0, todayReady: 0 }, undatedPending: 5 })) });
    expect((await call("pedidos_por_despachar_hoy", {})).run).toMatchObject({ data: { empty: true, output: { mensaje: "No tienes pedidos para despachar hoy.", sin_fecha_de_despacho: "Además hay 5 pedidos pendientes sin fecha de despacho." } } });
  });
});
