// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import resources from "@core/app/locales";

const signInEmail = vi.fn();
vi.mock("@core/src/shared/infrastructure/auth-client", () => ({ authClient: { signIn: { email: signInEmail } } }));
const redirectBrowser = vi.fn();
vi.mock("@core/app/lib/redirect-browser", async (importOriginal) => ({ ...await importOriginal<typeof import("@core/app/lib/redirect-browser")>(), redirectBrowser }));
const { AuthForm } = await import("@core/app/components/auth-form");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "es", resources });
let root: Root | undefined;
let container: HTMLDivElement;
beforeEach(() => { signInEmail.mockReset(); redirectBrowser.mockReset(); });
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); });

const agentSearch = "?client_id=c1&exp=9999999999&sig=abc&scope=orders%3Aread";

async function mount(entry: string) {
  const Stub = createRoutesStub([{ path: "*", Component: () => <AuthForm mode="login" /> }]);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<I18nextProvider i18n={i18n}><Stub initialEntries={[entry]} /></I18nextProvider>));
}

async function signIn() {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    for (const [id, value] of [["email", "rosa@example.test"], ["password", "secret-123"]]) {
      const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}

test("shows the agent sign-in line only when the URL carries the signed authorization query", async () => {
  await mount(`/login${agentSearch}`);
  expect(container.textContent).toContain("Inicia sesión para conectar tu asistente.");
  act(() => root!.unmount()); container.remove();
  await mount("/login");
  expect(container.textContent).not.toContain("Inicia sesión para conectar tu asistente.");
});

test("follows the redirect Better Auth returns after signing in from an agent request instead of going to the dashboard", async () => {
  signInEmail.mockResolvedValue({ data: { redirect: true, url: "/assistants/authorize?client_id=c1&sig=abc" }, error: null });
  await mount(`/login${agentSearch}`);
  await signIn();
  expect(redirectBrowser).toHaveBeenCalledWith("/assistants/authorize?client_id=c1&sig=abc");
});

test("shows Verifica tu correo with resend verification and no Permitir acceso when an unverified account signs in from an agent request", async () => {
  signInEmail.mockResolvedValue({ data: null, error: { code: "EMAIL_NOT_VERIFIED", status: 403, message: "Email not verified" } });
  await mount(`/login${agentSearch}`);
  await signIn();
  expect(container.textContent).toContain("Verifica tu correo para conectar tu asistente. Después vuelve a tu asistente y conecta de nuevo.");
  const resend = [...container.querySelectorAll("a")].find((link) => link.textContent === "Reenviar correo de verificación");
  expect(resend?.getAttribute("href")).toBe("/check-email");
  expect(container.textContent).not.toContain("Permitir acceso");
  expect(container.textContent).not.toContain("No se pudo iniciar sesión.");
});

test("keeps the generic sign-in error for an unverified account without an agent request", async () => {
  signInEmail.mockResolvedValue({ data: null, error: { code: "EMAIL_NOT_VERIFIED", status: 403, message: "Email not verified" } });
  await mount("/login");
  await signIn();
  expect(container.textContent).toContain("No se pudo iniciar sesión.");
  expect(container.textContent).not.toContain("Verifica tu correo para conectar tu asistente.");
});

test("shows the retry text instead of the credentials error when sign-in from an agent request answers a server error", async () => {
  signInEmail.mockResolvedValue({ data: null, error: { error: "server_error", status: 503 } });
  await mount(`/login${agentSearch}`);
  await signIn();
  expect(container.textContent).toContain("No pudimos continuar con la conexión. Vuelve a tocar Iniciar sesión.");
  expect(container.textContent).not.toContain("No se pudo iniciar sesión.");
});

test("keeps the credentials error for a wrong password from an agent request", async () => {
  signInEmail.mockResolvedValue({ data: null, error: { code: "INVALID_EMAIL_OR_PASSWORD", status: 401 } });
  await mount(`/login${agentSearch}`);
  await signIn();
  expect(container.textContent).toContain("No se pudo iniciar sesión.");
});

test("goes to the dashboard after a normal sign-in", async () => {
  signInEmail.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
  await mount("/login");
  await signIn();
  expect(redirectBrowser).not.toHaveBeenCalled();
});
