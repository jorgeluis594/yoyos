import { describe, expect, it } from "vitest";
import { parseDispatchDate } from "@shared/dispatch-date";
import { listOrderAggregatesSchema, orderAggregateSummarySchema, updateOrderShippingSchema } from "@shared/contracts/orders";

describe("parseDispatchDate", () => {
  it("accepts real calendar days, including leap days", () => {
    for (const day of ["2026-10-15", "2028-02-29"]) expect(parseDispatchDate(day)).toEqual({ success: true, data: day });
  });

  it("rejects impossible or malformed dates", () => {
    for (const day of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-10-1", "2026-10-15T00:00:00Z", "", null, 20261015])
      expect(parseDispatchDate(day)).toMatchObject({ success: false, error: { code: "INVALID_DISPATCH_DATE" } });
  });
});

describe("updateOrderShippingSchema", () => {
  it("accepts a date, null, a status or both", () => {
    for (const body of [{ scheduledDispatchDate: "2026-10-15" }, { scheduledDispatchDate: null }, { status: "shipped" },
      { status: "delivered", scheduledDispatchDate: "2026-10-15" }]) expect(updateOrderShippingSchema.safeParse(body).success).toBe(true);
  });

  it("rejects empty bodies, pending status, bad dates and unknown fields", () => {
    for (const body of [{}, { status: "pending" }, { scheduledDispatchDate: "2026-02-30" }, { shippedAt: "2026-10-15T00:00:00Z" }, { status: "shipped", deliveredAt: null }])
      expect(updateOrderShippingSchema.safeParse(body).success).toBe(false);
  });
});

describe("listOrderAggregatesSchema dispatch filters", () => {
  it("parses the new search parameters", () => {
    const query = { deliveryStatus: "shipped", courierId: "6a1f0a52-5f3b-4a43-8f2d-1d3a1d2f9c11", scheduledFrom: "2026-10-01", scheduledThrough: "2026-10-31",
      unscheduled: "true", shippedFrom: "2026-10-01T00:00:00.000Z", shippedBefore: "2026-11-01T00:00:00.000Z" };
    expect(listOrderAggregatesSchema.parse(query)).toMatchObject(query);
  });

  it("rejects invalid dates and statuses", () => {
    for (const query of [{ scheduledFrom: "2026-02-30" }, { deliveryStatus: "lost" }, { courierId: "x" }])
      expect(listOrderAggregatesSchema.safeParse(query).success).toBe(false);
  });
});

it("order summary carries the snapshot courier when present", () => {
  const courier = { id: "11111111-1111-4111-8111-111111111111", name: "Shalom" };
  expect(orderAggregateSummarySchema.shape.courier.parse(courier)).toEqual(courier);
  expect(orderAggregateSummarySchema.shape.courier.parse(null)).toBeNull();
});
