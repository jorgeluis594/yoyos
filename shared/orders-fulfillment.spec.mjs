import { expect, test } from "vitest";
import { orderFulfillmentBlock, stockFulfillmentBlock } from "@shared/orders-fulfillment";

const variant = "11111111-1111-4111-8111-111111111111";
const waiting = { kind: "waiting", shortItems: [{ variantId: variant, available: 1 }] };
const deducting = { kind: "deducting" };
const order = (overrides = {}) => ({ cancelled: false, deliveryStatus: "pending", paymentStatus: "paid", paidAmount: { amount: 50 }, stockDeducted: false, stockDue: null, ...overrides });

test("ship is blocked only while the order waits for stock", () => {
  expect(stockFulfillmentBlock({ stockDue: waiting }, "ship")).toEqual({ code: "STOCK_WAITING", variantIds: [variant] });
  expect(stockFulfillmentBlock({ stockDue: deducting }, "ship")).toBeNull();
  expect(stockFulfillmentBlock({ stockDue: null }, "ship")).toBeNull();
  expect(orderFulfillmentBlock(order({ stockDue: waiting }), "ship")).toEqual({ code: "STOCK_WAITING", variantIds: [variant] });
  expect(orderFulfillmentBlock(order({ stockDue: deducting }), "ship")).toBeNull();
  expect(orderFulfillmentBlock(order(), "ship")).toBeNull();
});

test("deliver is blocked while the order waits for stock or is being deducted", () => {
  expect(stockFulfillmentBlock({ stockDue: waiting }, "deliver")).toEqual({ code: "STOCK_WAITING", variantIds: [variant] });
  expect(stockFulfillmentBlock({ stockDue: deducting }, "deliver")).toEqual({ code: "STOCK_DEDUCTING" });
  expect(orderFulfillmentBlock(order({ stockDue: waiting }), "deliver")).toEqual({ code: "STOCK_WAITING", variantIds: [variant] });
  expect(orderFulfillmentBlock(order({ stockDue: deducting }), "deliver")).toEqual({ code: "STOCK_DEDUCTING" });
});

test("the payment reason comes before any stock block", () => {
  expect(orderFulfillmentBlock(order({ paymentStatus: "pending", stockDue: waiting }), "deliver")).toEqual({ code: "PAYMENT_REQUIRED" });
  expect(orderFulfillmentBlock(order({ paidAmount: { amount: 0 }, stockDue: waiting }), "ship")).toEqual({ code: "PAYMENT_REQUIRED" });
  expect(orderFulfillmentBlock(order({ cancelled: true, stockDue: waiting }), "ship")).toEqual({ code: "ORDER_CANCELLED" });
  expect(orderFulfillmentBlock(order({ deliveryStatus: "delivered", stockDue: deducting }), "deliver")).toEqual({ code: "INVALID_TRANSITION" });
});

test("an order that is not due keeps the stock-not-deducted reason for deliver", () => {
  expect(orderFulfillmentBlock(order(), "deliver")).toEqual({ code: "STOCK_NOT_DEDUCTED" });
  expect(orderFulfillmentBlock(order({ stockDeducted: true }), "deliver")).toBeNull();
});
