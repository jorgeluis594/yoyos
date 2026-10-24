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
import { checkPauseMs } from "@core/app/lib/use-catalog-link";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const domain = "localhost:3000";
type LoadedPublication = Extract<PublicationPart, { kind: "loaded" }>;
const noLink: LoadedPublication = { kind: "loaded", published: false, subdomain: null, url: null, domain, suggestion: null };
const withLink: LoadedPublication = { kind: "loaded", published: false, subdomain: "fantasio", url: `http://fantasio.${domain}/`, domain, suggestion: null };
const loaded = (extra: Partial<LoadedPublication>): PublicationPart => ({ ...withLink, ...extra } as LoadedPublication);
const settingsBody = (extra: object = {}) => ({ published: false, subdomain: "fantasio", url: `http://fantasio.${domain}/`, domain, suggestion: null, ...extra });
const noLinkBody = { published: false, subdomain: null, url: null, domain, suggestion: null };

type Answer = Response | Error | "pending";
type Api = { availability?: (value: string) => Answer; save?: () => Answer; settings?: () => Answer };
/** Answers the plain fetches of the link client by route; every unexpected request is a test mistake. */
function stubApi(api: Api) {
  const calls = { availability: [] as string[], save: [] as unknown[], settings: 0 };
  const respond = (answer: Answer) => answer === "pending" ? new Promise<Response>(() => undefined) : answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const target = new URL(url, "http://localhost");
    if (target.pathname === "/api/catalog/subdomain-availability") { const value = target.searchParams.get("value")!; calls.availability.push(value); return respond(api.availability?.(value) ?? Response.json({ status: "available", subdomain: value })); }
    if (target.pathname === "/api/catalog/subdomain") { calls.save.push(JSON.parse(init!.body as string)); return respond(api.save?.() ?? Response.json(settingsBody())); }
    if (target.pathname === "/api/catalog/settings") { calls.settings += 1; return respond(api.settings?.() ?? Response.json(settingsBody())); }
    throw new Error(`unexpected request ${url}`);
  }));
  return calls;
}
const envelope = (code: string, status: number, extra: object = {}) => Response.json({ code, error: code, ...extra }, { status });

