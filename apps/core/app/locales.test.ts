import { createInstance } from "i18next";
import { expect, test } from "vitest";
import resources from "@core/app/locales";
import { localizedPath } from "@core/app/locale";

test("authentication translations exist in both languages and preserve localized links", async () => {
  expect(Object.keys(resources.pt.translation.auth).sort()).toEqual(Object.keys(resources.es.translation.auth).sort());
  expect(Object.keys(resources.pt.translation.common).sort()).toEqual(Object.keys(resources.es.translation.common).sort());
  expect(Object.keys(resources.pt.translation.nav).sort()).toEqual(Object.keys(resources.es.translation.nav).sort());
  const i18n = createInstance();
  await i18n.init({ lng: "pt", resources });
  expect(i18n.t("auth.resetTitle")).toBe("Redefinir senha");
  expect(i18n.t("nav.greeting", { name: "Ana" })).toBe("Olá, Ana");
  expect(localizedPath("/pt-BR/forgot-password", "/reset-password")).toBe("/pt-BR/reset-password");
  expect(localizedPath("/es-PE/login", "/dashboard")).toBe("/es-PE/dashboard");
  expect(localizedPath("/login", "/dashboard")).toBe("/dashboard");
});
