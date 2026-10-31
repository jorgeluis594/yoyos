// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";

const connectionsOf = vi.fn();
const disconnect = vi.fn();
vi.mock("@core/src/features/assistants/composition", () => ({ assistantConnections: { list: connectionsOf, disconnect } }));
vi.mock("@core/src/shared/infrastructure/auth", () => ({ mcpResourceUrl: "https://app.yoyos.lat/mcp" }));
const settingsModule = await import("@core/app/routes/assistant-settings");
const AssistantSettings = settingsModule.default;

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources, interpolation: { escapeValue: false } });
let root: Root | undefined;
let container: HTMLDivElement;
beforeEach(() => { connectionsOf.mockReset(); disconnect.mockReset(); });
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

type Row = { id: string; agentName: string | null; domain: string | null; connectedAt: string; lastUsedAt: string | null };
const claude: Row = { id: "00000000-0000-4000-8000-000000000001", agentName: "Claude", domain: "claude.ai", connectedAt: "2026-10-30T15:00:00.000Z", lastUsedAt: null };
const chatgpt: Row = { id: "00000000-0000-4000-8000-000000000002", agentName: "ChatGPT", domain: "chatgpt.com", connectedAt: "2026-10-28T15:00:00.000Z", lastUsedAt: "2026-10-28T15:42:00.000Z" };

async function mount(loader: () => unknown, action?: (args: { request: Request }) => unknown) {
  const Stub = createRoutesStub([{ path: "/settings/assistants", Component: AssistantSettings, loader: loader as never, action: action as never }]);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub initialEntries={["/settings/assistants"]} /></I18nextProvider>));
}
const page = (connections: Row[] | null) => () => ({ address: "https://app.yoyos.lat/mcp", connections });
const buttons = (label: string) => [...document.querySelectorAll("button")].filter((element) => element.textContent === label);
const tick = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

