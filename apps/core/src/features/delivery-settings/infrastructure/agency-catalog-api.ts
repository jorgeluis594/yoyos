import { err, ok } from "@shared/functional";
import { getPeruDistrict } from "@shared/peru-geography";
import type { Result } from "@shared/result";
import { agencyCatalogSchema, type AgencyCatalogResponse } from "@shared/contracts/delivery-settings";

export type AgencyCatalogClientError = Readonly<{ code: "NOT_FOUND" | "UNAUTHENTICATED" | "SERVICE_UNAVAILABLE" | "INVALID_RESPONSE"; message: string }>;

/** Browser reader of the agency catalog; no screen consumes it yet. */
export async function readAgencyCatalog(courierId: string, fetcher: typeof fetch = fetch): Promise<Result<AgencyCatalogResponse, AgencyCatalogClientError>> {
  let response: Response;
  try {
    response = await fetcher(`/api/delivery-settings/agency-catalog?courierId=${encodeURIComponent(courierId)}`,
      { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15000) });
  } catch { return err({ code: "SERVICE_UNAVAILABLE", message: "Unable to read agency catalog" }); }
  if (response.status === 404) return err({ code: "NOT_FOUND", message: "Courier not found" });
  if (response.status === 401 || response.status === 403) return err({ code: "UNAUTHENTICATED", message: "Session required" });
  if (!response.ok) return err({ code: "SERVICE_UNAVAILABLE", message: "Unable to read agency catalog" });
  const parsed = agencyCatalogSchema.safeParse(await response.json().catch(() => null));
  return parsed.success && parsed.data.agencies.every(agency => agency.courierId === courierId && agency.enabled && getPeruDistrict(agency.location.districtCode))
    ? ok(parsed.data) : err({ code: "INVALID_RESPONSE", message: "Invalid agency catalog response" });
}
