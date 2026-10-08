import express, { type Response } from "express";
import { createQuotationRequestSchema, quotationApiErrorSchema, quotationResponseSchema, type CreateQuotationRequest } from "@shared/contracts/quotations";
import { orders } from "@core/src/features/orders";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import { apiError, loadApiAccess, requireApiCompany, type AuthenticatedLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { bindCompanyToRequest, bindRequestOperation, log } from "@core/src/shared/infrastructure/logger";

export const quotationRoutes = express.Router();
quotationRoutes.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
quotationRoutes.post("/", (request, response, next) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const parsed = createQuotationRequestSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid quotation request");
  response.locals.quotationInput = parsed.data;
  return next();
}, async (request, response: Response<unknown, AuthenticatedLocals & { quotationInput: CreateQuotationRequest; quotationCompanyId: string }>, next) => {
  const input = response.locals.quotationInput as CreateQuotationRequest;
  // Order-link authorization takes precedence over any seller session.
  if (input.orderId !== undefined) {
    const access = await orders.resolveBuyerAccess(input.orderId);
    if (!access.success) return access.error.code === "PERSISTENCE_UNAVAILABLE"
      ? apiError(response, 503, "SERVICE_UNAVAILABLE", "Checkout unavailable")
      : apiError(response, 404, "CHECKOUT_UNAVAILABLE", "Checkout unavailable");
    const checkout = await orders.getCheckout({ companyId: access.data.companyId, orderId: access.data.orderId });
    if (!checkout.success) return checkout.error.code === "PERSISTENCE_UNAVAILABLE"
      ? apiError(response, 503, "SERVICE_UNAVAILABLE", "Checkout unavailable")
      : apiError(response, checkout.error.code === "CHECKOUT_UNAVAILABLE" ? 404 : 500,
        checkout.error.code === "CHECKOUT_UNAVAILABLE" ? "CHECKOUT_UNAVAILABLE" : "INTERNAL_ERROR", "Checkout unavailable");
    if (checkout.data.state.kind === "cancelled") return apiError(response, 422, "ORDER_CANCELLED", "Order cancelled");
    response.locals.quotationCompanyId = access.data.companyId;
    bindCompanyToRequest(access.data.companyId);
    return withTenantIsolation(access.data.companyId, next);
  }
  return loadApiAccess(request, response, () => requireApiCompany(request, response, () => {
    const access = response.locals.auth;
    if (access.status !== "ready") return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
    response.locals.quotationCompanyId = access.company.id;
    next();
  }));
}, async (_request, response) => {
  bindRequestOperation({ operation: "create_quotation" });
  const input = response.locals.quotationInput as CreateQuotationRequest;
  const companyId = response.locals.quotationCompanyId as string;
  const result = await deliverySettings.createQuotation({ companyId, country: input.destination.country, districtCode: input.destination.districtCode,
    address: input.destination.address ?? null, instructions: input.destination.instructions ?? null });
  if (!result.success) {
    const error = result.error;
    const status = error.code === "SERVICE_UNAVAILABLE" ? 503 : error.code === "INTERNAL_ERROR" ? 500 : error.code === "INVALID_INPUT" ? 400 : 422;
    return response.status(status).json(quotationApiErrorSchema.parse({ code: error.code, error: "Unable to create quotation",
      ...("field" in error ? { field: error.field } : {}), ...("districtCode" in error ? { districtCode: error.districtCode } : {}) }));
  }
  const output = quotationResponseSchema.safeParse({ id: result.data.quotation.id, destination: result.data.quotation.destination,
    createdAt: result.data.quotation.createdAt.toISOString(), rates: result.data.rates.map(rate => ({ id: rate.id, method: rate.method,
      label: rate.method === "home" ? "Entrega a domicilio" : "Retiro en agencia", price: rate.price })) });
  if (!output.success) {
    log.error({ event: "quotation_response_invalid", companyId }, "Invalid quotation response");
    return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
  return response.status(201).json(output.data);
});
