import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { EmbeddingModel } from "@core/src/features/products/domain/image-identification";
import type { CatalogSearchReadiness } from "@core/src/features/products/domain/text-identification";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

export type CatalogSearchReadinessDependencies = Readonly<{
  /** The embedding model of visual search, null when it is disabled. */
  visualModel: EmbeddingModel | null;
  /** Products with an active variant (RLS): none, only hidden ones, or at least one offered. */
  productPresence: () => Promise<Result<"none" | "hidden_only" | "offered", PersistenceError>>;
  hasIndexedProducts: (model: EmbeddingModel) => Promise<Result<boolean, PersistenceError>>;
}>;

/** Whether a customer's photo or text can find anything in the company's catalog. */
export async function catalogSearchReadiness(deps: CatalogSearchReadinessDependencies): Promise<Result<CatalogSearchReadiness, PersistenceError>> {
  const presence = await deps.productPresence();
  if (!presence.success) return presence;
  if (presence.data === "none") return ok("no_active_products");
  if (presence.data === "hidden_only") return ok("all_products_hidden");
  if (!deps.visualModel) return ok("no_searchable_photos");
  const indexed = await deps.hasIndexedProducts(deps.visualModel);
  if (!indexed.success) return indexed;
  return ok(indexed.data ? "ready" : "no_searchable_photos");
}
