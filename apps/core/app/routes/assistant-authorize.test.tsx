// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";

const resolveCurrentAccess = vi.fn();
vi.mock("@core/src/shared/infrastructure/current-user", () => ({ resolveCurrentAccess }));
const getSession = vi.fn();
const signOut = vi.fn();
vi.mock("@core/src/shared/infrastructure/auth", () => ({ auth: { api: { getSession, signOut } } }));
const authorization = { read: vi.fn(), allow: vi.fn(), deny: vi.fn() };
vi.mock("@core/src/features/assistants/composition", () => ({ authorizationFor: () => authorization }));
const redirectBrowser = vi.fn();
vi.mock("@core/app/lib/redirect-browser", async (importOriginal) => ({ ...await importOriginal<typeof import("@core/app/lib/redirect-browser")>(), redirectBrowser }));
const authorizeModule = await import("@core/app/routes/assistant-authorize");
const AssistantAuthorize = authorizeModule.default;

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });
let root: Root | undefined;
let container: HTMLDivElement;
beforeEach(() => { for (const mock of [redirectBrowser, resolveCurrentAccess, getSession, signOut, authorization.read, authorization.allow, authorization.deny]) mock.mockReset(); });
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); });

const ready = { state: "ready" as const, agentName: "ChatGPT", returnTarget: { kind: "web" as const, domain: "chatgpt.com" }, storeName: "Tienda Rosa", email: "rosa@ejemplo.com", signed: "client_id=c1&sig=abc" };
type Loaded = Record<string, unknown>;

async function mount(loaded: Loaded, action?: () => unknown) {
  const Stub = createRoutesStub([{ path: "/assistants/authorize", Component: AssistantAuthorize, loader: () => loaded, action: action as never }]);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub initialEntries={["/assistants/authorize?client_id=c1&sig=abc"]} /></I18nextProvider>));
}
const button = (label: string) => [...container.querySelectorAll("button")].find((element) => element.textContent?.includes(label));
const click = (label: string) => act(async () => { button(label)!.click(); });

