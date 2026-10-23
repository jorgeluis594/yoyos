import { data, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { catalogCart, type CartVariant } from "@core/src/features/catalog/cart-composition";
import { allowCatalogOrder, allowCatalogOrderCheck } from "@core/src/features/catalog/presentation/rate-limit";
import { cartIntentSchema, cartRefreshSchema, checkCartOrderSchema, continueToCheckoutSchema } from "@core/src/features/catalog/presentation/cart-schemas";
import type { PublishedStorefront } from "@core/src/features/catalog/application/resolve-storefront";
import type { LineIssue } from "@core/src/features/orders/domain/catalog-order";
import { clientIpContext } from "@core/app/client-ip-context";
import { storefrontContext } from "@core/app/storefront-context";
import { bindCompanyToRequest, bindRequestOperation, log } from "@core/src/shared/infrastructure/logger";

export type CartRefreshResponse = Readonly<{ variants: readonly CartVariant[] }>;
export type ContinueResponse =
  | Readonly<{ checkoutUrl: string }>
  | Readonly<{ code: "LINES_UNAVAILABLE"; issues: readonly LineIssue[] }>
  | Readonly<{ code: "CATALOG_UNAVAILABLE" | "ORDER_ID_CONFLICT" | "RATE_LIMITED" | "INVALID_CART" | "SERVICE_UNAVAILABLE" }>;
export type CheckOrderResponse = Readonly<{ order: "confirmed" | "not_confirmed" }> | Readonly<{ code: "CATALOG_UNAVAILABLE" | "RATE_LIMITED" | "INVALID_CART" | "SERVICE_UNAVAILABLE" }>;

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
export async function loader({ request, context }: LoaderFunctionArgs) {
  const storefront = context.get(storefrontContext);
  if (storefront?.kind === "error") return reply({ code: "SERVICE_UNAVAILABLE" as const }, 503);
  if (storefront?.kind !== "published") return reply({ code: "CATALOG_UNAVAILABLE" as const }, 404);
  const variantIds = cartRefreshSchema.safeParse(new URL(request.url).searchParams.get("v") ?? "");
  if (!variantIds.success) return reply<CartRefreshResponse>({ variants: [] });
  const refreshed = await catalogCart.refresh(storefront, variantIds.data);
  if (!refreshed.success) return reply({ code: "SERVICE_UNAVAILABLE" as const }, 503);
  return reply<CartRefreshResponse>({ variants: refreshed.data });
}

/** `POST { intent, … }`: `continue` creates the catalog order or returns the one this cart id already created; `check_order` tells whether it was confirmed. */
export async function action({ request, context }: ActionFunctionArgs) {
  const storefront = context.get(storefrontContext);
  if (storefront?.kind === "error") return reply({ code: "SERVICE_UNAVAILABLE" as const }, 503);
  if (storefront?.kind !== "published") return reply({ code: "CATALOG_UNAVAILABLE" as const }, 409);
  const body = await readBody(request);
  const intent = cartIntentSchema.safeParse(body);
  const ip = context.get(clientIpContext) ?? "unknown";
  if (intent.success && intent.data.intent === "check_order") return checkOrder(body, storefront, ip);
  if (intent.success) return continueToCheckout(body, storefront, ip);
  return reply<ContinueResponse>({ code: "INVALID_CART" }, 400);
}

async function checkOrder(body: unknown, storefront: PublishedStorefront, ip: string) {
  bindRequestOperation({ operation: "check_cart_order" });
  bindCompanyToRequest(storefront.companyId);
  if (!allowCatalogOrderCheck(ip)) {
    bindRequestOperation({ outcome: "rate_limited" });
    return reply<CheckOrderResponse>({ code: "RATE_LIMITED" }, 429);
  }
  const parsed = checkCartOrderSchema.safeParse(body);
  if (!parsed.success) {
    bindRequestOperation({ outcome: "invalid_input" });
    return reply<CheckOrderResponse>({ code: "INVALID_CART" }, 400);
  }
  const result = await catalogCart.checkOrder(parsed.data.orderId, storefront);
  if (!result.success) {
    bindRequestOperation({ outcome: "technical_failure" });
    return reply<CheckOrderResponse>({ code: "SERVICE_UNAVAILABLE" }, 503);
  }
  bindRequestOperation({ outcome: result.data === "confirmed" ? "confirmed" : "pending" });
  return reply<CheckOrderResponse>({ order: result.data });
}

async function continueToCheckout(body: unknown, storefront: PublishedStorefront, ip: string) {
  if (!allowCatalogOrder(ip)) {
    log.warn({ event: "catalog_order_rate_limited", companyId: storefront.companyId }, "catalog_order_rate_limited");
    return reply<ContinueResponse>({ code: "RATE_LIMITED" }, 429);
  }
  const parsed = continueToCheckoutSchema.safeParse(body);
  if (!parsed.success) return reply<ContinueResponse>({ code: "INVALID_CART" }, 400);
  const result = await catalogCart.continueToCheckout({ orderId: parsed.data.orderId, lines: parsed.data.lines }, storefront);
  if (result.success) return reply<ContinueResponse>({ checkoutUrl: catalogCart.checkoutUrl(storefront.companyId, result.data.id) });
  const error = result.error;
  if (error.code === "LINES_UNAVAILABLE" || error.code === "CATALOG_UNAVAILABLE" || error.code === "ORDER_ID_CONFLICT") {
    log.debug({ event: "catalog_order_rejected", companyId: storefront.companyId, errorCode: error.code,
      issuesCount: error.code === "LINES_UNAVAILABLE" ? error.issues.length : 0 }, "catalog_order_rejected");
    return reply<ContinueResponse>(error.code === "LINES_UNAVAILABLE" ? { code: error.code, issues: error.issues } : { code: error.code }, 409);
  }
  return reply<ContinueResponse>({ code: "SERVICE_UNAVAILABLE" }, 503);
}
