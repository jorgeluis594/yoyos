import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import type { OrderAggregateResponse } from "@shared/contracts/orders";

// The shared module reports "ready" without ever running the fit check: no layout exists for that label.
vi.mock("@shared/dispatch-label/build", () => ({ prepareOrderDispatchLabel: () => ({ status: "ready", label: {} }) }));
const { createDispatchLabels } = await import("@core/src/features/dispatch-labels/application/create-dispatch-labels");

test("a ready order without a layout is excluded as overflow, so every order ends in exactly one list", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const render = vi.fn();
  const result = await createDispatchLabels({ orderIds: [id, "00000000-0000-4000-8000-000000000002"], size: "label_62x100" }, {
    loadOrders: async () => ok([{ id, number: 1001 }] as unknown as OrderAggregateResponse[]),
    loadSender: async () => ok({ name: "Mi Negocio", phone: null }),
    createPdf: () => ({ geometry: { widthPx: 175, heightPx: 283, dpiX: 72, dpiY: 72 }, measure: () => 1, render }),
  });
  expect(result).toEqual(ok({ pdf: null, size: "label_62x100", printed: [],
    excluded: [{ orderId: id, orderNumber: 1001, exclusion: { code: "LABEL_CONTENT_OVERFLOW" } }], notFound: ["00000000-0000-4000-8000-000000000002"] }));
  expect(render).not.toHaveBeenCalled();
});