test("shows the connector address complete, the steps open and the empty state when the store has no connection", async () => {
  await mount(page([]));
  expect(container.querySelector("h1")?.textContent).toBe("Asistentes de IA");
  expect(container.textContent).toContain("Solo puede leer: no crea, cambia ni cancela nada.");
  const address = container.querySelector("#connector-address")!;
  expect(address.textContent).toBe("https://app.yoyos.lat/mcp");
  expect(address.className).toContain("break-all");
  expect(container.querySelector("details")?.hasAttribute("open")).toBe(true);
  expect(container.textContent).toContain("Todavía no conectaste ningún asistente.");
  expect(container.textContent).toContain("Los asistentes se desconectan solos tras 90 días sin uso o si cambias tu contraseña.");
  expect([...container.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual(expect.arrayContaining(["Dirección del conector", "Asistentes conectados"]));
});

test("collapses Cómo conectarlo once the store has a connection", async () => {
  await mount(page([claude]));
  expect(container.querySelector("details")?.hasAttribute("open")).toBe(false);
  expect(container.querySelector("summary")?.textContent).toBe("Cómo conectarlo");
});

test("lists each agent newest first with its domain, connection date and last use", async () => {
  await mount(page([claude, chatgpt]));
  const rows = [...container.querySelectorAll("li[data-connection]")].map((row) => row.textContent);
  expect(rows[0]).toContain("Claude");
  expect(rows[0]).toContain("claude.ai");
  expect(rows[0]).toContain("Conectado el 30/10/2026");
  expect(rows[0]).toContain("Sin uso todavía");
  expect(rows[1]).toContain("chatgpt.com");
  expect(rows[1]).toContain("Último uso: 28/10/2026, 10:42");
});

test("Copiar copies the address and announces it politely, and says so when the clipboard is blocked", async () => {
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await mount(page([]));
  await act(async () => buttons("Copiar")[0].click());
  expect(writeText).toHaveBeenCalledWith("https://app.yoyos.lat/mcp");
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("Dirección copiada.");
  writeText.mockRejectedValue(new Error("blocked"));
  await act(async () => buttons("Copiar")[0].click());
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("No pudimos copiarla. Selecciona la dirección y cópiala.");
});

test("keeps the address and the steps and offers Reintentar when the list cannot load", async () => {
  await mount(page(null));
  expect(container.querySelector("#connector-address")?.textContent).toBe("https://app.yoyos.lat/mcp");
  expect(container.textContent).toContain("No pudimos cargar la lista de asistentes.");
  expect(buttons("Reintentar")).toHaveLength(1);
  expect(container.textContent).not.toContain("Todavía no conectaste ningún asistente.");
});

test("lists a newly connected agent when the page regains focus without reloading", async () => {
  let rows: Row[] = [];
  await mount(() => ({ address: "https://app.yoyos.lat/mcp", connections: rows }));
  expect(container.textContent).toContain("Todavía no conectaste ningún asistente.");
  rows = [claude];
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await tick();
  expect(container.querySelectorAll("li[data-connection]")).toHaveLength(1);
  expect(container.querySelector("#connector-address")?.textContent).toBe("https://app.yoyos.lat/mcp");
});

test("the disconnect dialog names the agent and its connection date", async () => {
  await mount(page([claude, chatgpt]));
  await act(async () => buttons("Desconectar")[1].click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("¿Desconectar ChatGPT, conectado el 28/10/2026?");
  expect(dialog.textContent).toContain("Dejará de ver tus pedidos hasta que lo conectes de nuevo.");
  expect([...dialog.querySelectorAll("button")].map((element) => element.textContent)).toEqual(expect.arrayContaining(["Desconectar asistente", "Mantener conectado"]));
});

test("moves focus to the next Desconectar or the heading after a disconnect and announces it", async () => {
  let rows = [claude, chatgpt];
  await mount(() => ({ address: "https://app.yoyos.lat/mcp", connections: rows }), async ({ request }: { request: Request }) => {
    const id = String((await request.formData()).get("connectionId"));
    rows = rows.filter((row) => row.id !== id);
    return { disconnected: id };
  });
  await act(async () => buttons("Desconectar")[0].click());
  await act(async () => buttons("Desconectar asistente")[0].click());
  await tick();
  expect(container.querySelectorAll("li[data-connection]")).toHaveLength(1);
  expect(container.querySelector("#connection-announcement")?.textContent).toContain("Desconectaste Claude, conectado el 30/10/2026.");
  expect(document.activeElement).toBe(container.querySelector("li[data-connection] button"));

  await act(async () => buttons("Desconectar")[0].click());
  await act(async () => buttons("Desconectar asistente")[0].click());
  await tick();
  expect(container.querySelectorAll("li[data-connection]")).toHaveLength(0);
  expect(document.activeElement).toBe(container.querySelector("#connected-heading"));
});

test("a failed disconnect shows the error next to the row, announced, with focus back on its Desconectar", async () => {
  await mount(page([claude]), () => ({ error: "disconnect_failed", id: claude.id }));
  await act(async () => buttons("Desconectar")[0].click());
  await act(async () => buttons("Desconectar asistente")[0].click());
  await tick();
  const row = container.querySelector("li[data-connection]")!;
  expect(row.textContent).toContain("No pudimos desconectarlo. Inténtalo de nuevo.");
  expect(row.querySelector('[role="alert"]')).toBeNull();
  expect(row.querySelector('[aria-live="polite"]')?.textContent).toContain("No pudimos desconectarlo");
  expect(document.activeElement).toBe(row.querySelector("button"));
});

test("Mantener conectado closes the dialog without disconnecting", async () => {
  const action = vi.fn(() => ({ disconnected: claude.id }));
  await mount(page([claude]), action);
  await act(async () => buttons("Desconectar")[0].click());
  await act(async () => buttons("Mantener conectado")[0].click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(action).not.toHaveBeenCalled();
});

const owner = { company: { id: "6c0f5d2e-6a63-4a38-9f07-3b8f7a1c0002" }, user: { id: "user-1" } };
const context = { get: () => owner } as never;

test("the loader reads the connections of the session's store and serializes them", async () => {
  connectionsOf.mockResolvedValue({ success: true, data: [{
    id: claude.id, agentName: "Claude", returnTarget: { kind: "web", domain: "claude.ai" }, authorizedAt: new Date(claude.connectedAt), lastUsedAt: null,
  }, { id: chatgpt.id, agentName: null, returnTarget: { kind: "this_device" }, authorizedAt: new Date(chatgpt.connectedAt), lastUsedAt: new Date(chatgpt.lastUsedAt!) }] });
  const loaded = await settingsModule.loader({ context, request: new Request("http://localhost/settings/assistants"), params: {} } as never);
  expect(connectionsOf).toHaveBeenCalledWith({ companyId: owner.company.id, userId: "user-1" });
  expect(loaded).toEqual({ address: "https://app.yoyos.lat/mcp", connections: [claude, { ...chatgpt, agentName: null, domain: null }] });
});

test("the loader still answers the address when the list cannot be read", async () => {
  connectionsOf.mockResolvedValue({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "down" } });
  expect(await settingsModule.loader({ context, request: new Request("http://localhost/settings/assistants"), params: {} } as never))
    .toEqual({ address: "https://app.yoyos.lat/mcp", connections: null });
});

test("the action disconnects the connection of the session's store and ignores any company in the form", async () => {
  disconnect.mockResolvedValue({ success: true, data: null });
  const form = new URLSearchParams({ intent: "disconnect", connectionId: claude.id, companyId: "forged" });
  const result = await settingsModule.action({ context, request: new Request("http://localhost/settings/assistants", { method: "POST", body: form }), params: {} } as never);
  expect(result).toMatchObject({ data: { disconnected: claude.id } });
  expect(disconnect).toHaveBeenCalledWith({ connectionId: claude.id }, { companyId: owner.company.id, userId: "user-1" });
});

test("the action answers a failure the page can show, and refuses a malformed form", async () => {
  disconnect.mockResolvedValue({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "down" } });
  const send = (fields: Record<string, string>) => settingsModule.action({ context, request: new Request("http://localhost/settings/assistants", { method: "POST", body: new URLSearchParams(fields) }), params: {} } as never);
  expect(await send({ intent: "disconnect", connectionId: claude.id })).toMatchObject({ data: { error: "disconnect_failed", id: claude.id } });
  expect(await send({ intent: "disconnect", connectionId: "not-a-uuid" })).toMatchObject({ data: { error: "disconnect_failed" } });
});
