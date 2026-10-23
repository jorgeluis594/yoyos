import { data, type MiddlewareFunction } from "react-router";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { catalogBrowse } from "@core/src/features/catalog/browse-composition";
import { catalogStorefront } from "@core/src/features/catalog/composition";
import { classifyHost } from "@core/src/features/catalog/domain/store-host";
import { storefrontConfig } from "@core/src/features/catalog/infrastructure/storefront-config";
import { catalogHeaders } from "@core/app/components/catalog-sections";
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

/** A refusal ends the request here, so this is the operation that the request log names. */
function refuse(body: StorefrontError, status: number) {
  bindRequestOperation({ operation: "resolve_storefront", outcome: status >= 500 ? "technical_failure" : "unavailable" });
  return data(body, { status, headers: catalogHeaders });
}

/**
 * On a brand host: resolves the store with one lookup, keeps it in `storefrontContext` and serves only the storefront paths.
 * `/carrito` is never refused here, so its JSON outcomes stay JSON. The app host is left untouched.
 */
export const storefrontMiddleware: MiddlewareFunction<Response> = async ({ request, context }, next) => {
  const url = new URL(request.url);
  const host = classifyHost(context.get(requestHostContext) ?? url.hostname, storefrontConfig.host);
  if (host.kind === "app") return next();
  const path = documentPath(url.pathname);
  // Lazy route discovery asks for the route manifest of the store's own pages: nothing to look up.
  if (path === "/__manifest") return next();
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
