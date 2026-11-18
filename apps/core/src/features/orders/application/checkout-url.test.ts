import { expect, test } from "vitest";
import type { CatalogSubdomain } from "@shared/catalog-subdomain";
import type { OrderId } from "@core/src/features/orders/domain/order";
import { buildCheckoutUrl, checkoutLinkOf } from "@core/src/features/orders/application/checkout-url";

const orderId = "00000000-0000-4000-8000-000000000002" as OrderId;
const fantasio = "fantasio" as CatalogSubdomain;
const path = `/checkout/${orderId}`;

test("builds the checkout link on the store's brand host", () => {
  expect(buildCheckoutUrl(new URL("https://yoyos.lat"), fantasio, orderId)).toEqual({ success: true, data: `https://fantasio.yoyos.lat${path}` });
});

test("keeps the scheme and port of the catalog base URL locally", () => {
  expect(buildCheckoutUrl(new URL("http://localhost:3000"), fantasio, orderId)).toEqual({ success: true, data: `http://fantasio.localhost:3000${path}` });
});

test("returns an explicit SUBDOMAIN_REQUIRED outcome when the company has no subdomain", () => {
  expect(buildCheckoutUrl(new URL("https://yoyos.lat"), null, orderId)).toMatchObject({ success: false, error: { code: "SUBDOMAIN_REQUIRED" } });
});

const enabled = { cancelled: false, checkoutEnabledAt: new Date("2026-10-01T12:00:00Z") };

test("checkoutLinkOf gives ready, subdomain_required or unknown", () => {
  const url = "https://fantasio.yoyos.lat/checkout/x";
  expect(checkoutLinkOf(enabled, { success: true, data: url })).toEqual({ kind: "ready", url });
  expect(checkoutLinkOf(enabled, buildCheckoutUrl(new URL("https://yoyos.lat"), null, orderId))).toEqual({ kind: "subdomain_required" });
  expect(checkoutLinkOf(enabled, { success: false, error: { code: "SERVICE_UNAVAILABLE", message: "x" } })).toEqual({ kind: "unknown" });
});

test("checkoutLinkOf is unknown for a cancelled order, one without checkout or a failed read", () => {
  const ok = { success: true, data: "https://fantasio.yoyos.lat/checkout/x" } as const;
  expect(checkoutLinkOf({ ...enabled, cancelled: true }, ok)).toEqual({ kind: "unknown" });
  expect(checkoutLinkOf({ ...enabled, checkoutEnabledAt: null }, ok)).toEqual({ kind: "unknown" });
  expect(checkoutLinkOf(enabled, null)).toEqual({ kind: "unknown" });
});
