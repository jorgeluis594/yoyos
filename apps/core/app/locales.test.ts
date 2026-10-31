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
  expect(Object.keys(resources.pt.translation.productEditor).sort()).toEqual(Object.keys(resources.es.translation.productEditor).sort());
  expect(Object.keys(resources.pt.translation.variantDetail).sort()).toEqual(Object.keys(resources.es.translation.variantDetail).sort());
  expect(Object.keys(resources.pt.translation.productErrors).sort()).toEqual(Object.keys(resources.es.translation.productErrors).sort());
  expect(Object.keys(resources.pt.translation.productErrors.label).sort()).toEqual(Object.keys(resources.es.translation.productErrors.label).sort());
  expect(Object.keys(resources.pt.translation.productErrors.subject).sort()).toEqual(Object.keys(resources.es.translation.productErrors.subject).sort());
  expect(Object.keys(resources.pt.translation.emails).sort()).toEqual(Object.keys(resources.es.translation.emails).sort());
  expect(Object.keys(resources.pt.translation.deliverySettings).sort()).toEqual(Object.keys(resources.es.translation.deliverySettings).sort());
  expect(Object.keys(resources.pt.translation.dispatchSender).sort()).toEqual(Object.keys(resources.es.translation.dispatchSender).sort());
  expect(Object.keys(resources.pt.translation.orderDelivery).sort()).toEqual(Object.keys(resources.es.translation.orderDelivery).sort());
  expect(Object.keys(resources.pt.translation.assistants).sort()).toEqual(Object.keys(resources.es.translation.assistants).sort());
  expect(Object.keys(resources.pt.translation.orderView).sort()).toEqual(Object.keys(resources.es.translation.orderView).sort());
  const i18n = createInstance();
  await i18n.init({ lng: "pt", resources });
  expect(i18n.t("orders.balanceDue", { amount: "R$ 10,00" })).toBe("Pendente: R$ 10,00");
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

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key));
}

test("Spanish and Portuguese panel texts contain the same keys", () => {
  expect(keyPaths(resources.pt.translation).sort()).toEqual(keyPaths(resources.es.translation).sort());
});

test("order view texts have the same nested keys in both languages and interpolate", async () => {
  expect(keyPaths(resources.pt.translation.orderView).sort()).toEqual(keyPaths(resources.es.translation.orderView).sort());
  const i18n = createInstance();
  await i18n.init({ lng: "es", resources, interpolation: { escapeValue: false } });
  expect(i18n.t("orderView.products.lockedDeducted")).toBe("El stock de este pedido ya se descontó; los productos ya no se pueden cambiar. Para cambiarlos, cancela el pedido y crea una venta nueva.");
  expect(i18n.t("orderView.payments.addWallet", { wallet: "Yape" })).toBe("Agregar Yape");
  expect(i18n.t("orderView.payments.partial", { amount: "S/ 148.00" })).toBe("Pago parcial · falta S/ 148.00");
  expect(i18n.t("orderView.picker.results", { count: 3 })).toBe("3 resultados");
  expect(i18n.t("orderView.picker.results", { count: 1 })).toBe("1 resultado");
  expect(i18n.t("orderView.picker.done", { count: 2 })).toBe("Listo · 2 agregados");
  expect(i18n.t("orderView.status.fieldsInvalid", { count: 1 })).toBe("No se guardó: revisa 1 campo marcado.");
  await i18n.changeLanguage("pt");
  expect(i18n.t("orderView.payments.addWallet", { wallet: "Pix" })).toBe("Adicionar Pix");
  expect(i18n.t("orderView.picker.results", { count: 3 })).toBe("3 resultados");
  expect(i18n.t("orderView.labels.shipped")).toBe("Enviada");
});
