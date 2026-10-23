import { catalogSearchReadinessResponseSchema, type CatalogSearchReadinessResponse } from "@shared/contracts/catalog-search-readiness";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";

type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;
export type CatalogReadinessState = CatalogSearchReadinessResponse["state"];

export function createCatalogReadinessApi(request: Request) {
  return async (): Promise<Result<CatalogReadinessState, TransportError>> => {
    const raw = await request("/api/products/search-readiness");
    if (!raw.success) return raw;
    const parsed = catalogSearchReadinessResponseSchema.safeParse(raw.data);
    return parsed.success ? ok(parsed.data.state) : err({ code: "INVALID_RESPONSE", message: "Invalid catalog readiness response" });
  };
}
