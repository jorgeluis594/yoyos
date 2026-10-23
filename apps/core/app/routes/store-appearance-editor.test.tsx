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
/** Answers the link client's requests; a test that does not expect them fails loudly. */
let linkApi: (url: string, init?: RequestInit) => Promise<Response> = async (url) => { throw new Error(`unexpected link request ${url}`); };
/** Answers the plain fetch of the catalog preview cards; every other request is a test mistake. */
function stubCards(answer: CardsAnswer = Response.json({ kind: "products", cards: [pesoCard] })) {
  const fetchSpy = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).startsWith("/api/catalog/")) return linkApi(String(url), init);
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
const brand = { subdomain: "fantasio", url: "http://fantasio.localhost:3000/", domain: "localhost:3000", suggestion: null } as const;
const loaded = (appearance: AppearancePart, publication: PublicationPart = { kind: "loaded", published: true, ...brand }): Loaded => ({ appearance, publication });

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  // The wide layout renders both panels at once, which keeps the whole editor in one tree.
  window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
  HTMLIFrameElement.prototype.scrollIntoView = () => undefined;
});
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => { stubCards(); linkApi = async (url) => { throw new Error(`unexpected link request ${url}`); }; });

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

test("Guardar cambios without touching anything at the unknown-theme starting point stores Clásico without logo and removes the notice", async () => {
  const saved = data({ intent: "save-appearance", success: true, appearance: { logoImageId: null, theme: "classic" } });
  const { action, loader } = await mount([loaded({ kind: "unknown_theme" }), loaded(readable("classic"))], saved);
  await shows(unknownNotice);
  await click(button("Guardar cambios"));
  await shows("Apariencia actualizada");
  const submitted = await (action.mock.calls[0] as unknown as [{ request: Request }])[0].request.json();
  expect(submitted).toEqual({ intent: "save-appearance", appearance: { logoImageId: null, theme: "classic" } });
  await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(container.textContent).not.toContain(unknownNotice));
  expect(radio("Clásico").getAttribute("aria-checked")).toBe("true");
  expect(container.textContent).not.toContain("Cambios sin guardar");
});

test("the seller can hide the catalog while the stored theme is unknown, without touching the appearance", async () => {
  const { action } = await mount([loaded({ kind: "unknown_theme" })], undefined, data({ intent: "set-publication", published: false }));
  await shows(unknownNotice);
  await click(container.querySelector('[role="switch"]'));
  await click([...document.body.querySelectorAll("button")].find((element) => element.textContent === "Ocultar catálogo"));
  await shows("Catálogo oculto");
  expect(action).toHaveBeenCalledOnce();
  expect(await (action.mock.calls[0] as unknown as [{ request: Request }])[0].request.json()).toEqual({ intent: "set-publication", published: false });
  expect(container.textContent).not.toContain("Cambios sin guardar");
  expect(container.textContent).toContain(unknownNotice);
});

test("the seller can hide the catalog while the appearance cannot be read, and no appearance control is shown", async () => {
  const { action } = await mount([loaded({ kind: "failed" })], undefined, data({ intent: "set-publication", published: false }));
  await shows("No se pudo cargar la apariencia");
  await click(container.querySelector('[role="switch"]'));
  await click([...document.body.querySelectorAll("button")].find((element) => element.textContent === "Ocultar catálogo"));
  await shows("Catálogo oculto");
  expect(await (action.mock.calls[0] as unknown as [{ request: Request }])[0].request.json()).toEqual({ intent: "set-publication", published: false });
  expect(button("Guardar cambios")).toBeUndefined();
  expect(container.textContent).toContain("No se pudo cargar la apariencia");
});