async function mount(publication: PublicationPart, answer: unknown = data({ intent: "set-publication", published: true }), onLinkUnsavedChange?: (unsaved: boolean) => void) {
  const action = vi.fn(async () => answer);
  const Stub = createRoutesStub([{ path: "/", Component: () => <CatalogPublicationCard publication={publication} onLinkUnsavedChange={onLinkUnsavedChange} />, action }]);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub initialEntries={["/"]} /></I18nextProvider>));
  return { action };
}
const field = () => container.querySelector<HTMLInputElement>("#catalog-subdomain")!;
const statusLine = () => container.querySelector("#catalog-subdomain-status")?.textContent ?? "";
const typeText = (value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), value);
  field().dispatchEvent(new Event("input", { bubbles: true }));
});
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const pause = () => act(async () => { await vi.advanceTimersByTimeAsync(checkPauseMs); });
/** Types, waits for the pause and lets the answer of the availability route land. */
const typeAndSettle = async (value: string) => { await typeText(value); await pause(); await flush(); };
const press = (key: string) => act(async () => { field().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
const saveButton = () => buttonNamed("Guardar link", container);
const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
const liveText = () => [...container.querySelectorAll('[aria-live="polite"]')].map((element) => element.textContent).join("|");

const toggle = () => container.querySelector<HTMLElement>('[role="switch"]')!;
const click = (element: Element | undefined | null) => act(async () => { (element as HTMLElement).click(); });
const buttonNamed = (name: string, scope: ParentNode = document.body) => [...scope.querySelectorAll("button")].find((element) => element.textContent === name);
const submittedBody = async (action: ReturnType<typeof vi.fn>, call = 0) => (action.mock.calls[call] as unknown as [{ request: Request }])[0].request.json();

test("the publication card asks before hiding, never shows Cambios sin guardar, and returns to on with No pudimos guardar el cambio when the save fails", async () => {
  const { action } = await mount(loaded({ published: true }), data({ intent: "set-publication", error: true }, { status: 503 }));
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
  const { action } = await mount(loaded({ published: false }), data({ intent: "set-publication", published: true }));
  await click(toggle());
  await vi.waitFor(() => expect(container.textContent).toContain("Catálogo publicado"));
  expect(await submittedBody(action)).toEqual({ intent: "set-publication", published: true });
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  expect(document.body.textContent).not.toContain("¿Ocultar tu catálogo?");
});

test("keeps the card on its previous position when the user keeps the catalog published", async () => {
  const { action } = await mount(loaded({ published: true }), data({ intent: "set-publication", published: false }));
  await click(toggle());
  await click(buttonNamed("Mantener publicado"));
  expect(action).not.toHaveBeenCalled();
  expect(toggle().getAttribute("aria-checked")).toBe("true");
});

test("shows the help text, then after the pause one reason by priority, and keeps a 40 character paste whole with «Usa hasta 30 caracteres.»", async () => {
  fakeTimers();
  const calls = stubApi({});
  await mount(noLink);
  const help = "Usa el nombre de tu marca: letras, números y guiones.";
  expect(statusLine()).toBe(help);
  expect(container.textContent).toContain(".localhost:3000");
  expect(saveButton()?.disabled).toBe(true);
  expect(container.textContent).toContain("El link se guarda con este botón.");
  await typeText("fa");
  await pause();
  expect(statusLine()).toBe(help);
  await typeText("fantasio-");
  expect(statusLine()).toBe(help);
  await pause();
  expect(statusLine()).toBe("No puede empezar ni terminar con guion.");
  await typeText("-f");
  await pause();
  expect(statusLine()).toBe("No puede empezar ni terminar con guion.");
  await typeText("fantasio.localhost:3000");
  await pause();
  expect(statusLine()).toBe("Escribe solo el nombre, sin https:// ni .localhost:3000.");
  await typeText("fantasio ");
  await pause();
  expect(statusLine()).toBe("Sin espacios: usa guiones en su lugar.");
  await typeText("café");
  await pause();
  expect(statusLine()).toBe("Usa solo letras sin tildes, números y guiones.");
  await typeText("fan--tasio");
  await pause();
  expect(statusLine()).toBe("No uses dos guiones seguidos.");
  await typeText("a".repeat(40));
  await pause();
  expect(field().value).toBe("a".repeat(40));
  expect(field().maxLength).toBe(-1);
  expect(statusLine()).toBe("Usa hasta 30 caracteres.");
  expect(calls.availability).toEqual([]);
});

test("typing fantasio-store quickly never shows the hyphen reason", async () => {
  fakeTimers();
  const calls = stubApi({});
  await mount(noLink);
  for (const typed of ["f", "fantasio", "fantasio-"]) {
    await typeText(typed);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(statusLine()).not.toContain("empezar");
  }
  await typeText("fantasio-s");
  expect(calls.availability).toEqual([]);
  await typeAndSettle("fantasio-store");
  expect(statusLine()).not.toContain("empezar");
  expect(calls.availability).toEqual(["fantasio-store"]);
  expect(statusLine()).toBe("fantasio-store.localhost:3000 está disponible");
});

test("typing Fantasio shows fantasio, then Revisando… and fantasio.localhost:3000 está disponible with Guardar link enabled", async () => {
  fakeTimers();
  stubApi({});
  let release: (response: Response) => void = () => undefined;
  const answer = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => String(url).includes("availability") ? new Promise<Response>((resolve) => { release = resolve; }) : answer(url, init));
  await mount(noLink);
  await typeText("Fantasio");
  expect(field().value).toBe("fantasio");
  await pause();
  expect(statusLine()).toBe("Revisando…");
  expect(saveButton()?.disabled).toBe(true);
  expect(liveText()).not.toContain("Revisando");
  release(Response.json({ status: "available", subdomain: "fantasio" }));
  await flush();
  expect(statusLine()).toBe("fantasio.localhost:3000 está disponible");
  expect(saveButton()?.disabled).toBe(false);
  expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual(["/api/catalog/subdomain-availability?value=fantasio"]);
  expect(liveText()).toContain("fantasio.localhost:3000 está disponible");
  expect(field().getAttribute("aria-describedby")).toContain("catalog-subdomain-status");
});

test("decides invalid, reserved and current locally without calling the availability route", async () => {
  fakeTimers();
  const calls = stubApi({});
  await mount(withLink);
  expect(statusLine()).toBe("Es tu link actual");
  await typeAndSettle("pay");
  expect(statusLine()).toBe("Ese nombre está reservado. Prueba con otro.");
  await typeAndSettle("café");
  expect(statusLine()).toBe("Usa solo letras sin tildes, números y guiones.");
  await typeAndSettle("Fantasio");
  expect(statusLine()).toBe("Es tu link actual");
  expect(saveButton()?.disabled).toBe(true);
  expect(calls.availability).toEqual([]);
});

test("the availability route answering in_use, reserved or invalid shows its state and keeps Guardar link disabled", async () => {
  fakeTimers();
  stubApi({ availability: (value) => Response.json(value === "taken" ? { status: "in_use", subdomain: value } : value === "mine" ? { status: "current", subdomain: value } : { status: "reserved" }) });
  await mount(noLink);
  await typeAndSettle("taken");
  expect(statusLine()).toBe("taken.localhost:3000 ya está en uso. Prueba con otro.");
  expect(saveButton()?.disabled).toBe(true);
  await typeAndSettle("mine");
  expect(statusLine()).toBe("Es tu link actual");
  await typeAndSettle("something");
  expect(statusLine()).toBe("Ese nombre está reservado. Prueba con otro.");
  expect(saveButton()?.disabled).toBe(true);
});

test("a suggestion prefills the field as available without a request, and an empty suggestion starts with the help text", async () => {
  fakeTimers();
  const calls = stubApi({});
  await mount({ ...noLink, suggestion: "cafe-fantasio" });
  expect(field().value).toBe("cafe-fantasio");
  expect(statusLine()).toBe("cafe-fantasio.localhost:3000 está disponible");
  expect(saveButton()?.disabled).toBe(false);
  expect(calls.availability).toEqual([]);
  act(() => root!.unmount());
  container.remove();
  await mount(noLink);
  expect(field().value).toBe("");
  expect(statusLine()).toBe("Usa el nombre de tu marca: letras, números y guiones.");
});

test("enables Guardar link only for available and check failed, and Enter does nothing otherwise and never submits the appearance draft", async () => {
  fakeTimers();
  const calls = stubApi({ availability: (value) => value === "down" ? new Error("offline") : Response.json({ status: "available", subdomain: value }) });
  const { action } = await mount(noLink);
  await press("Enter");
  await typeAndSettle("pay");
  await press("Enter");
  await typeText("fantasio");
  await press("Enter");
  expect(calls.save).toEqual([]);
  await pause();
  await flush();
  expect(saveButton()?.disabled).toBe(false);
  await typeAndSettle("down");
  expect(statusLine()).toContain("No pudimos revisar si está disponible.");
  expect(saveButton()?.disabled).toBe(false);
  await typeAndSettle("fantasio");
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => { field().dispatchEvent(enter); });
  expect(enter.defaultPrevented).toBe(true);
  await flush();
  expect(calls.save).toEqual([{ subdomain: "fantasio" }]);
  expect(action).not.toHaveBeenCalled();
});

