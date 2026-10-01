import { RouterContextProvider } from "react-router";
import { expect, test } from "vitest";
import { getInstance, i18nextMiddleware } from "@core/app/middleware/i18next";

test("interpolated names retain apostrophes and ampersands", async () => {
  const context = new RouterContextProvider();
  const url = new URL("http://localhost/es-PE/dashboard");
  await i18nextMiddleware(
    { request: new Request(url), url, pattern: "/:locale/dashboard", context, params: {} },
    async () => new Response(),
  );

  const name = "D'Angelo & Ana";
  expect(getInstance(context).t("nav.greeting", { name })).toBe("Hola, D'Angelo & Ana");
  expect(getInstance(context).t("orders.addNamed", { name })).toBe("Agregar D'Angelo & Ana");
});
