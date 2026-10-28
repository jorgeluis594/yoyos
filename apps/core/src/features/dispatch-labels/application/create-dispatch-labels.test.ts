import { describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { defaultDispatchLabelTypography, type DispatchLabelLayout } from "@shared/dispatch-label/layout";
import { createDispatchLabels, type CreateDispatchLabelsDependencies } from "@core/src/features/dispatch-labels/application/create-dispatch-labels";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const district = { country: "PE", districtCode: "150122", district: "Miraflores", province: "Lima", department: "Lima" };
const pricing = { quotationId: uuid(99), rateId: uuid(99), optionId: uuid(99), settingsVersion: 1 };
const recordedBy = { kind: "seller", userId: "u" };
const recipient = { name: "Ana", phone: "999", identity: { kind: "document", documentType: "national_id", document: "12345678" } };
const home = { method: "home", recipient, pricing, recordedBy, destination: { address: "Calle 2", ...district, instructions: null } };
const agency = { method: "agency", recipient, destination: district, pricing, recordedBy, courier: { id: uuid(99), name: "Olva" },
  agency: { id: uuid(99), name: "Olva Centro", address: "Av. 1", location: district } };
const store = { method: "store", recipient, pickupPoint: {}, settingsVersion: 1, recordedBy };
const order = (n: number, patch: object = {}) => ({ id: uuid(n), number: 1000 + n, status: "active", cancelled: false, deliveryStatus: "pending",
  scheduledDispatchDate: null, delivery: home, ...patch }) as unknown as OrderAggregateResponse;

function dependencies(orders: OrderAggregateResponse[], overrides: Partial<CreateDispatchLabelsDependencies> = {}) {
  const rendered: DispatchLabelLayout[][] = [];
  const createPdf = vi.fn((size: "label_62x100" | "a4") => ({
    geometry: { widthPx: 175.75, heightPx: 283.46, dpiX: 72, dpiY: 72, paddingMm: 2 },
    typography: defaultDispatchLabelTypography,
    measure: (text: string, sizePt: number) => text.length * sizePt * 0.5,
    render: async (layouts: readonly DispatchLabelLayout[]) => { rendered.push([...layouts]); return ok(Buffer.from(`pdf:${size}:${layouts.length}`)); },
  }));
  const deps: CreateDispatchLabelsDependencies = {
    loadOrders: vi.fn(async (ids: readonly string[]) => ok(orders.filter((item) => ids.includes(item.id)))),
    loadSender: vi.fn(async () => ok({ name: "Fantastidog", phone: "977 000 111" })),
    createPdf, ...overrides,
  };
  return { deps, rendered, createPdf };
}

describe("createDispatchLabels", () => {
  test("mixes printed, excluded and not found orders in request order and returns the base64 PDF", async () => {
    const orders = [order(1), order(2, { delivery: agency }), order(3, { delivery: store }), order(4, { delivery: null }), order(5, { cancelled: true, status: "cancelled" }),
      order(6, { delivery: { ...home, destination: { ...home.destination, address: " " } } })];
    const { deps, rendered } = dependencies(orders);
    const request = [uuid(6), uuid(2), uuid(404), uuid(3), uuid(1), uuid(4), uuid(5)];
    const result = await createDispatchLabels({ orderIds: request, size: "a4" }, deps);
    expect(result).toEqual(ok({
      pdf: Buffer.from("pdf:a4:2").toString("base64"), size: "a4",
      printed: [{ orderId: uuid(2), orderNumber: 1002 }, { orderId: uuid(1), orderNumber: 1001 }],
      excluded: [
        { orderId: uuid(6), orderNumber: 1006, exclusion: { code: "MISSING_DATA", fields: ["address"] } },
        { orderId: uuid(3), orderNumber: 1003, exclusion: { code: "METHOD_NOT_APPLICABLE" } },
        { orderId: uuid(4), orderNumber: 1004, exclusion: { code: "DELIVERY_NOT_ASSIGNED" } },
        { orderId: uuid(5), orderNumber: 1005, exclusion: { code: "CANCELLED" } },
      ],
      notFound: [uuid(404)],
    }));
    expect(rendered[0]).toHaveLength(2);
    expect(rendered[0][0].lines.map((line) => line.text)).toContain("Olva Centro");
  });

  test("reads the orders in one call and the sender once", async () => {
    const { deps } = dependencies([order(1), order(2), order(3)]);
    await createDispatchLabels({ orderIds: [uuid(1), uuid(2), uuid(3)], size: "label_62x100" }, deps);
    expect(deps.loadOrders).toHaveBeenCalledTimes(1);
    expect(deps.loadOrders).toHaveBeenCalledWith([uuid(1), uuid(2), uuid(3)]);
    expect(deps.loadSender).toHaveBeenCalledTimes(1);
  });

  test("prints the effective sender, including the company-name fallback, on every label", async () => {
    const { deps, rendered } = dependencies([order(1)], { loadSender: async () => ok({ name: "Mi Negocio", phone: null }) });
    await createDispatchLabels({ orderIds: [uuid(1)], size: "label_62x100" }, deps);
    const texts = rendered[0][0].lines.map((line) => line.text);
    expect(texts.slice(0, 2)).toEqual(["REMITENTE", "Mi Negocio"]);
    expect(texts.some((text) => text.startsWith("Cel. 977"))).toBe(false);
    expect(texts).toContain("Pedido #1001");
  });

  test("an order whose text does not fit is excluded with LABEL_CONTENT_OVERFLOW and the others still print", async () => {
    const long = order(2, { delivery: { ...home, destination: { ...home.destination, address: "x".repeat(40) + "Ñ".repeat(4000) } } });
    const { deps } = dependencies([order(1), long]);
    const result = await createDispatchLabels({ orderIds: [uuid(2), uuid(1)], size: "label_62x100" }, deps);
    expect(result).toMatchObject({ success: true, data: { printed: [{ orderId: uuid(1) }], excluded: [{ orderId: uuid(2), exclusion: { code: "LABEL_CONTENT_OVERFLOW" } }] } });
  });

  test("with no ready order the PDF is null and nothing is rendered", async () => {
    const { deps, rendered } = dependencies([order(1, { cancelled: true, status: "cancelled" })]);
    const result = await createDispatchLabels({ orderIds: [uuid(1), uuid(2)], size: "label_62x100" }, deps);
    expect(result).toMatchObject({ success: true, data: { pdf: null, printed: [], notFound: [uuid(2)] } });
    expect(rendered).toEqual([]);
  });

  test("does not change the orders it reads", async () => {
    const orders = [order(1), order(2, { delivery: agency })];
    const before = structuredClone(orders);
    await createDispatchLabels({ orderIds: [uuid(1), uuid(2)], size: "a4" }, dependencies(orders).deps);
    expect(orders).toEqual(before);
  });

  test("storage and render failures are returned instead of an empty result", async () => {
    const down = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" });
    const request = { orderIds: [uuid(1)], size: "label_62x100" as const };
    expect(await createDispatchLabels(request, dependencies([order(1)], { loadOrders: async () => down }).deps)).toEqual(down);
    expect(await createDispatchLabels(request, dependencies([order(1)], { loadSender: async () => down }).deps)).toEqual(down);
    const render = err({ code: "PDF_RENDER_FAILED" as const, message: "boom" });
    const { deps } = dependencies([order(1)]);
    const failing = { ...deps, createPdf: () => ({ ...deps.createPdf("label_62x100"), render: async () => render }) };
    expect(await createDispatchLabels(request, failing)).toEqual(render);
  });
});
