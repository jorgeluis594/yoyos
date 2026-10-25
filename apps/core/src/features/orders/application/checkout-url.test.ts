import { expect, test } from "vitest";
import type { CatalogSubdomain } from "@shared/catalog-subdomain";
import type { OrderId } from "@core/src/features/orders/domain/order";
import { buildCheckoutUrl } from "@core/src/features/orders/application/checkout-url";

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
