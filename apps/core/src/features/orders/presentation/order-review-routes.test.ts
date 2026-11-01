import express from "express";
import { afterEach, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { orderReviewErrorSchema, orderReviewResponseSchema } from "@shared/contracts/order-review";
import { createOrderReviewRoutes, type OrderReviewRoutesDependencies } from "@core/src/features/orders/presentation/order-review-routes";
import type { OrderReviewProjection } from "@core/src/features/orders/domain/order-review";

const orderId = "00000000-0000-4000-8000-000000000001";
const itemId = "00000000-0000-4000-8000-000000000003";
const servers: import("node:http").Server[] = [];

const projection = { status: { openForMessages: true, toReview: false, doubtfulCount: 0, pointCount: 0, entry: "link", hasPreviousReview: false }, doubtful: [], points: [], products: [], removedSinceLastReview: [],
  messageRows: [], moreRows: 0, loaded: { changesThrough: 0, changeIds: [], points: [], itemsRevision: "A".repeat(43) } } as unknown as OrderReviewProjection;
const dependencies = (over: Partial<OrderReviewRoutesDependencies> = {}): OrderReviewRoutesDependencies => ({ load: async () => ok(projection), confirm: async () => { throw new Error("not called"); },
  recordLinkAction: async () => ok(null), ...over });

async function call(method: "GET" | "POST", path: string, deps: OrderReviewRoutesDependencies, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use((_request, response, next) => { response.locals.auth = { company: { id: "00000000-0000-4000-8000-000000000002", country: "PE" }, user: { id: "seller" } }; next(); });
  app.use("/api/orders", createOrderReviewRoutes(deps));
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/orders${path}`, { method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
afterEach(() => { for (const server of servers.splice(0)) server.close(); });

const request = { version: 1, id: "00000000-0000-4000-8000-000000000700", origin: "link", linkAction: null, corrections: [{ itemId, quantity: 0 }],
  loaded: { changesThrough: 2, changeIds: [], points: [], itemsRevision: "A".repeat(43) } };

test("answers the review and asks for all rows with ?rows=all", async () => {
  const load = vi.fn(async () => ok(projection));
  const result = await call("GET", `/${orderId}/review?rows=all`, dependencies({ load }));
  expect(result.status).toBe(200);
  expect(orderReviewResponseSchema.safeParse(result.body).success).toBe(true);
  expect(load).toHaveBeenCalledWith({ orderId, allRows: true }, expect.objectContaining({ userId: "seller" }));
});

test("answers 404 for an unknown order, 503 when persistence fails and 400 for a malformed id", async () => {
  expect((await call("GET", `/${orderId}/review`, dependencies({ load: async () => err({ code: "ORDER_NOT_FOUND" as const, message: "x" }) }))).status).toBe(404);
  expect((await call("GET", `/${orderId}/review`, dependencies({ load: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "x" }) }))).status).toBe(503);
  expect((await call("GET", "/nope/review", dependencies())).status).toBe(400);
});

test("answers 409 REVIEW_OUTDATED with the affected items when a mark arrived meanwhile", async () => {
  const confirm = async () => err({ code: "REVIEW_OUTDATED" as const, message: "x", affectedItemIds: [itemId as never], newPoints: 1 });
  const result = await call("POST", `/${orderId}/reviews`, dependencies({ confirm }), request);
  expect(result.status).toBe(409);
  expect(orderReviewErrorSchema.parse(result.body)).toEqual({ code: "REVIEW_OUTDATED", error: expect.any(String), affectedItemIds: [itemId], newPoints: 1 });
});

test.each([
  ["ORDER_CHANGED", 409], ["DELIVERY_LOCKED", 409], ["ORDER_CANCELLED", 409], ["LAST_ITEM", 422], ["INVALID_INPUT", 400], ["ORDER_NOT_FOUND", 404], ["PERSISTENCE_UNAVAILABLE", 503],
] as const)("maps %s to %i", async (code, status) => {
  const result = await call("POST", `/${orderId}/reviews`, dependencies({ confirm: async () => err({ code, message: "x" } as never) }), request);
  expect(result.status).toBe(status);
});

test("answers 400 for a review that is not valid", async () => {
  expect((await call("POST", `/${orderId}/reviews`, dependencies(), { ...request, version: 2 })).status).toBe(400);
});

test("records a link action and answers 204, or 404 for an unknown order", async () => {
  const recordLinkAction = vi.fn(async () => ok(null));
  const body = { version: 1, id: "00000000-0000-4000-8000-000000000800", action: "share" };
  expect((await call("POST", `/${orderId}/link-actions`, dependencies({ recordLinkAction }), body)).status).toBe(204);
  expect(recordLinkAction).toHaveBeenCalledWith({ id: body.id, orderId, action: "share" }, expect.objectContaining({ userId: "seller" }));
  expect((await call("POST", `/${orderId}/link-actions`, dependencies({ recordLinkAction: async () => err({ code: "ORDER_NOT_FOUND" as const, message: "x" }) }), body)).status).toBe(404);
  expect((await call("POST", `/${orderId}/link-actions`, dependencies(), { ...body, action: "print" })).status).toBe(400);
});