test("a successful save shows Link guardado, Tu link and enables the switch, and editing again drops the saved state", async () => {
  fakeTimers();
  stubApi({ save: () => Response.json(settingsBody()) });
  await mount(noLink);
  expect(toggle().hasAttribute("disabled") || toggle().getAttribute("aria-disabled") === "true" || (toggle() as HTMLButtonElement).disabled).toBe(true);
  await typeAndSettle("fantasio");
  await click(saveButton());
  await flush();
  expect(statusLine()).toBe("Link guardado");
  expect(container.textContent).toContain("Tu link: http://fantasio.localhost:3000/");
  expect((toggle() as HTMLButtonElement).disabled).toBe(false);
  expect(liveText()).toContain("Link guardado");
  expect(document.activeElement).toBe(field());
  await typeAndSettle("fantasio");
  await typeText("fantasi");
  expect(statusLine()).not.toBe("Link guardado");
});

test("shows «Alguien acaba de tomar …» after an available verdict and the plain in-use text after a failed check", async () => {
  fakeTimers();
  let down = false;
  stubApi({ availability: (value) => down ? new Error("offline") : Response.json({ status: "available", subdomain: value }), save: () => envelope("SUBDOMAIN_TAKEN", 409) });
  await mount(noLink);
  await typeAndSettle("fantasio");
  await click(saveButton());
  await flush();
  expect(statusLine()).toBe("Alguien acaba de tomar fantasio.localhost:3000. Prueba con otro.");
  expect(saveButton()?.disabled).toBe(true);
  expect(field().value).toBe("fantasio");
  expect(container.textContent).not.toContain("Tu link:");
  down = true;
  await typeAndSettle("otro-nombre");
  expect(statusLine()).toContain("No pudimos revisar si está disponible.");
  await click(saveButton());
  await flush();
  expect(statusLine()).toBe("otro-nombre.localhost:3000 ya está en uso. Prueba con otro.");
});