test("a save whose re-read fails takes the saved appearance as the baseline: no false Cambios sin guardar and Descartar keeps the saved theme", async () => {
  const saved = data({ intent: "save-appearance", success: true, appearance: { logoImageId: null, theme: "suave" } });
  const { loader } = await mount([loaded(readable("boutique")), loaded({ kind: "failed" })], saved);
  await click(radio("Suave"));
  expect(container.textContent).toContain("Cambios sin guardar");
  await click(button("Guardar cambios"));
  await shows("Apariencia actualizada");
  await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  expect(radio("Suave").getAttribute("aria-checked")).toBe("true");
  expect(container.textContent).not.toContain("Cambios sin guardar");
  expect(container.textContent).not.toContain("No se pudo cargar la apariencia");
  // The baseline is Suave: choosing Noche and discarding returns to it, not to Boutique.
  await click(radio("Noche"));
  await click(button("Descartar"));
  expect(radio("Suave").getAttribute("aria-checked")).toBe("true");
});

test("a save whose re-read fails removes the unknown-theme notice", async () => {
  const saved = data({ intent: "save-appearance", success: true, appearance: { logoImageId: null, theme: "classic" } });
  const { loader } = await mount([loaded({ kind: "unknown_theme" }), loaded({ kind: "failed" })], saved);
  await shows(unknownNotice);
  await click(button("Guardar cambios"));
  await shows("Apariencia actualizada");
  await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  expect(container.textContent).not.toContain(unknownNotice);
  expect(container.textContent).not.toContain("Cambios sin guardar");
  expect(button("Restablecer apariencia")).toBeDefined();
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
  await mount([loaded(readable("boutique"), { kind: "failed" }), loaded({ kind: "failed" }, { kind: "loaded", published: true, ...brand })]);
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

const field = () => container.querySelector<HTMLInputElement>("#catalog-subdomain")!;
const statusLine = () => container.querySelector("#catalog-subdomain-status")?.textContent ?? "";
const typeText = (value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), value);
  field().dispatchEvent(new Event("input", { bubbles: true }));
});
const link = (value: string) => ({ published: true, subdomain: value, url: `http://${value}.localhost:3000/`, domain: "localhost:3000", suggestion: null });
const noLinkYet: PublicationPart = { kind: "loaded", published: false, subdomain: null, url: null, domain: "localhost:3000", suggestion: null };
const suggested: PublicationPart = { ...noLinkYet, suggestion: "cafe-fantasio" };
const availability = (status: "available" | "in_use" = "available") => async (url: string) => Response.json({ status, subdomain: new URL(url, "http://x").searchParams.get("value") });
const leaveDialog = () => document.body.textContent ?? "";
const leave = async () => { await click(container.querySelector("a")); };

test("a failed availability check keeps the editor, the logo and theme draft and the typed link, and shows «No pudimos revisar si está disponible.» in the status line", async () => {
  linkApi = async () => { throw new TypeError("Failed to fetch"); };
  const { loader } = await mount([loaded(readable("classic"), noLinkYet)]);
  await click(radio("Noche"));
  await typeText("fantasio");
  await shows("No pudimos revisar si está disponible.");
  expect(field().value).toBe("fantasio");
  expect(radio("Noche").getAttribute("aria-checked")).toBe("true");
  expect(container.textContent).toContain("Cambios sin guardar");
  expect(button("Guardar cambios")).toBeDefined();
  expect(container.textContent).not.toContain("No se pudo cargar la apariencia");
  expect(loader).toHaveBeenCalledTimes(1);
});

test("a save without an answer whose re-read also fails keeps the editor, the draft and the typed link, with the in-doubt message and Reintentar", async () => {
  linkApi = async (url) => { if (url.includes("availability")) return Response.json({ status: "available", subdomain: "fantasio" }); throw new TypeError("Failed to fetch"); };
  const { loader } = await mount([loaded(readable("classic"), noLinkYet)]);
  await click(radio("Noche"));
  await typeText("fantasio");
  await shows("fantasio.localhost:3000 está disponible");
  await click(button("Guardar link"));
  await shows("No sabemos si tu link se guardó. Revisa tu conexión.");
  expect(field().value).toBe("fantasio");
  expect(radio("Noche").getAttribute("aria-checked")).toBe("true");
  expect(container.textContent).toContain("Cambios sin guardar");
  expect(button("Reintentar")).toBeDefined();
  expect(loader).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("No se pudo cargar la apariencia");
});

