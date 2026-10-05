import express from "express";
import { buyerPaymentViewSchema, reportPaymentResponseSchema, reportPaymentSchema } from "@shared/contracts/orders";
import { apiError } from "@core/src/shared/infrastructure/api-auth-middleware";
import { bindCompanyToRequest, log } from "@core/src/shared/infrastructure/logger";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { orders } from "@core/src/features/orders/composition";
import type { BuyerPaymentAccess } from "@core/src/features/orders/application/report-payment";
import type { ImageId } from "@core/src/features/orders/domain/payment";
import type { PaymentId } from "@core/src/features/orders/domain/order";

export function buyerPaymentRoutes(images: express.Router) {
  const router = express.Router();
  router.use("/:orderId", async (request, response, next) => {
    try {
      const access = await orders.resolveBuyerAccess(request.params.orderId as string);
      if (!access.success) return access.error.code === "INVALID_ORDER"
        ? apiError(response, 400, "INVALID_INPUT", "Invalid order ID")
        : access.error.code === "ORDER_NOT_FOUND" ? apiError(response, 404, "ORDER_NOT_FOUND", "Order not found")
          : apiError(response, 503, "SERVICE_UNAVAILABLE", "Order unavailable");
      response.locals.buyerAccess = access.data;
      bindCompanyToRequest(access.data.companyId);
      return withTenantIsolation(access.data.companyId, next);
    } catch (error) {
      log.error({ event: "buyer_payment_access_failed", err: error }, "Buyer payment access failed");
      return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
    }
  });
  router.get("/:orderId/payment", async (request, response) => {
    try {
      const result = await orders.getBuyerPaymentView(request.params.orderId as string);
      if (!result.success) return apiError(response, result.error.code === "ORDER_NOT_FOUND" ? 404 : 503,
        result.error.code === "ORDER_NOT_FOUND" ? "ORDER_NOT_FOUND" : "SERVICE_UNAVAILABLE", "Payment view unavailable");
      return response.json(buyerPaymentViewSchema.parse(result.data));
    } catch (error) {
      log.error({ event: "buyer_payment_view_failed", err: error }, "Buyer payment view failed");
      return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
    }
  });
  router.post("/:orderId/reports", async (request, response) => {
    if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
    const parsed = reportPaymentSchema.safeParse(request.body);
    if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid payment report");
    try {
      const access = response.locals.buyerAccess as BuyerPaymentAccess;
      const result = await orders.reportPayment({ paymentId: parsed.data.paymentId as PaymentId,
        receiptImageId: parsed.data.receiptImageId as ImageId }, access);
      if (!result.success) {
        const code = result.error.code;
        return apiError(response, code === "RECEIPT_NOT_FOUND" || code === "INVALID_PAYMENT" ? 422 : code === "PAYMENT_CONFLICT" || code === "ORDER_CANCELLED" ? 409 : 503,
          code === "RECEIPT_NOT_FOUND" ? "RECEIPT_NOT_FOUND" : code === "PAYMENT_CONFLICT" ? "PAYMENT_CONFLICT"
            : code === "ORDER_CANCELLED" ? "ORDER_CANCELLED" : code === "INVALID_PAYMENT" ? "INVALID_PAYMENT" : "SERVICE_UNAVAILABLE", "Payment report unavailable");
      }
      return response.status(201).json(reportPaymentResponseSchema.parse({ paymentId: parsed.data.paymentId, status: "reported" }));
    } catch (error) {
      log.error({ event: "buyer_payment_report_failed", err: error }, "Buyer payment report failed");
      return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
    }
  });
  router.use("/:orderId/images", (request, response, next) => request.method === "POST" ? next() : apiError(response, 404, "NOT_FOUND", "Not found"), images);
  return router;
}