test("a save refused as invalid or reserved by the server shows that reason and keeps the value", async () => {
  fakeTimers();
  stubApi({ save: () => envelope("SUBDOMAIN_RESERVED", 422) });
  await mount({ ...noLink, suggestion: "cafe-fantasio" });
  await click(saveButton());
  await flush();
  expect(statusLine()).toBe("Ese nombre está reservado. Prueba con otro.");
  expect(field().value).toBe("cafe-fantasio");
});

test("shows the check-failed state with Reintentar when the availability route answers 429", async () => {
  fakeTimers();
  let limited = true;
  const calls = stubApi({ availability: (value) => limited ? envelope("RATE_LIMITED", 429) : Response.json({ status: "available", subdomain: value }) });
  await mount(noLink);
  await typeAndSettle("fantasio");
  expect(statusLine()).toContain("No pudimos revisar si está disponible.");
  expect(saveButton()?.disabled).toBe(false);
  expect(liveText()).toContain("No pudimos revisar si está disponible.");
  limited = false;
  await click(buttonNamed("Reintentar", container));
  await flush();
  expect(statusLine()).toBe("fantasio.localhost:3000 está disponible");
  expect(calls.availability).toEqual(["fantasio", "fantasio"]);
});

test("only the answer for the latest typed value updates the status line", async () => {
  fakeTimers();
  const resolvers: Record<string, (response: Response) => void> = {};
  vi.stubGlobal("fetch", vi.fn((url: string) => new Promise<Response>((resolve) => { resolvers[new URL(url, "http://localhost").searchParams.get("value")!] = resolve; })));
  await mount(noLink);
  await typeAndSettle("first");
  await typeAndSettle("second");
  resolvers.first!(Response.json({ status: "in_use", subdomain: "first" }));
  resolvers.second!(Response.json({ status: "available", subdomain: "second" }));
  await flush();
  expect(statusLine()).toBe("second.localhost:3000 está disponible");
});

test("asks «¿Cambiar el link de tu catálogo?» before replacing a saved link, saves nothing on Mantener link actual and returns focus to Guardar link", async () => {
  fakeTimers();
  const calls = stubApi({ save: () => Response.json(settingsBody({ subdomain: "fantasio-store", url: `http://fantasio-store.${domain}/` })) });
  await mount(withLink);
  await typeAndSettle("fantasio-store");
  await click(saveButton());
  expect(document.body.textContent).toContain("¿Cambiar el link de tu catálogo?");
  expect(document.body.textContent).toContain("fantasio.localhost:3000 dejará de ser tuyo y otra tienda podrá usarlo. Los links de tu catálogo y de tus pedidos que ya compartiste dejarán de funcionar.");
  expect(calls.save).toEqual([]);
  await click(buttonNamed("Mantener link actual"));
  await flush();
  expect(calls.save).toEqual([]);
  expect(field().value).toBe("fantasio-store");
  expect(document.activeElement).toBe(saveButton());
  await click(saveButton());
  expect(document.body.textContent).toContain("¿Cambiar el link de tu catálogo?");
  await click(buttonNamed("Cambiar link"));
  await flush();
  expect(calls.save).toEqual([{ subdomain: "fantasio-store" }]);
  expect(statusLine()).toBe("Link guardado");
  expect(container.textContent).toContain("Tu link: http://fantasio-store.localhost:3000/");
  expect(document.activeElement).toBe(field());
  expect(document.body.textContent).not.toContain("¿Cambiar el link de tu catálogo?");
});

