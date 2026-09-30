import { err, ok } from "@shared/functional";
import { createOrderApi } from "@mobile/features/orders/infrastructure/order-api";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("order API sends only validated creation fields and validates the reply", async () => {
  const calls: [string, RequestInit | undefined][] = [];
  const api = createOrderApi(async (path, init) => { calls.push([path, init]); return ok({ unexpected: true }); });
  const input = { id: id(1), contactId: null, items: [{ variantId: id(2), quantity: 2 }] };
  expect(await api.create(input)).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe("/api/orders");
  expect(JSON.parse(String(calls[0][1]?.body))).toEqual(input);
  expect(await api.create({ ...input, items: [] })).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(calls).toHaveLength(1);
});

test("order API preserves matching business errors and rejects mismatched status or operation", async () => {
  const stock = { code: "INSUFFICIENT_STOCK", error: "No stock", issues: [{ field: "items", reason: "STOCK", variantId: id(2) }] };
  const api = createOrderApi(async () => err({ code: "API_ERROR", message: "API error", http: { status: 409, body: stock } }));
  expect(await api.create({ id: id(1), contactId: null, items: [{ variantId: id(2), quantity: 1 }] }))
    .toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK", issues: stock.issues } });
  expect(await api.get(id(1))).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  const wrongStatus = createOrderApi(async () => err({ code: "API_ERROR", message: "API error", http: { status: 404, body: stock } }));
  expect(await wrongStatus.create({ id: id(1), contactId: null, items: [{ variantId: id(2), quantity: 1 }] }))
    .toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
});
