// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createRoutesStub } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import CatalogSettings from "@core/app/routes/catalog-settings";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); });

type Settings = { published: boolean; subdomain: string | null; url: string | null; domain: string; suggestion: string | null };
const brand: Settings = { published: true, subdomain: "fantasio", url: "https://fantasio.yoyos.lat/", domain: "yoyos.lat", suggestion: null };

async function mount(path: string, settings: Settings) {
  const Stub = createRoutesStub([{ path: "*", Component: CatalogSettings, loader: () => settings }]);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub initialEntries={[path]} /></I18nextProvider>));
}
const goTo = () => [...container.querySelectorAll("a")].find((link) => link.textContent === "Ir a Apariencia de la tienda");
const remount = async (path: string, settings: Settings) => { act(() => root!.unmount()); container.remove(); await mount(path, settings); };

test("published shows «Link de tu catálogo» with the full brand URL as wrapping text, Copiar link and Ver catálogo", async () => {
  await mount("/es-PE/settings/catalog", brand);
  expect(container.textContent).toContain("Link de tu catálogo");
  const text = container.querySelector("#catalog-url")!;
  expect(text.textContent).toBe("https://fantasio.yoyos.lat/");
  expect(text.tagName).not.toBe("INPUT");
  expect(text.className).toContain("break-all");
  expect(text.className).not.toContain("truncate");
  expect(container.textContent).toContain("Para cambiar el link u ocultar tu catálogo, ve a Apariencia de la tienda.");
  expect([...container.querySelectorAll("button")].map((element) => element.textContent)).toContain("Copiar link");
  const view = [...container.querySelectorAll("a")].find((link) => link.textContent === "Ver catálogo");
  expect(view?.getAttribute("href")).toBe("https://fantasio.yoyos.lat/");
  expect(container.querySelector('[role="switch"]')).toBeNull();
});

test("Copiar link copies the full URL and announces Link copiado politely", async () => {
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await mount("/settings/catalog", brand);
  await act(async () => [...container.querySelectorAll("button")].find((element) => element.textContent === "Copiar link")!.click());
  expect(writeText).toHaveBeenCalledWith("https://fantasio.yoyos.lat/");
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("Link copiado");
  vi.unstubAllGlobals();
});

test("hidden with a subdomain and hidden without one show their texts and no link", async () => {
  await mount("/settings/catalog", { ...brand, published: false });
  expect(container.textContent).toContain("Tu catálogo está oculto. Publícalo desde Apariencia de la tienda.");
  expect(container.querySelector("#catalog-url")).toBeNull();
  expect(container.textContent).not.toContain("Copiar link");
  expect(container.textContent).not.toContain("Ver catálogo");
  await remount("/settings/catalog", { published: false, subdomain: null, url: null, domain: "yoyos.lat", suggestion: "fantasio" });
  expect(container.textContent).toContain("Tu catálogo está oculto. Elige su link y publícalo desde Apariencia de la tienda.");
  expect(container.querySelector("#catalog-url")).toBeNull();
  expect(container.textContent).not.toContain("Copiar link");
  expect(container.querySelector('[role="switch"]')).toBeNull();
});

test("Ir a Apariencia de la tienda links to the Publicar catálogo card", async () => {
  await mount("/es-PE/settings/catalog", brand);
  expect(goTo()?.getAttribute("href")).toBe("/es-PE/settings/store-appearance#catalog-publication");
  await remount("/settings/catalog", { ...brand, published: false });
  expect(goTo()?.getAttribute("href")).toBe("/settings/store-appearance#catalog-publication");
});

test("Settings → Catálogo texts exist in Portuguese for the new notices", async () => {
  const pt = createInstance();
  await pt.use(initReactI18next).init({ lng: "pt", resources });
  expect(pt.t("catalogSettings.goToAppearance")).toBe("Ir para Aparência da loja");
  expect(pt.t("storeAppearance.unknownThemeNotice")).toContain("tema Clásico");
});
