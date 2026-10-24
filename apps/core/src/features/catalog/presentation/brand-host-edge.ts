import type { NextFunction, Request, Response } from "express";
import type { BrandHostLocals } from "@core/src/shared/infrastructure/brand-host-locals";
import { bindRequestOperation, log } from "@core/src/shared/infrastructure/logger";
import { classifyHost } from "@core/src/features/catalog/domain/store-host";
import { catalogStorefront } from "@core/src/features/catalog/composition";
import { storefrontConfig } from "@core/src/features/catalog/infrastructure/storefront-config";

/** What the checkout calls from its own origin: the buyer order APIs and the buyer-mode quotation. */
const buyerApiPath = /^\/api\/(?:buyer\/orders|quotations)(?:\/|$)/;
const appHostRefusedPath = /^\/api\/buyer\/orders(?:\/|$)/;
const notFound = (response: Response) => response.status(404).set("Cache-Control", "no-store").json({ code: "NOT_FOUND", error: "Not found" });
const scannerPath = /\.php$|^\/\.env|^\/\.git(?:\/|$)|^\/wp-/i;

/**
 * React Router drops the headers of data thrown by its middleware (the refusal pages), so every brand-host response gets the policy here.
 * Pages that already send it append the same value, which is skipped so the header is not repeated.
 */
function sendNoReferrer(response: Response) {
  response.set("Referrer-Policy", "no-referrer");
  const append = response.append.bind(response);
  response.append = (field: string, value?: string | string[]) =>
    field.toLowerCase() === "referrer-policy" && value === "no-referrer" ? response : append(field, value);
}

/**
 * Answers before React Router on brand hosts (and malformed ones): a brand host never signs anyone in and never serves seller data.
 * The only API it serves is the buyer's, which the checkout on that same origin calls; the app host no longer serves it.
 * Misses and these answers are expected from anyone, so they are not logged beyond the request line, and none touches the database.
 */
export function brandHostEdge(request: Request, response: Response, next: NextFunction) {
  const host = classifyHost(request.hostname, storefrontConfig.host);
  bindRequestOperation({ storeHost: host.kind });
  if (host.kind === "app") return appHostRefusedPath.test(request.path) ? notFound(response) : next();
  sendNoReferrer(response);
  if (host.kind === "store" && buyerApiPath.test(request.path)) return next();
  if (/^\/api(?:\/|$)/.test(request.path)) return notFound(response);
  if (request.path === "/robots.txt" && (request.method === "GET" || request.method === "HEAD"))
    return response.status(200).type("text/plain").set("Cache-Control", "public, max-age=86400").send("User-agent: *\nDisallow: /\n");
  if (scannerPath.test(request.path)) return response.status(404).type("text/plain").send("Not found");
  return next();
}

/**
 * Buyer APIs on a brand host work for the host's company only, published catalog or not: this resolves that company once and the router
 * answers any other company's order as not found. An unheld subdomain answers like every other API path of a brand host.
 */
export async function brandHostBuyerOwner(request: Request, response: Response, next: NextFunction) {
  const host = classifyHost(request.hostname, storefrontConfig.host);
  if (host.kind !== "store") return next();
  try {
    const owner = await catalogStorefront.resolveOwner(host);
    if (!owner.success) {
      log.error({ event: "buyer_api_owner_failed", errorCode: owner.error.code }, "Brand host owner lookup failed");
      bindRequestOperation({ outcome: "technical_failure" });
      return response.status(503).set("Cache-Control", "no-store").json({ code: "SERVICE_UNAVAILABLE", error: "Order unavailable" });
    }
    if (!owner.data) return notFound(response);
    (response.locals as BrandHostLocals).brandHostCompanyId = owner.data.companyId;
    return next();
  } catch (cause) {
    return next(cause);
  }
}