test("shows the agent, the verified return domain, what it can and never do, and the account", async () => {
  await mount(ready);
  expect(container.querySelector("h1")?.textContent).toBe("ChatGPT quiere leer los pedidos de Tienda Rosa");
  expect(container.textContent).toContain("(nombre indicado por el asistente)");
  expect(container.textContent).toContain("Volverá a chatgpt.com");
  expect([...container.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual(["Podrá ver", "Nunca podrá"]);
  expect(container.querySelectorAll("ul li")).toHaveLength(5);
  expect(container.textContent).toContain("Conectado como rosa@ejemplo.com");
  expect(button("Usar otra cuenta")).toBeDefined();
  expect(button("Permitir acceso")).toBeDefined();
  expect(button("No permitir")).toBeDefined();
});

test("says the return line alone when the agent declared no name, and names a loopback return as this device", async () => {
  await mount({ ...ready, agentName: null, returnTarget: { kind: "this_device" } });
  expect(container.querySelector("h1")?.textContent).toBe("Un asistente quiere leer los pedidos de Tienda Rosa");
  expect(container.textContent).not.toContain("(nombre indicado por el asistente)");
  expect(container.textContent).toContain("Volverá a una aplicación de este equipo");
});

test("disables both buttons and shows progress while the answer is pending", async () => {
  let release: (value: unknown) => void = () => undefined;
  await mount(ready, () => new Promise((resolve) => { release = resolve; }));
  await click("Permitir acceso");
  expect(button("Conectando")?.hasAttribute("disabled")).toBe(true);
  expect(button("No permitir")?.hasAttribute("disabled")).toBe(true);
  await act(async () => release({ answered: "allowed", redirectUrl: "https://chatgpt.com/cb?code=1" }));
  expect(container.textContent).toContain("Listo. Ya puedes volver a tu asistente.");
  expect(redirectBrowser).toHaveBeenCalledWith("https://chatgpt.com/cb?code=1");
  expect(button("Permitir acceso")).toBeUndefined();
});

test("shows the denied text and sends the browser back with access denied", async () => {
  await mount(ready, () => ({ answered: "denied", redirectUrl: "https://chatgpt.com/cb?error=access_denied" }));
  await click("No permitir");
  expect(container.textContent).toContain("No diste acceso. Ya puedes volver a tu asistente.");
  expect(redirectBrowser).toHaveBeenCalledWith("https://chatgpt.com/cb?error=access_denied");
});

test("never sends the browser to a target that is not http or https", async () => {
  await mount(ready, () => ({ answered: "allowed", redirectUrl: "javascript:alert(1)" }));
  await click("Permitir acceso");
  expect(redirectBrowser).not.toHaveBeenCalled();
});

test("shows the not sent message and enables the buttons again when the request fails before sending", async () => {
  await mount(ready, () => ({ error: "not_sent" }));
  await click("Permitir acceso");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("No pudimos enviarlo. Revisa tu conexión y vuelve a tocar Permitir acceso.");
  expect(button("Permitir acceso")?.hasAttribute("disabled")).toBe(false);
  expect(button("No permitir")?.hasAttribute("disabled")).toBe(false);
});

test("shows the in doubt message when the request was sent without an answer", async () => {
  await mount(ready, () => ({ error: "in_doubt" }));
  await click("Permitir acceso");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("No sabemos si se conectó. Revisa tu asistente; si no aparece conectado, conecta de nuevo desde ahí.");
});

test("an expired or invalid answer replaces the screen with its text", async () => {
  await mount(ready, () => ({ error: "expired" }));
  await click("Permitir acceso");
  expect(container.textContent).toContain("Esta solicitud venció. Vuelve a tu asistente y conecta de nuevo.");
  expect(button("Permitir acceso")).toBeUndefined();
});

test("offers create store without Permitir acceso to an account without a store", async () => {
  await mount({ state: "company_required", signed: ready.signed });
  expect(container.textContent).toContain("Primero crea tu tienda en Yoyos. Después vuelve a tu asistente y conecta de nuevo.");
  expect([...container.querySelectorAll("a")].find((link) => link.textContent === "Crear mi tienda")?.getAttribute("href")).toBe("/register");
  expect(button("Permitir acceso")).toBeUndefined();
});

test("shows the invalid and expired request texts without actions", async () => {
  await mount({ state: "invalid" });
  expect(container.textContent).toContain("Este enlace de conexión no es válido. Vuelve a tu asistente y conecta de nuevo.");
  expect(button("Permitir acceso")).toBeUndefined();
  act(() => root!.unmount()); container.remove();
  await mount({ state: "expired" });
  expect(container.textContent).toContain("Esta solicitud venció. Vuelve a tu asistente y conecta de nuevo.");
});

test("forbids framing the authorization screen", () => {
  const headers = new Headers(authorizeModule.headers());
  expect(headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
  expect(headers.get("x-frame-options")).toBe("DENY");
  expect(headers.get("cache-control")).toBe("no-store");
});

const rosa = { status: "ready", user: { id: "user-1", name: "Rosa" }, company: { id: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0002", name: "Tienda Rosa" } };
const loaderRequest = (path = "/assistants/authorize") => new Request(`http://localhost${path}?client_id=c1&exp=9&sig=abc`);
const callLoader = (request: Request) => authorizeModule.loader({ request, params: {}, context: {} } as never);

test("the loader sends a visitor without a session to the sign-in with the same signed request", async () => {
  resolveCurrentAccess.mockResolvedValue({ success: false, error: { code: "UNAUTHENTICATED", message: "Session required" } });
  const thrown = await callLoader(loaderRequest()).catch((cause) => cause);
  expect(thrown).toBeInstanceOf(Response);
  expect(thrown.headers.get("location")).toBe("/login?client_id=c1&exp=9&sig=abc");
  const localized = await callLoader(loaderRequest("/es-PE/assistants/authorize")).catch((cause) => cause);
  expect(localized.headers.get("location")).toBe("/es-PE/login?client_id=c1&exp=9&sig=abc");
});

test("the loader reads the request for a ready account and names the store, the agent and the account", async () => {
  resolveCurrentAccess.mockResolvedValue({ success: true, data: rosa });
  getSession.mockResolvedValue({ user: { email: "rosa@ejemplo.com" } });
  authorization.read.mockResolvedValue({ success: true, data: { oauthClientId: "c1", clientName: "ChatGPT", redirectUri: "https://chatgpt.com/connector/oauth/abc" } });
  expect(await callLoader(loaderRequest())).toEqual({
    state: "ready", agentName: "ChatGPT", returnTarget: { kind: "web", domain: "chatgpt.com" }, storeName: "Tienda Rosa", email: "rosa@ejemplo.com", signed: "client_id=c1&exp=9&sig=abc",
  });
  expect(authorization.read).toHaveBeenCalledWith("client_id=c1&exp=9&sig=abc");
});

test("the loader shows the agent name without format or bidi control characters", async () => {
  resolveCurrentAccess.mockResolvedValue({ success: true, data: rosa });
  getSession.mockResolvedValue({ user: { email: "rosa@ejemplo.com" } });
  authorization.read.mockResolvedValue({ success: true, data: { oauthClientId: "c1", clientName: "Chat\u202EGPT\u200B", redirectUri: "https://evil.example/cb" } });
  expect(await callLoader(loaderRequest())).toMatchObject({ agentName: "ChatGPT" });
});

test("the loader shows the invalid, expired and no store states", async () => {
  resolveCurrentAccess.mockResolvedValue({ success: true, data: rosa });
  getSession.mockResolvedValue({ user: { email: "rosa@ejemplo.com" } });
  authorization.read.mockResolvedValue({ success: false, error: { code: "REQUEST_INVALID", message: "" } });
  expect(await callLoader(loaderRequest())).toEqual({ state: "invalid" });
  authorization.read.mockResolvedValue({ success: false, error: { code: "REQUEST_EXPIRED", message: "" } });
  expect(await callLoader(loaderRequest())).toEqual({ state: "expired" });
  authorization.read.mockResolvedValue({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "" } });
  expect(await callLoader(loaderRequest())).toEqual({ state: "unavailable" });
  resolveCurrentAccess.mockResolvedValue({ success: true, data: { status: "company_required", user: { id: "u" }, company: null } });
  expect(await callLoader(loaderRequest())).toMatchObject({ state: "company_required" });
  expect(authorization.read).toHaveBeenCalledTimes(3);
});

function post(fields: Record<string, string>, path = "/assistants/authorize") {
  return authorizeModule.action({ request: new Request(`http://localhost${path}`, { method: "POST", body: new URLSearchParams(fields) }), params: {}, context: {} } as never);
}
const sessionOf = (data: unknown = rosa) => resolveCurrentAccess.mockResolvedValue({ success: true, data });

test("the action takes the account and the store from the session, never from the form", async () => {
  sessionOf();
  authorization.allow.mockResolvedValue({ success: true, data: "https://chatgpt.com/cb?code=1" });
  const result = await post({ intent: "allow", request: "client_id=c1&sig=abc", companyId: "forged", userId: "forged" });
  expect(result).toMatchObject({ data: { answered: "allowed", redirectUrl: "https://chatgpt.com/cb?code=1" } });
  expect(authorization.allow).toHaveBeenCalledWith("client_id=c1&sig=abc", { companyId: rosa.company.id, userId: "user-1" });
});

test("the action denies through the deny operation and answers the access denied redirect", async () => {
  sessionOf();
  authorization.deny.mockResolvedValue({ success: true, data: "https://chatgpt.com/cb?error=access_denied" });
  expect(await post({ intent: "deny", request: "client_id=c1&sig=abc" })).toMatchObject({ data: { answered: "denied", redirectUrl: "https://chatgpt.com/cb?error=access_denied" } });
  expect(authorization.allow).not.toHaveBeenCalled();
});

test("the action maps expired and invalid requests and keeps a failure retryable", async () => {
  sessionOf();
  authorization.allow.mockResolvedValueOnce({ success: false, error: { code: "REQUEST_EXPIRED", message: "" } });
  expect(await post({ intent: "allow", request: "client_id=c1&sig=abc" })).toMatchObject({ data: { error: "expired" } });
  authorization.allow.mockResolvedValueOnce({ success: false, error: { code: "REQUEST_INVALID", message: "" } });
  expect(await post({ intent: "allow", request: "client_id=c1&sig=abc" })).toMatchObject({ data: { error: "invalid" } });
  authorization.allow.mockResolvedValueOnce({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "" } });
  expect(await post({ intent: "allow", request: "client_id=c1&sig=abc" })).toMatchObject({ data: { error: "not_sent" } });
});

test("the action refuses an account without a store and a malformed form", async () => {
  sessionOf({ status: "company_required", user: { id: "u" }, company: null });
  expect(await post({ intent: "allow", request: "x" })).toMatchObject({ data: { error: "invalid" } });
  expect(await post({ intent: "steal", request: "x" })).toMatchObject({ data: { error: "invalid" } });
  expect(authorization.allow).not.toHaveBeenCalled();
});

test("Usar otra cuenta signs out and returns to the sign-in with the same signed request", async () => {
  const cookies = new Headers({ "set-cookie": "session=; Max-Age=0" });
  signOut.mockResolvedValue({ headers: cookies, response: { success: true } });
  const thrown = await post({ intent: "switch_account", request: "client_id=c1&exp=9&sig=abc" }, "/es-PE/assistants/authorize").catch((cause) => cause);
  expect(thrown.headers.get("location")).toBe("/es-PE/login?client_id=c1&exp=9&sig=abc");
  expect(thrown.headers.get("set-cookie")).toBe("session=; Max-Age=0");
});
