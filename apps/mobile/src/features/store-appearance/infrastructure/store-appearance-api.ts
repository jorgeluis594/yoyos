import { saveStoreAppearanceSchema, storeAppearanceResponseSchema, type SaveStoreAppearanceBody, type StoreAppearanceResponse } from "@shared/contracts/store-appearance";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";
import type { SaveStoreAppearanceError } from "@mobile/features/store-appearance/application/store-appearance";

type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;
type Readable = Extract<StoreAppearanceResponse, { kind: "readable" }>;

const invalid = (message: string): Result<never, { code: "INVALID_RESPONSE"; message: string }> => err({ code: "INVALID_RESPONSE", message });

function parseResponse(raw: Result<unknown, TransportError>): Result<StoreAppearanceResponse, TransportError> {
  if (!raw.success) return raw;
  const parsed = storeAppearanceResponseSchema.safeParse(raw.data);
  return parsed.success ? ok(parsed.data) : invalid("Invalid store appearance response");
}

/** 400 INVALID_STORE_APPEARANCE and 422 INVALID_IMAGE are the two answers the seller can act on; a code with another status is not trustworthy. */
function saveFailure(error: TransportError): SaveStoreAppearanceError {
  const code = error.http?.body && typeof error.http.body === "object" && "code" in error.http.body ? error.http.body.code : undefined;
  if (code === "INVALID_STORE_APPEARANCE") return error.http?.status === 400 ? { code, message: error.message } : { code: "INVALID_RESPONSE", message: "Unexpected store appearance error" };
  if (error.code === "INVALID_IMAGE" && error.http?.status === 422) return { code: "INVALID_IMAGE", message: error.message };
  return { code: error.code, message: error.message };
}

export function createStoreAppearanceApi(request: Request) {
  return {
    get: async () => parseResponse(await request("/api/store-appearance")),
    async save(body: SaveStoreAppearanceBody): Promise<Result<Readable, SaveStoreAppearanceError>> {
      const checked = saveStoreAppearanceSchema.safeParse(body);
      if (!checked.success) return err({ code: "INVALID_STORE_APPEARANCE", message: "Invalid store appearance" });
      const raw = await request("/api/store-appearance", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(checked.data) });
      if (!raw.success) return err(saveFailure(raw.error));
      const parsed = parseResponse(raw);
      if (!parsed.success) return parsed;
      return parsed.data.kind === "readable" ? ok(parsed.data) : invalid("Saving did not answer a readable appearance");
    },
  };
}
