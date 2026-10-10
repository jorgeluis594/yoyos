import { afterEach, expect, test, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import { loader } from "@core/app/routes/buyer-payment";
import { orders } from "@core/src/features/orders/composition";
import { err, ok } from "@shared/functional";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";

afterEach(() => vi.restoreAllMocks());

test("direct payment navigation redirects pending checkout using the order's company", async () => {
  const companyId = "00000000-0000-4000-8000-000000000001" as CompanyId;
  const orderId = "00000000-0000-4000-8000-000000000002" as OrderId;
  vi.spyOn(orders, "getBuyerPaymentView").mockResolvedValue(err({ code: "CHECKOUT_UNAVAILABLE", message: "Confirm first" }));
  vi.spyOn(orders, "resolveBuyerAccess").mockResolvedValue(ok({ kind: "buyer", companyId, orderId }));
  try {
    await loader({ params: { orderId } } as unknown as LoaderFunctionArgs);
    throw new Error("Expected checkout redirect");
  } catch (response) {
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(302);
    expect((response as Response).headers.get("Location")).toBe(`/checkout/${companyId}/${orderId}`);
  }
});

test("cancelled orders cannot open buyer payment", async () => {
  vi.spyOn(orders, "getBuyerPaymentView").mockResolvedValue(err({ code: "ORDER_CANCELLED", message: "Cancelled" }));
  await expect(loader({ params: { orderId: "cancelled" } } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 409 });
});
