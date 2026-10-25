import { data, type MiddlewareFunction } from "react-router";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { catalogBrowse } from "@core/src/features/catalog/browse-composition";
import { catalogStorefront } from "@core/src/features/catalog/composition";
import { classifyHost } from "@core/src/features/catalog/domain/store-host";
import { storefrontConfig } from "@core/src/features/catalog/infrastructure/storefront-config";
import { catalogHeaders } from "@core/app/components/catalog-sections";
import { orders } from "@core/src/features/orders/composition";
import { brandHostCompanyContext } from "@core/app/brand-host-context";
import { requestHostContext } from "@core/app/request-host-context";
import { storefrontContext } from "@core/app/storefront-context";
import type { StorefrontError } from "@core/app/storefront-error";

/** Single-fetch data requests ask for `/_root.data` (the index) and `<path>.data`; both name the document path. */
export function documentPath(pathname: string): string {
  const path = pathname === "/_root.data" ? "/" : pathname.replace(/\.data$/, "");
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

/** The closed list a brand host serves: the grid, a product page and the cart resource route. */
export function isStorefrontPath(pathname: string): boolean {
  const path = documentPath(pathname);
  return path === "/" || path === "/carrito" || /^\/productos\/[^/]+$/.test(path);
}

/** The checkout page, its single-fetch requests and its catch-all: a brand host serves them, the app host no longer does. */
export function isCheckoutPath(pathname: string): boolean {
  return /^\/checkout(?:\/|$)/.test(documentPath(pathname));
}

/** A refusal ends the request here, so this is the operation that the request log names. */
function refuse(body: StorefrontError, status: number) {
  bindRequestOperation({ operation: "resolve_storefront", outcome: status >= 500 ? "technical_failure" : "unavailable" });
  return data(body, { status, headers: catalogHeaders });
}

const checkoutOrderPath = /^\/checkout\/([^/]+)$/;
const privacyHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/**
 * A brand host serves the checkout and, on the same origin, the buyer APIs it calls. The catalog being hidden does not matter: a hidden or unknown host
 * only answers a checkout that is an order of its own company, and anything else is the same «Catálogo no disponible» as its other paths.
 */
async function serveCheckout(host: Parameters<typeof catalogStorefront.resolveOwner>[0], path: string, context: Parameters<MiddlewareFunction<Response>>[0]["context"]) {
  const owner = await catalogStorefront.resolveOwner(host);
  if (!owner.success) throw refuse({ kind: "catalog_load_error" }, 503);
  if (!owner.data) throw refuse({ kind: "catalog_unavailable" }, 404);
  context.set(brandHostCompanyContext, owner.data.companyId);
  if (owner.data.published) return;
  const target = checkoutOrderPath.exec(path);
  if (!target) throw refuse({ kind: "catalog_unavailable" }, 404);
  const access = await orders.resolveBuyerAccess(target[1]);
  if (access.success && access.data.companyId === owner.data.companyId) return;
  const failed = !access.success && access.error.code !== "INVALID_ORDER" && access.error.code !== "ORDER_NOT_FOUND";
  throw failed ? refuse({ kind: "catalog_load_error" }, 503) : refuse({ kind: "catalog_unavailable" }, 404);
}

/**
 * On a brand host: resolves the store with one lookup, keeps it in `storefrontContext` and serves only the storefront paths.
 * `/carrito` is never refused here, so its JSON outcomes stay JSON. The checkout paths follow `serveCheckout`. The app host serves everything but the checkout.
 */
export const storefrontMiddleware: MiddlewareFunction<Response> = async ({ request, context }, next) => {
  const url = new URL(request.url);
  const host = classifyHost(context.get(requestHostContext) ?? url.hostname, storefrontConfig.host);
  const path = documentPath(url.pathname);
  if (host.kind === "app") {
    if (!isCheckoutPath(path)) return next();
    bindRequestOperation({ outcome: "unavailable" });
    throw data(null, { status: 404, headers: privacyHeaders });
  }
  // Lazy route discovery asks for the route manifest of the store's own pages: nothing to look up.
  if (path === "/__manifest") return next();
  if (isCheckoutPath(path)) {
    await serveCheckout(host, path, context);
    return next();
  }
  const resolved = await catalogStorefront.resolve(host);
  const cart = path === "/carrito";
  if (!resolved.success) {
    context.set(storefrontContext, { kind: "error" });
    if (cart) return next();
    throw refuse({ kind: "catalog_load_error" }, 503);
  }
  context.set(storefrontContext, resolved.data);
  if (cart) return next();
  if (resolved.data.kind === "unavailable") throw refuse({ kind: "catalog_unavailable" }, 404);
  if (!isStorefrontPath(path)) {
    const { appearance } = await catalogBrowse.storeAppearance(resolved.data.companyId);
    throw refuse({ kind: "store_not_found", header: { storeName: resolved.data.store.name, appearance } }, 404);
  }
  return next();
};
