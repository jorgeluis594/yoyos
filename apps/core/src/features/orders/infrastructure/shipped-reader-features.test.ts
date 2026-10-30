import { expect, test } from "vitest";
import { shippedReaderFeatures } from "@core/src/features/orders/infrastructure/shipped-reader-features";

test("ships both reader features until the tuning on dev decides otherwise", () => {
  expect(shippedReaderFeatures).toEqual({ paymentRequest: true, closedOrderLine: true });
});
