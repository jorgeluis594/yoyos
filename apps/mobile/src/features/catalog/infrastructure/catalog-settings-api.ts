import { catalogSettingsSchema, type CatalogSettingsResponse } from "@shared/contracts/catalog";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";

type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;

function response(raw: Result<unknown, TransportError>): Result<CatalogSettingsResponse, TransportError> {
  if (!raw.success) return raw;
  const parsed = catalogSettingsSchema.safeParse(raw.data);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_RESPONSE", message: "Invalid catalog settings response" });
}

export function createCatalogSettingsApi(request: Request) {
  return {
    get: async () => response(await request("/api/catalog/settings")),
    setPublished: async (published: boolean) => response(await request("/api/catalog/settings", { method: "PUT",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ published }) })),
  };
}
