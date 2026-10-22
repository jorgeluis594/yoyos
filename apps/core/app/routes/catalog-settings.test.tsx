// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createRoutesStub } from "react-router";
import { afterEach, expect, test } from "vitest";
import resources from "@core/app/locales";
import CatalogSettings from "@core/app/routes/catalog-settings";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); });

async function mount(path: string, published: boolean) {
  const Stub = createRoutesStub([{ path: "*", Component: CatalogSettings, loader: () => ({ published, url: "https://yoyos.test/catalogo/c1" }) }]);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub initialEntries={[path]} /></I18nextProvider>));
}
const goTo = () => [...container.querySelectorAll("a")].find((link) => link.textContent === "Ir a Apariencia de la tienda");

test("Settings → Catálogo shows the link only while published and points to Apariencia de la tienda in both states", async () => {
  await mount("/es-PE/settings/catalog", true);
  expect(container.textContent).toContain("Para ocultar tu catálogo, ve a Apariencia de la tienda.");
  expect((container.querySelector("#catalog-url") as HTMLInputElement).value).toBe("https://yoyos.test/catalogo/c1");
  expect([...container.querySelectorAll("button")].map((element) => element.textContent)).toContain("Copiar link");
  expect([...container.querySelectorAll("a")].map((link) => link.textContent)).toContain("Ver catálogo");
  expect(container.querySelector('[role="switch"]')).toBeNull();
  expect(goTo()?.getAttribute("href")).toBe("/es-PE/settings/store-appearance");

  act(() => root!.unmount());
  container.remove();
  await mount("/settings/catalog", false);
  expect(container.textContent).toContain("Tu catálogo está oculto. Publícalo desde Apariencia de la tienda.");
  expect(container.querySelector("#catalog-url")).toBeNull();
  expect(container.textContent).not.toContain("Copiar link");
  expect(container.textContent).not.toContain("Ver catálogo");
  expect(container.querySelector('[role="switch"]')).toBeNull();
  expect(goTo()?.getAttribute("href")).toBe("/settings/store-appearance");
});

test("Settings → Catálogo texts exist in Portuguese for the new notices", async () => {
  const pt = createInstance();
  await pt.use(initReactI18next).init({ lng: "pt", resources });
  expect(pt.t("catalogSettings.goToAppearance")).toBe("Ir para Aparência da loja");
  expect(pt.t("storeAppearance.unknownThemeNotice")).toContain("tema Clásico");
});
