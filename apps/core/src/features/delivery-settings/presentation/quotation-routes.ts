import express, { type Response } from "express";
import { createQuotationRequestSchema, quotationApiErrorSchema, quotationResponseSchema, type CreateQuotationRequest } from "@shared/contracts/quotations";
import { orders } from "@core/src/features/orders";
import { peruDeliveryDistrict } from "@shared/peru-geography";
import type { QuotedDeliveryRate } from "@core/src/features/delivery-settings/domain/quotation";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import type { BrandHostLocals } from "@core/src/shared/infrastructure/brand-host-locals";
import { apiError, loadApiAccess, requireApiCompany, type AuthenticatedLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { bindCompanyToRequest, bindRequestOperation, log } from "@core/src/shared/infrastructure/logger";

function toRateContract(quoted: QuotedDeliveryRate) {
  const { rate, name, zoneName } = quoted;
  const common = { id: rate.id, optionId: rate.optionId, name, zoneName, price: rate.price };
  return "agencies" in quoted
    ? { ...common, method: "agency", agencies: quoted.agencies.map(({ agency, courier }) => ({ id: agency.id, name: agency.name, address: agency.address,
      location: peruDeliveryDistrict(agency.districtCode), courier: { id: courier.id, name: courier.name } })) }
    : { ...common, method: "home" };
}

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
  // The buyer's quotation is served on the brand host of the order's company; the seller's, on the app host only.
  const hostCompanyId = (response.locals as BrandHostLocals).brandHostCompanyId;
  if ((input.orderId !== undefined) !== (hostCompanyId !== undefined)) return apiError(response, 404, "CHECKOUT_UNAVAILABLE", "Checkout unavailable");
  if (input.orderId !== undefined && hostCompanyId !== undefined) {
    bindCompanyToRequest(hostCompanyId);
    const access = await orders.resolveBuyerAccess(input.orderId, hostCompanyId);
    if (!access.success) return access.error.code === "PERSISTENCE_UNAVAILABLE"
      ? apiError(response, 503, "SERVICE_UNAVAILABLE", "Checkout unavailable")
      : apiError(response, 404, "CHECKOUT_UNAVAILABLE", "Checkout unavailable");
    const checkout = await orders.getCheckoutView({ companyId: access.data.companyId, orderId: access.data.orderId });
    if (!checkout.success) return checkout.error.code === "PERSISTENCE_UNAVAILABLE"
      ? apiError(response, 503, "SERVICE_UNAVAILABLE", "Checkout unavailable")
      : apiError(response, checkout.error.code === "CHECKOUT_UNAVAILABLE" ? 404 : 500,
        checkout.error.code === "CHECKOUT_UNAVAILABLE" ? "CHECKOUT_UNAVAILABLE" : "INTERNAL_ERROR", "Checkout unavailable");
    if (checkout.data.state.kind === "cancelled") return apiError(response, 422, "ORDER_CANCELLED", "Order cancelled");
    response.locals.quotationCompanyId = access.data.companyId;
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
    createdAt: result.data.quotation.createdAt.toISOString(), rates: result.data.rates.map(toRateContract) });
  if (!output.success) {
    log.error({ event: "quotation_response_invalid", companyId }, "Invalid quotation response");
    return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
  return response.status(201).json(output.data);
});