test("saving the link does not revalidate the editor loaders or re-read the preview products", async () => {
  const fetchSpy = stubCards();
  linkApi = async (url, init) => init?.method === "PUT" ? Response.json(link("fantasio")) : availability()(url);
  const { loader, action } = await mount([loaded(readable("classic"), noLinkYet)]);
  await vi.waitFor(() => expect(previewLabel()).toBe("Tema Clásico · Tus productos"));
  await typeText("fantasio");
  await shows("fantasio.localhost:3000 está disponible");
  await click(button("Guardar link"));
  await shows("Link guardado");
  expect(loader).toHaveBeenCalledTimes(1);
  expect(action).not.toHaveBeenCalled();
  expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes("catalog-cards"))).toHaveLength(1);
  expect(previewLabel()).toBe("Tema Clásico · Tus productos");
});

test("leaving with only a pending link, only a draft, or both shows the matching description", async () => {
  linkApi = availability();
  await mount([loaded(readable("classic"), suggested)]);
  await typeText("fantasio");
  await leave();
  await vi.waitFor(() => expect(leaveDialog()).toContain("Tienes cambios sin guardar"));
  expect(leaveDialog()).toContain("Si sales ahora, no se guardará el link que escribiste.");
  await click([...document.body.querySelectorAll("button")].find((element) => element.textContent === "Seguir editando"));
  await click(radio("Noche"));
  await leave();
  await vi.waitFor(() => expect(leaveDialog()).toContain("Si sales ahora, perderás los cambios que no publicaste y el link que escribiste."));
  await click([...document.body.querySelectorAll("button")].find((element) => element.textContent === "Seguir editando"));
  await typeText("cafe-fantasio");
  await leave();
  await vi.waitFor(() => expect(leaveDialog()).toContain("Si sales ahora, perderás los cambios que no publicaste."));
  expect(leaveDialog()).not.toContain("y el link que escribiste");
});

test("an untouched suggestion and a link edited back to its initial value ask nothing on leave", async () => {
  await mount([loaded(readable("classic"), suggested)]);
  expect(field().value).toBe("cafe-fantasio");
  await click(radio("Noche"));
  await click(radio("Clásico"));
  await leave();
  await shows("Otra página");
  expect(leaveDialog()).not.toContain("Tienes cambios sin guardar");

  act(() => root!.unmount());
  container.remove();
  linkApi = availability();
  await mount([loaded(readable("classic"), suggested)]);
  await typeText("fantasio");
  await typeText("cafe-fantasio");
  await leave();
  await shows("Otra página");
  expect(leaveDialog()).not.toContain("Tienes cambios sin guardar");
});

test("reload and tab close also ask while a link is pending", async () => {
  linkApi = availability();
  await mount([loaded(readable("classic"), suggested)]);
  const idle = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(idle);
  expect(idle.defaultPrevented).toBe(false);
  await typeText("fantasio");
  const pending = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(pending);
  expect(pending.defaultPrevented).toBe(true);
});

test("Guardar cambios with a pending link saves only logo and theme and keeps the link status line", async () => {
  linkApi = availability();
  const saved = data({ intent: "save-appearance", success: true, appearance: { logoImageId: null, theme: "noche" } });
  const { action, loader } = await mount([loaded(readable("classic"), suggested), loaded(readable("noche"), suggested)], saved);
  await typeText("fantasio");
  await shows("fantasio.localhost:3000 está disponible");
  await click(radio("Noche"));
  await click(button("Guardar cambios"));
  await shows("Apariencia actualizada");
  await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  expect(await (action.mock.calls[0] as unknown as [{ request: Request }])[0].request.json()).toEqual({ intent: "save-appearance", appearance: { logoImageId: null, theme: "noche" } });
  expect(field().value).toBe("fantasio");
  expect(statusLine()).toBe("fantasio.localhost:3000 está disponible");
  await leave();
  await vi.waitFor(() => expect(leaveDialog()).toContain("Si sales ahora, no se guardará el link que escribiste."));
});
