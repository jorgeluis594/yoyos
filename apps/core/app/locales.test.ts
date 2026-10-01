import { createInstance } from "i18next";
import { expect, test } from "vitest";
import resources from "@core/app/locales";
import { companyPath, localizedPath } from "@core/app/locale";

test("authentication translations exist in both languages and preserve localized links", async () => {
  expect(Object.keys(resources.pt.translation.auth).sort()).toEqual(Object.keys(resources.es.translation.auth).sort());
  expect(Object.keys(resources.pt.translation.common).sort()).toEqual(Object.keys(resources.es.translation.common).sort());
  expect(Object.keys(resources.pt.translation.nav).sort()).toEqual(Object.keys(resources.es.translation.nav).sort());
  expect(Object.keys(resources.pt.translation.products).sort()).toEqual(Object.keys(resources.es.translation.products).sort());
  expect(Object.keys(resources.pt.translation.orders).sort()).toEqual(Object.keys(resources.es.translation.orders).sort());
  expect(Object.keys(resources.pt.translation.productErrors).sort()).toEqual(Object.keys(resources.es.translation.productErrors).sort());
  expect(Object.keys(resources.pt.translation.productErrors.label).sort()).toEqual(Object.keys(resources.es.translation.productErrors.label).sort());
  expect(Object.keys(resources.pt.translation.productErrors.subject).sort()).toEqual(Object.keys(resources.es.translation.productErrors.subject).sort());
  expect(Object.keys(resources.pt.translation.emails).sort()).toEqual(Object.keys(resources.es.translation.emails).sort());
  const i18n = createInstance();
  await i18n.init({ lng: "pt", resources });
  expect(i18n.t("auth.resetTitle")).toBe("Redefinir senha");
  expect(i18n.t("common.close")).toBe("Fechar");
  expect(i18n.t("nav.greeting", { name: "Ana" })).toBe("Olá, Ana");
  expect(i18n.t("orders.itemCount_one", { count: 1 })).toBe("1 produto");
  expect(i18n.t("orders.itemCount_other", { count: 2 })).toBe("2 produtos");
  expect(localizedPath("/pt-BR/forgot-password", "/reset-password")).toBe("/pt-BR/reset-password");
  expect(localizedPath("/es-PE/login", "/dashboard")).toBe("/es-PE/dashboard");
  expect(localizedPath("/login", "/dashboard")).toBe("/dashboard");
  expect(companyPath("/pt-BR/products", "PE", "/products/1")).toBe("/pt-BR/products/1");
  expect(companyPath("/products", "PE", "/products/1")).toBe("/es-PE/products/1");
});
