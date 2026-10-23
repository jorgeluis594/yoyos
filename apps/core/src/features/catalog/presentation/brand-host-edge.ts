import type { NextFunction, Request, Response } from "express";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { classifyHost } from "@core/src/features/catalog/domain/store-host";
import { storefrontConfig } from "@core/src/features/catalog/infrastructure/storefront-config";

const scannerPath = /\.php$|^\/\.env|^\/\.git(?:\/|$)|^\/wp-/i;

/**
 * Answers before React Router on brand hosts (and malformed ones): a brand host never signs anyone in and never serves seller data.
 * Misses and these answers are expected from anyone, so they are not logged beyond the request line, and none touches the database.
 */
export function brandHostEdge(request: Request, response: Response, next: NextFunction) {
  const host = classifyHost(request.hostname, storefrontConfig.host);
  bindRequestOperation({ storeHost: host.kind });
  if (host.kind === "app") return next();
  if (/^\/api(?:\/|$)/.test(request.path)) return response.status(404).set("Cache-Control", "no-store").json({ code: "NOT_FOUND", error: "Not found" });
  if (request.path === "/robots.txt" && (request.method === "GET" || request.method === "HEAD"))
    return response.status(200).type("text/plain").set("Cache-Control", "public, max-age=86400").send("User-agent: *\nDisallow: /\n");
  if (scannerPath.test(request.path)) return response.status(404).type("text/plain").send("Not found");
  return next();
}
