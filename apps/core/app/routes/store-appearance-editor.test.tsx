// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createRoutesStub, data, Link, Outlet } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";
import StoreAppearanceSettings, { shouldRevalidate } from "@core/app/routes/store-appearance-settings";
import type { AppearancePart, PublicationPart } from "@core/app/components/store-appearance-editor-actions";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const pesoCard = { id: "p1", name: "Polo", imageUrl: null, price: { kind: "single", amount: { amount: 10, currency: "PEN" } }, soldOut: false };
type CardsAnswer = Response | Error | "pending";
/** Answers the plain fetch of the catalog preview cards; every other request is a test mistake. */
function stubCards(answer: CardsAnswer = Response.json({ kind: "products", cards: [pesoCard] })) {
  const fetchSpy = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (answer === "pending") return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    if (answer instanceof Error) throw answer;
    return answer.clone();
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });

const logoId = "00000000-0000-4000-8000-0000000000aa";
type Loaded = { appearance: AppearancePart; publication: PublicationPart };
const readable = (theme: string, extra: object = {}): AppearancePart => ({ kind: "readable", published: { logoImageId: null, theme }, logoUrl: null, ...extra }) as AppearancePart;
const loaded = (appearance: AppearancePart, publication: PublicationPart = { kind: "loaded", published: true }): Loaded => ({ appearance, publication });

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  // The wide layout renders both panels at once, which keeps the whole editor in one tree.
  window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
  HTMLIFrameElement.prototype.scrollIntoView = () => undefined;
});
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => { stubCards(); });

type Mounted = { loader: ReturnType<typeof vi.fn>; action: ReturnType<typeof vi.fn> };

async function mount(reads: Loaded[], actionAnswer: unknown = data({ intent: "save-appearance", error: "PERSISTENCE_UNAVAILABLE" }, { status: 503 }), publicationAnswer?: unknown): Promise<Mounted> {
  const loader = vi.fn(() => reads[Math.min(loader.mock.calls.length - 1, reads.length - 1)]);
  const action = vi.fn(async ({ request }: { request: Request }) => (publicationAnswer !== undefined && (await request.clone().json()).intent === "set-publication" ? publicationAnswer : actionAnswer));
  const Layout = () => <><Link to="/other">Salir</Link><Outlet /></>;
  const Stub = createRoutesStub([{ path: "/", Component: Layout, children: [
    { path: "settings/store-appearance", Component: StoreAppearanceSettings, loader, action, shouldRevalidate: shouldRevalidate as never },
    { path: "other", Component: () => <p>Otra página</p> },
  ] }]);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub initialEntries={["/settings/store-appearance"]} /></I18nextProvider>));
  return { loader, action };
}

const buttons = () => [...container.querySelectorAll("button")];
const button = (name: string) => buttons().find((element) => element.textContent === name || element.getAttribute("aria-label") === name);
const radio = (name: string) => [...container.querySelectorAll<HTMLElement>('[role="radio"]')].find((element) => element.textContent?.startsWith(name))!;
const shows = (text: string) => vi.waitFor(() => expect(container.textContent).toContain(text));
const click = (element: Element | undefined | null) => act(async () => { (element as HTMLElement).click(); });
const unknownNotice = "No pudimos usar tu apariencia guardada";

test("the editor offers Guardar cambios without a draft at the unknown-theme starting point and hides Restablecer apariencia", async () => {
  await mount([loaded({ kind: "unknown_theme" })]);
  await shows(unknownNotice);
  expect(radio("Clásico").getAttribute("aria-checked")).toBe("true");
  expect(container.textContent).not.toContain("Cambios sin guardar");
  expect(button("Descartar")).toBeUndefined();
  expect(button("Restablecer apariencia")).toBeUndefined();
  expect(button("Guardar cambios")?.disabled).toBe(false);
  expect(container.textContent).toContain("Sin logo");
});

test("leaving the editor at the unknown-theme starting point without changes asks nothing, and after a change it asks", async () => {
  await mount([loaded({ kind: "unknown_theme" })]);
  await shows(unknownNotice);
  await click(container.querySelector("a"));
  await shows("Otra página");
  expect(document.body.textContent).not.toContain("Tienes cambios sin guardar");

  act(() => root!.unmount());
  container.remove();
  await mount([loaded({ kind: "unknown_theme" })]);
  await click(radio("Suave"));
  await click(container.querySelector("a"));
  await vi.waitFor(() => expect(document.body.textContent).toContain("Tienes cambios sin guardar"));
});

