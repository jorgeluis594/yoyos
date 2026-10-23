import { data, redirect, type LoaderFunctionArgs } from "react-router";
import { catalogLegacy } from "@core/src/features/catalog/composition";
import { storeUrl } from "@core/src/features/catalog/infrastructure/storefront-config";
import { catalogCompanyIdSchema } from "@core/src/features/catalog/presentation/cart-schemas";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { catalogHeaders } from "@core/app/components/catalog-sections";
import type { StorefrontError } from "@core/app/storefront-error";

const refuse = (body: StorefrontError, status: number) => data(body, { status, headers: catalogHeaders });

/**
 * `/catalogo/:companyId` and its product pages only redirect, permanently, to the brand address with the query kept.
 * `no-store` keeps browsers from holding the target after the seller changes the subdomain. The product is not checked.
 */
export async function loader({ params, request }: LoaderFunctionArgs) {
  bindRequestOperation({ operation: "legacy_catalog_link" });
  const companyId = catalogCompanyIdSchema.safeParse(params.companyId);
  if (!companyId.success) {
    bindRequestOperation({ outcome: "unavailable" });
    throw refuse({ kind: "catalog_unavailable" }, 404);
  }
  const link = await catalogLegacy.resolve(companyId.data);
  if (!link.success) {
    bindRequestOperation({ outcome: "technical_failure" });
    throw refuse({ kind: "catalog_load_error" }, 503);
  }
  if (link.data.kind === "unavailable") {
    bindRequestOperation({ outcome: "unavailable" });
    throw refuse({ kind: "catalog_unavailable" }, 404);
  }
  const target = storeUrl(link.data.subdomain, params.productId ? `/productos/${encodeURIComponent(params.productId)}` : "/");
  target.search = new URL(request.url).search;
  bindRequestOperation({ outcome: "loaded" });
  return redirect(target.toString(), { status: 308, headers: { "Cache-Control": "no-store" } });
}

/** Only the error boundary of the root ever renders for this route. */
export default function LegacyCatalogLink() {
  return null;
}
