import express from "express";
import { afterEach, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { undoMessageErrorSchema, undoMessageResponseSchema } from "@shared/contracts/order-message-undo";
import { createMessageUndoRoutes } from "@core/src/features/orders/presentation/message-undo-routes";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";

const orderId = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000201";
const servers: import("node:http").Server[] = [];

async function post(path: string, deps: Parameters<typeof createMessageUndoRoutes>[0]) {
  const app = express();
  app.use((_request, response, next) => { response.locals.auth = { company: { id: "00000000-0000-4000-8000-000000000002", country: "PE" }, user: { id: "seller" } }; next(); });
  app.use("/api/orders", createMessageUndoRoutes(deps));
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/orders${path}`, { method: "POST" });
  return { status: response.status, body: await response.json() };
}
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

const money = (amount: number) => ({ amount, currency: "PEN" as const });
const at = new Date("2026-10-31T12:00:00Z");
const order = { number: 1042, id: orderId, companyId: "00000000-0000-4000-8000-000000000002", sellerId: "seller", fromCatalog: false, chatId: "00000000-0000-4000-8000-000000000009", buyer: null,
  checkoutEnabledAt: null, checkoutConfirmedAt: null, createdAt: at, scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null, cancelled: false, cancelledAt: null,
  items: [{ id: "00000000-0000-4000-8000-000000000003", variantId: "00000000-0000-4000-8000-000000000103", productName: "Polo", variantAttributes: {}, sku: null, quantity: 2,
    unitPrice: money(35), subtotal: money(70), mentionedPrice: null, stockDeductedQuantity: 0 }],
  payments: [], delivery: null, deliveryStatus: "pending", stockDeducted: false, stockDeductedAt: null, itemsTotal: money(70), deliveryCost: money(0), deliveryCharge: money(0), total: money(70) } as unknown as OrderAggregate;
const undone = { order, undone: true, changeCount: 1, pendingsRestored: 0, pendingsEnded: 0 };
const review = { version: 1 as const, status: { openForMessages: true, toReview: false, doubtfulCount: 0, pointCount: 0, entry: "none" as const, hasPreviousReview: false }, doubtful: [], points: [],
  products: [], removedSinceLastReview: [], messageRows: [], moreRows: 0, loaded: { changesThrough: 0, changeIds: [], points: [], itemsRevision: "A".repeat(43) } };

test("answers the order and the reloaded review when the message is undone", async () => {
  const undo = vi.fn(async () => ok(undone));
  const result = await post(`/${orderId}/messages/${messageId}/undo`, { undo, loadReview: async () => ok(review) });
  expect(result.status).toBe(200);
  expect(undoMessageResponseSchema.safeParse(result.body).success).toBe(true);
  expect(undo).toHaveBeenCalledWith({ orderId, messageId }, { companyId: "00000000-0000-4000-8000-000000000002", userId: "seller" });
});

test("answers 409 with the reason when undo is refused", async () => {
  const result = await post(`/${orderId}/messages/${messageId}/undo`, { undo: async () => err({ code: "UNDO_REFUSED", message: "no", reason: "not_sold", variantId: "00000000-0000-4000-8000-000000000103" as never }),
    loadReview: async () => ok(review) });
  expect(result.status).toBe(409);
  expect(undoMessageErrorSchema.parse(result.body)).toMatchObject({ code: "UNDO_REFUSED", reason: "not_sold", variantId: "00000000-0000-4000-8000-000000000103" });
});

test.each([["ORDER_NOT_FOUND"], ["MESSAGE_CHANGES_NOT_FOUND"]])("answers 404 for %s", async (code) => {
  expect(await post(`/${orderId}/messages/${messageId}/undo`, { undo: async () => err({ code: code as "ORDER_NOT_FOUND", message: "x" }), loadReview: async () => ok(review) })).toMatchObject({ status: 404 });
});

test("answers 503 when persistence is unavailable and 400 for malformed ids", async () => {
  const deps = { undo: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "x" }), loadReview: async () => ok(review) };
  expect(await post(`/${orderId}/messages/${messageId}/undo`, deps)).toMatchObject({ status: 503 });
  expect(await post(`/not-a-uuid/messages/${messageId}/undo`, deps)).toMatchObject({ status: 400, body: { code: "INVALID_INPUT" } });
});