test("Descartar at the unknown-theme starting point returns to Clásico without logo and keeps the notice", async () => {
  await mount([loaded({ kind: "unknown_theme" })]);
  await click(radio("Suave"));
  expect(container.textContent).toContain("Cambios sin guardar");
  expect(button("Restablecer apariencia")).toBeDefined();
  await click(button("Descartar"));
  expect(radio("Clásico").getAttribute("aria-checked")).toBe("true");
  expect(container.textContent).toContain(unknownNotice);
  expect(container.textContent).not.toContain("Cambios sin guardar");
  expect(button("Descartar")).toBeUndefined();
});

test("the unknown-theme notice disappears after the first save without resetting the draft", async () => {
  const saved = data({ intent: "save-appearance", success: true, appearance: { logoImageId: null, theme: "suave" } });
  const { action, loader } = await mount([loaded({ kind: "unknown_theme" }), loaded(readable("suave"))], saved);
  await click(radio("Suave"));
  await click(button("Guardar cambios"));
  await shows("Apariencia actualizada");
  expect(action).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(container.textContent).not.toContain(unknownNotice));
  expect(radio("Suave").getAttribute("aria-checked")).toBe("true");
  expect(container.textContent).not.toContain("Cambios sin guardar");
});

test("an unresolved stored logo shows Sin logo with Subir logo and a theme-only save keeps the logo id", async () => {
  const stored = { kind: "readable", published: { logoImageId: logoId, theme: "antojo" }, logoUrl: null } as AppearancePart;
  const saved = data({ intent: "save-appearance", success: true, appearance: { logoImageId: logoId, theme: "noche" } });
  const { action } = await mount([loaded(stored)], saved);
  await shows("Sin logo");
  expect(button("Quitar logo")).toBeUndefined();
  expect(container.textContent).toContain("Subir logo");
  expect(radio("Antojo").getAttribute("aria-checked")).toBe("true");
  await click(radio("Noche"));
  await click(button("Guardar cambios"));
  await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
  const submitted = await (action.mock.calls[0] as unknown as [{ request: Request }])[0].request.json();
  expect(submitted).toEqual({ intent: "save-appearance", appearance: { logoImageId: logoId, theme: "noche" } });
});

test("Reintentar after an appearance load failure re-reads without reloading the page and keeps the publication card", async () => {
  const { loader } = await mount([loaded({ kind: "failed" }), loaded(readable("boutique"))]);
  await shows("No se pudo cargar la apariencia");
  expect(button("Guardar cambios")).toBeUndefined();
  expect(button("Descartar")).toBeUndefined();
  expect(button("Restablecer apariencia")).toBeUndefined();
  expect(container.querySelector('[role="switch"]')).not.toBeNull();
  expect(container.textContent).toContain("Publicar catálogo");
  await click([...container.querySelectorAll("button")].find((element) => element.textContent === "Reintentar"));
  await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(radio("Boutique").getAttribute("aria-checked")).toBe("true"));
  expect(container.textContent).not.toContain("No se pudo cargar la apariencia");
  expect(container.querySelector('[role="switch"]')).not.toBeNull();
});

test("the editor initializes the draft on the first appearance that loads after a failed one and keeps it on later reloads", async () => {
  const saved = data({ intent: "save-appearance", success: true, appearance: { logoImageId: null, theme: "suave" } });
  const { loader } = await mount([loaded({ kind: "failed" }), loaded(readable("boutique")), loaded(readable("antojo"))], saved);
  await click(button("Reintentar"));
  await vi.waitFor(() => expect(radio("Boutique").getAttribute("aria-checked")).toBe("true"));
  await click(radio("Suave"));
  await click(button("Guardar cambios"));
  // The save re-reads the appearance; the new read only moves the baseline the draft is compared against.
  await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(3));
  expect(radio("Suave").getAttribute("aria-checked")).toBe("true");
  expect(container.textContent).toContain("Cambios sin guardar");
});

test("a later failed appearance re-read keeps the draft, the published baseline, Guardar cambios and the leave confirmation", async () => {
  await mount([loaded(readable("boutique"), { kind: "failed" }), loaded({ kind: "failed" }, { kind: "loaded", published: true })]);
  await click(radio("Suave"));
  await click(buttons().find((element) => element.textContent === "Reintentar"));
  await vi.waitFor(() => expect(container.textContent).not.toContain("No pudimos cargar la configuración del catálogo"));
  expect(radio("Suave").getAttribute("aria-checked")).toBe("true");
  expect(container.textContent).toContain("Cambios sin guardar");
  expect(button("Guardar cambios")?.disabled).toBe(false);
  expect(button("Descartar")).toBeDefined();
  await click(button("Descartar"));
  expect(radio("Boutique").getAttribute("aria-checked")).toBe("true");
  await click(radio("Suave"));
  await click(container.querySelector("a"));
  await vi.waitFor(() => expect(document.body.textContent).toContain("Tienes cambios sin guardar"));
});

