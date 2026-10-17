import { data, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { catalogCart, type CartVariant } from "@core/src/features/catalog/cart-composition";
import { allowCatalogOrder } from "@core/src/features/catalog/presentation/rate-limit";
import { cartRefreshSchema, catalogCompanyIdSchema, continueToCheckoutSchema } from "@core/src/features/catalog/presentation/cart-schemas";
import type { LineIssue } from "@core/src/features/orders/domain/catalog-order";
import { clientIpContext } from "@core/app/client-ip-context";
import { log } from "@core/src/shared/infrastructure/logger";

export type CartRefreshResponse = Readonly<{ variants: readonly CartVariant[] }>;
export type ContinueResponse =
  | Readonly<{ checkoutUrl: string }>
  | Readonly<{ code: "LINES_UNAVAILABLE"; issues: readonly LineIssue[] }>
  | Readonly<{ code: "CATALOG_UNAVAILABLE" | "ORDER_ID_CONFLICT" | "RATE_LIMITED" | "INVALID_CART" | "SERVICE_UNAVAILABLE" }>;

const privacyHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const reply = <T,>(value: T, status = 200) => data(value, { status, headers: privacyHeaders });
// 30 lines of two UUIDs and a quantity stay well under 4 KB.
const maxBodyBytes = 16_384;

/** The JSON body, or `null` when it is not JSON or passes `maxBodyBytes`; stops reading at the limit, even without `Content-Length`. */
async function readBody(request: Request): Promise<unknown> {
  if (!request.body || Number(request.headers.get("Content-Length")) > maxBodyBytes) return null;
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for await (const chunk of request.body) {
    size += chunk.byteLength;
    if (size > maxBodyBytes) return null;
    text += decoder.decode(chunk, { stream: true });
  }
  try { return JSON.parse(text + decoder.decode()); } catch { return null; }
}

/** `GET ?v=<variantIds>`: current price and availability of the cart variants; missing ones are no longer available. */
export async function loader({ params, request }: LoaderFunctionArgs) {
  const companyId = catalogCompanyIdSchema.safeParse(params.companyId);
  const variantIds = cartRefreshSchema.safeParse(new URL(request.url).searchParams.get("v") ?? "");
  if (!companyId.success) return reply({ code: "CATALOG_UNAVAILABLE" as const }, 404);
  if (!variantIds.success) return reply<CartRefreshResponse>({ variants: [] });
  const refreshed = await catalogCart.refresh(companyId.data, variantIds.data);
  if (!refreshed.success) return reply({ code: "SERVICE_UNAVAILABLE" as const }, 503);
  if (!refreshed.data) return reply({ code: "CATALOG_UNAVAILABLE" as const }, 404);
  return reply<CartRefreshResponse>({ variants: refreshed.data });
}

/** `POST { orderId, lines }` (Continuar): creates the catalog order, or returns the one this cart id already created. */
export async function action({ params, request, context }: ActionFunctionArgs) {
  const companyId = catalogCompanyIdSchema.safeParse(params.companyId);
  if (!companyId.success) return reply<ContinueResponse>({ code: "CATALOG_UNAVAILABLE" }, 409);
  if (!allowCatalogOrder(context.get(clientIpContext) ?? "unknown")) {
    log.warn({ event: "catalog_order_rate_limited", companyId: companyId.data }, "catalog_order_rate_limited");
    return reply<ContinueResponse>({ code: "RATE_LIMITED" }, 429);
  }
  const body = continueToCheckoutSchema.safeParse(await readBody(request));
  if (!body.success) return reply<ContinueResponse>({ code: "INVALID_CART" }, 400);
  const result = await catalogCart.continueToCheckout(body.data, companyId.data);
  if (result.success) return reply<ContinueResponse>({ checkoutUrl: catalogCart.checkoutUrl(companyId.data, result.data.id) });
  const error = result.error;
  if (error.code === "LINES_UNAVAILABLE" || error.code === "CATALOG_UNAVAILABLE" || error.code === "ORDER_ID_CONFLICT") {
    log.debug({ event: "catalog_order_rejected", companyId: companyId.data, errorCode: error.code,
      issuesCount: error.code === "LINES_UNAVAILABLE" ? error.issues.length : 0 }, "catalog_order_rejected");
    return reply<ContinueResponse>(error.code === "LINES_UNAVAILABLE" ? { code: error.code, issues: error.issues } : { code: error.code }, 409);
  }
  return reply<ContinueResponse>({ code: "SERVICE_UNAVAILABLE" }, 503);
}
