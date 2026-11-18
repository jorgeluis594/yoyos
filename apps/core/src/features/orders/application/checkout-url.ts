import { err, ok } from "@shared/functional";
import type { CatalogSubdomain } from "@shared/catalog-subdomain";
import type { Result } from "@shared/result";
import type { OrderId } from "@core/src/features/orders/domain/order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";

export type CheckoutUrlError = Readonly<{ code: "SUBDOMAIN_REQUIRED"; message: string }>;

/** The checkout lives on the store's brand host, so a company without a catalog subdomain has no link to share yet. */
export function buildCheckoutUrl(baseUrl: URL, subdomain: CatalogSubdomain | null, orderId: OrderId): Result<string, CheckoutUrlError> {
  if (subdomain === null) return err({ code: "SUBDOMAIN_REQUIRED", message: "The company has no catalog subdomain" });
  return ok(`${baseUrl.protocol}//${subdomain}.${baseUrl.host}/checkout/${orderId}`);
}

export type CheckoutLinkState = Readonly<{ kind: "ready"; url: string }> | Readonly<{ kind: "subdomain_required" }> | Readonly<{ kind: "unknown" }>;

/** Which order shows which link, once for the aggregate route and the web detail. Cancelled or not enabled → unknown; a read that failed or threw (null or another error) → unknown. */
export function checkoutLinkOf(order: Pick<OrderAggregate, "cancelled" | "checkoutEnabledAt">, url: Result<string, CheckoutUrlError | { code: string; message: string }> | null): CheckoutLinkState {
  if (order.cancelled || order.checkoutEnabledAt === null || url === null) return { kind: "unknown" };
  if (url.success) return { kind: "ready", url: url.data };
  return url.error.code === "SUBDOMAIN_REQUIRED" ? { kind: "subdomain_required" } : { kind: "unknown" };
}
