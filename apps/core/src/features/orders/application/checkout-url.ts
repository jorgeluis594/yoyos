import { err, ok } from "@shared/functional";
import type { CatalogSubdomain } from "@shared/catalog-subdomain";
import type { Result } from "@shared/result";
import type { OrderId } from "@core/src/features/orders/domain/order";

export type CheckoutUrlError = Readonly<{ code: "SUBDOMAIN_REQUIRED"; message: string }>;

/** The checkout lives on the store's brand host, so a company without a catalog subdomain has no link to share yet. */
export function buildCheckoutUrl(baseUrl: URL, subdomain: CatalogSubdomain | null, orderId: OrderId): Result<string, CheckoutUrlError> {
  if (subdomain === null) return err({ code: "SUBDOMAIN_REQUIRED", message: "The company has no catalog subdomain" });
  return ok(`${baseUrl.protocol}//${subdomain}.${baseUrl.host}/checkout/${orderId}`);
}