test("the first link is saved without asking for a confirmation", async () => {
  fakeTimers();
  const calls = stubApi({});
  await mount(noLink);
  await typeAndSettle("fantasio");
  await click(saveButton());
  await flush();
  expect(document.body.textContent).not.toContain("¿Cambiar el link de tu catálogo?");
  expect(calls.save).toEqual([{ subdomain: "fantasio" }]);
});

test("a save that was not sent shows «No pudimos guardar tu link. Revisa tu conexión.» with Reintentar", async () => {
  fakeTimers();
  const calls = stubApi({ save: () => Response.json(settingsBody({ subdomain: "cafe-fantasio", url: `http://cafe-fantasio.${domain}/` })) });
  await mount({ ...noLink, suggestion: "cafe-fantasio" });
  vi.stubGlobal("navigator", { onLine: false });
  await click(saveButton());
  await flush();
  expect(statusLine()).toBe("No pudimos guardar tu link. Revisa tu conexión.");
  expect(field().value).toBe("cafe-fantasio");
  expect(liveText()).toContain("No pudimos guardar tu link.");
  expect(calls.save).toEqual([]);
  vi.stubGlobal("navigator", { onLine: true });
  await click(buttonNamed("Reintentar", container));
  await flush();
  expect(calls.save).toEqual([{ subdomain: "cafe-fantasio" }]);
  expect(statusLine()).toBe("Link guardado");
});

test("a save without an answer re-reads and shows Link guardado, Tu link no se guardó, or the in-doubt message with Reintentar", async () => {
  fakeTimers();
  let reread: () => Response | "pending" | Error = () => "pending";
  const calls = stubApi({ save: () => new Error("lost"), settings: () => reread() });
  await mount(noLink);
  await typeAndSettle("fantasio");
  await click(saveButton());
  await flush();
  expect(statusLine()).toBe("No sabemos si tu link se guardó. Lo estamos revisando…");
  expect(calls.settings).toBe(1);
  expect(field().disabled).toBe(true);
  expect(saveButton()?.disabled).toBe(true);
  expect((toggle() as HTMLButtonElement).disabled).toBe(true);
  expect(liveText()).toContain("No sabemos si tu link se guardó.");

  // The re-read fails: nothing is replaced, and Reintentar sends the same PUT again.
  act(() => root!.unmount());
  container.remove();
  reread = () => new Error("still offline");
  await mount(noLink);
  await typeAndSettle("fantasio");
  await click(saveButton());
  await flush();
  expect(statusLine()).toBe("No sabemos si tu link se guardó. Revisa tu conexión.");
  expect(field().value).toBe("fantasio");
  expect(field().disabled).toBe(true);
  expect((toggle() as HTMLButtonElement).disabled).toBe(true);
  reread = () => Response.json(settingsBody());
  await click(buttonNamed("Reintentar", container));
  await flush();
  expect(calls.save.at(-1)).toEqual({ subdomain: "fantasio" });
  expect(statusLine()).toBe("Link guardado");

  // The re-read shows the previous state: the message stays and the verdict joins it.
  act(() => root!.unmount());
  container.remove();
  reread = () => Response.json(noLinkBody);
  await mount(noLink);
  await typeAndSettle("fantasio");
  await click(saveButton());
  await flush();
  await pause();
  await flush();
  expect(statusLine()).toBe("Tu link no se guardó. fantasio.localhost:3000 está disponible");
  expect(field().value).toBe("fantasio");
  expect(field().disabled).toBe(false);
  expect(container.textContent).not.toContain("Tu link: http");
  await typeText("fantasi");
  expect(statusLine()).not.toContain("Tu link no se guardó.");
});

test("a save answered 503 re-reads the settings instead of showing a save error", async () => {
  fakeTimers();
  const calls = stubApi({ save: () => envelope("SERVICE_UNAVAILABLE", 503), settings: () => Response.json(settingsBody()) });
  await mount(noLink);
  await typeAndSettle("fantasio");
  await click(saveButton());
  await flush();
  expect(calls.settings).toBe(1);
  expect(statusLine()).toBe("Link guardado");
  expect(container.textContent).not.toContain("No pudimos guardar tu link");
});