test("toggling the publication card does not read the editor loader again", async () => {
  const { loader } = await mount([loaded(readable("classic"))], undefined, data({ intent: "set-publication", published: false }));
  await click(container.querySelector('[role="switch"]'));
  await click([...document.body.querySelectorAll("button")].find((element) => element.textContent === "Ocultar catálogo"));
  await shows("Catálogo oculto");
  expect(loader).toHaveBeenCalledTimes(1);
});

test("with the publication read failing, the editor still edits and the card offers Reintentar", async () => {
  await mount([loaded(readable("classic"), { kind: "failed" })]);
  await shows("No pudimos cargar la configuración del catálogo");
  await click(radio("Noche"));
  expect(container.textContent).toContain("Cambios sin guardar");
  expect(button("Guardar cambios")?.disabled).toBe(false);
});

const previewLabel = () => container.querySelector('[role="status"]')?.textContent;

test("the catalog preview shows the draft theme while the cards load, then the label of the real cards", async () => {
  stubCards("pending");
  await mount([loaded(readable("classic"))]);
  await vi.waitFor(() => expect(previewLabel()).toBe("Tema Clásico · Cargando productos"));
  expect(previewLabel()).not.toContain("Datos de ejemplo");
});

test("the preview label reads Tema Clásico · Tus productos with real cards and follows the draft theme", async () => {
  await mount([loaded(readable("classic"))]);
  await vi.waitFor(() => expect(previewLabel()).toBe("Tema Clásico · Tus productos"));
  await click(radio("Noche"));
  expect(previewLabel()).toBe("Tema Noche · Tus productos");
});

test("the catalog preview shows samples when the catalog-cards route fails", async () => {
  stubCards(new Response("down", { status: 503 }));
  await mount([loaded(readable("classic"))]);
  await vi.waitFor(() => expect(previewLabel()).toBe("Tema Clásico · Datos de ejemplo"));
  expect(container.textContent).not.toContain("No se pudo cargar la apariencia");
});

test("the catalog preview shows samples when the cards fetch fails on the network or returns an invalid body, without replacing the editor", async () => {
  stubCards(new TypeError("Failed to fetch"));
  await mount([loaded(readable("classic"))]);
  await vi.waitFor(() => expect(previewLabel()).toBe("Tema Clásico · Datos de ejemplo"));
  expect(button("Guardar cambios")).toBeDefined();
  act(() => root!.unmount());
  container.remove();
  stubCards(Response.json({ kind: "products", cards: [], extra: true }));
  await mount([loaded(readable("classic"))]);
  await vi.waitFor(() => expect(previewLabel()).toBe("Tema Clásico · Datos de ejemplo"));
  expect(button("Guardar cambios")).toBeDefined();
});

test("saving the appearance, changing publication and Reintentar do not refetch the catalog preview cards or show the placeholders again", async () => {
  const fetchSpy = stubCards();
  const saved = data({ intent: "save-appearance", success: true, appearance: { logoImageId: null, theme: "noche" } });
  const failedRead: Loaded = loaded({ kind: "failed" });
  const { loader } = await mount([failedRead, loaded(readable("classic")), loaded(readable("noche"))], saved, data({ intent: "set-publication", published: false }));
  await shows("No se pudo cargar la apariencia");
  await click(button("Reintentar"));
  await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(previewLabel()).toBe("Tema Clásico · Tus productos"));
  await click(radio("Noche"));
  await click(button("Guardar cambios"));
  await shows("Apariencia actualizada");
  await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(3));
  await click(container.querySelector('[role="switch"]'));
  await click([...document.body.querySelectorAll("button")].find((element) => element.textContent === "Ocultar catálogo"));
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(previewLabel()).not.toContain("Cargando productos");
});

test("leaving the editor aborts the pending cards request", async () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) => { signals.push(init!.signal!); return new Promise<Response>(() => undefined); }));
  await mount([loaded(readable("classic"))]);
  await vi.waitFor(() => expect(signals).toHaveLength(1));
  expect(signals[0]!.aborted).toBe(false);
  act(() => root!.unmount());
  expect(signals[0]!.aborted).toBe(true);
});
