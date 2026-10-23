import type { NextFunction, Request, Response } from "express";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { classifyHost } from "@core/src/features/catalog/domain/store-host";
import { storefrontConfig } from "@core/src/features/catalog/infrastructure/storefront-config";

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
 * Misses and these answers are expected from anyone, so they are not logged beyond the request line, and none touches the database.
 */
export function brandHostEdge(request: Request, response: Response, next: NextFunction) {
  const host = classifyHost(request.hostname, storefrontConfig.host);
  bindRequestOperation({ storeHost: host.kind });
  if (host.kind === "app") return next();
  sendNoReferrer(response);
  if (/^\/api(?:\/|$)/.test(request.path)) return response.status(404).set("Cache-Control", "no-store").json({ code: "NOT_FOUND", error: "Not found" });
  if (request.path === "/robots.txt" && (request.method === "GET" || request.method === "HEAD"))
    return response.status(200).type("text/plain").set("Cache-Control", "public, max-age=86400").send("User-agent: *\nDisallow: /\n");
  if (scannerPath.test(request.path)) return response.status(404).type("text/plain").send("Not found");
  return next();
}