test("a save answered 401, 403 or 409 COMPANY_REQUIRED shows «No pudimos guardar tu link. Inténtalo de nuevo.» with Reintentar, keeps the typed link and makes no re-read", async () => {
  fakeTimers();
  for (const [code, status] of [["UNAUTHENTICATED", 401], ["EMAIL_VERIFICATION_REQUIRED", 403], ["COMPANY_REQUIRED", 409], ["INVALID_CATALOG_SETTINGS", 400], ["UNSUPPORTED_MEDIA_TYPE", 415]] as const) {
    const calls = stubApi({ save: () => envelope(code, status) });
    await mount(noLink);
    await typeAndSettle("fantasio");
    await click(saveButton());
    await flush();
    expect(statusLine()).toBe("No pudimos guardar tu link. Inténtalo de nuevo.");
    expect(field().value).toBe("fantasio");
    expect(calls.settings).toBe(0);
    expect(buttonNamed("Reintentar", container)).toBeDefined();
    act(() => root!.unmount());
    container.remove();
  }
});

test("disables the switch with «Elige el link de tu catálogo para poder publicarlo.» until a link is saved", async () => {
  fakeTimers();
  stubApi({});
  await mount(noLink);
  const message = "Elige el link de tu catálogo para poder publicarlo.";
  expect((toggle() as HTMLButtonElement).disabled).toBe(true);
  const describedBy = toggle().getAttribute("aria-describedby")!;
  expect(describedBy.split(" ").map((id) => document.getElementById(id)?.textContent).join(" ")).toContain(message);
  await typeAndSettle("fantasio");
  await click(saveButton());
  await flush();
  expect((toggle() as HTMLButtonElement).disabled).toBe(false);
  expect(container.textContent).not.toContain(message);
});

test("publish answered SUBDOMAIN_REQUIRED from an outdated screen turns the switch off with «Elige el link de tu catálogo para poder publicarlo.»", async () => {
  const { action } = await mount(withLink, data({ intent: "set-publication", error: true, reason: "subdomain_required" }, { status: 409 }));
  await click(toggle());
  await vi.waitFor(() => expect(container.textContent).toContain("Elige el link de tu catálogo para poder publicarlo."));
  expect(action).toHaveBeenCalledOnce();
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(container.textContent).not.toContain("No pudimos guardar el cambio");
});

test("while hidden shows «Tu link» without Copiar link or Ver catálogo, and while published it shows both next to it", async () => {
  await mount(loaded({ published: false }));
  expect(container.textContent).toContain("Tu link: http://fantasio.localhost:3000/");
  expect(buttonNamed("Copiar link", container)).toBeUndefined();
  expect([...container.querySelectorAll("a")].map((link) => link.textContent)).not.toContain("Ver catálogo");
  act(() => root!.unmount());
  container.remove();
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { onLine: true, clipboard: { writeText } });
  await mount(loaded({ published: true }));
  await click(buttonNamed("Copiar link", container));
  expect(writeText).toHaveBeenCalledWith("http://fantasio.localhost:3000/");
  expect(liveText()).toContain("Link copiado");
  const view = [...container.querySelectorAll("a")].find((link) => link.textContent === "Ver catálogo");
  expect(view?.getAttribute("href")).toBe("http://fantasio.localhost:3000/");
});

test("reports the unsaved link only when the field differs from its initial value, and an untouched suggestion asks nothing", async () => {
  fakeTimers();
  stubApi({});
  const changes: boolean[] = [];
  await mount({ ...noLink, suggestion: "cafe-fantasio" }, undefined, (unsaved) => changes.push(unsaved));
  expect(changes.at(-1)).toBe(false);
  await typeText("fantasio");
  expect(changes.at(-1)).toBe(true);
  await typeText("cafe-fantasio");
  expect(changes.at(-1)).toBe(false);
});

test("the card is the target of Ir a Apariencia de la tienda", async () => {
  await mount(withLink);
  expect(container.querySelector("#catalog-publication")).not.toBeNull();
});
