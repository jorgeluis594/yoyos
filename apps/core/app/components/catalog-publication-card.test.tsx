// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createRoutesStub, data } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import { CatalogPublicationCard } from "@core/app/components/catalog-publication-card";
import type { PublicationPart } from "@core/app/components/store-appearance-editor-actions";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); });

async function mount(publication: PublicationPart, answer: unknown) {
  const action = vi.fn(async () => answer);
  const Stub = createRoutesStub([{ path: "/", Component: () => <CatalogPublicationCard publication={publication} />, action }]);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub initialEntries={["/"]} /></I18nextProvider>));
  return { action };
}
const toggle = () => container.querySelector<HTMLElement>('[role="switch"]')!;
const click = (element: Element | undefined | null) => act(async () => { (element as HTMLElement).click(); });
const buttonNamed = (name: string, scope: ParentNode = document.body) => [...scope.querySelectorAll("button")].find((element) => element.textContent === name);
const submittedBody = async (action: ReturnType<typeof vi.fn>, call = 0) => (action.mock.calls[call] as unknown as [{ request: Request }])[0].request.json();

test("the publication card asks before hiding, never shows Cambios sin guardar, and returns to on with No pudimos guardar el cambio when the save fails", async () => {
  const { action } = await mount({ kind: "loaded", published: true }, data({ intent: "set-publication", error: true }, { status: 503 }));
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  expect(container.textContent).toContain("Este cambio se guarda al momento.");
  await click(toggle());
  expect(document.body.textContent).toContain("¿Ocultar tu catálogo?");
  expect(action).not.toHaveBeenCalled();
  await click(buttonNamed("Ocultar catálogo"));
  await vi.waitFor(() => expect(container.textContent).toContain("No pudimos guardar el cambio"));
  expect(await submittedBody(action)).toEqual({ intent: "set-publication", published: false });
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  expect(container.textContent).not.toContain("Cambios sin guardar");
  await click(buttonNamed("Reintentar", container));
  await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  expect(await submittedBody(action, 1)).toEqual({ intent: "set-publication", published: false });
});

test("publishing saves at once and the card trusts its own result", async () => {
  const { action } = await mount({ kind: "loaded", published: false }, data({ intent: "set-publication", published: true }));
  await click(toggle());
  await vi.waitFor(() => expect(container.textContent).toContain("Catálogo publicado"));
  expect(await submittedBody(action)).toEqual({ intent: "set-publication", published: true });
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  expect(document.body.textContent).not.toContain("¿Ocultar tu catálogo?");
});

test("keeps the card on its previous position when the user keeps the catalog published", async () => {
  const { action } = await mount({ kind: "loaded", published: true }, data({ intent: "set-publication", published: false }));
  await click(toggle());
  await click(buttonNamed("Mantener publicado"));
  expect(action).not.toHaveBeenCalled();
  expect(toggle().getAttribute("aria-checked")).toBe("true");
});
