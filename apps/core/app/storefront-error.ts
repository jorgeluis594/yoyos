import { isRouteErrorResponse } from "react-router";
import type { PublicStoreAppearance } from "@core/src/features/store-appearance/presentation/store-appearance-schemas";

/** What the storefront middleware throws, so the root `ErrorBoundary` can render the right buyer page. */
export type StorefrontError =
  | Readonly<{ kind: "catalog_unavailable" }>
  | Readonly<{ kind: "store_not_found"; header: Readonly<{ storeName: string; appearance: PublicStoreAppearance }> }>
  | Readonly<{ kind: "catalog_load_error" }>;

const kinds = ["catalog_unavailable", "store_not_found", "catalog_load_error"];

export function storefrontErrorOf(error: unknown): StorefrontError | null {
  if (!isRouteErrorResponse(error)) return null;
  const body = error.data as { kind?: unknown } | null;
  return typeof body?.kind === "string" && kinds.includes(body.kind) ? body as StorefrontError : null;
}
