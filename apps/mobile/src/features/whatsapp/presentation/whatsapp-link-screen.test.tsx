import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ok } from "@shared/functional";
import WhatsAppLinkScreen from "@mobile/features/whatsapp/presentation/whatsapp-link-screen";
import { initialWhatsAppStatus, type WhatsAppStatus } from "@mobile/features/whatsapp/presentation/whatsapp-status";
import { NoticesProvider } from "@mobile/features/notifications/presentation/notices-provider";
import type { NoticesController } from "@mobile/features/notifications/application/notices-controller";
import i18n from "@mobile/i18n";

let mockStatus: WhatsAppStatus = initialWhatsAppStatus;
const mockRefresh = jest.fn(async () => undefined);
const mockRuntime = {
  linkAccount: jest.fn(),
  unlinkAccount: jest.fn(),
  reception: { connect: jest.fn() },
};
jest.mock("@mobile/features/whatsapp/presentation/whatsapp-provider", () => ({
  useWhatsApp: () => ({ runtime: mockRuntime, status: mockStatus, refresh: mockRefresh }),
}));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void | (() => void)) => jest.requireActual("react").useEffect(effect, [effect]),
}));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));

const linked = (overrides: Partial<WhatsAppStatus> = {}): WhatsAppStatus => ({ ...initialWhatsAppStatus, link: "linked", ...overrides });

beforeEach(async () => {
  jest.clearAllMocks();
  mockStatus = initialWhatsAppStatus;
  mockRuntime.linkAccount.mockResolvedValue(ok({}));
  mockRuntime.unlinkAccount.mockResolvedValue(ok({ remoteLogoutConfirmed: true }));
  mockRuntime.reception.connect.mockResolvedValue(ok(undefined));
  await i18n.changeLanguage("es");
});
afterEach(cleanup);

test("offers linking when no account is linked", async () => {
  const screen = render(<WhatsAppLinkScreen />);
  fireEvent.press(screen.getByRole("button", { name: "Vincular WhatsApp" }));
  await waitFor(() => expect(mockRuntime.linkAccount).toHaveBeenCalledTimes(1));
  expect(mockRefresh).toHaveBeenCalled();
});

test("shows the QR with its countdown while linking", () => {
  mockStatus = linked({ connection: "awaitingQr", qr: { value: "qr-value", expiresAt: Date.now() + 30_000 } });
  const screen = render(<WhatsAppLinkScreen />);
  expect(screen.getByLabelText("Escanea el código QR desde WhatsApp > Dispositivos vinculados.")).toBeTruthy();
  expect(screen.getByText(/El código vence en \d+ s/)).toBeTruthy();
});

test("requests a new QR when the current one expires", async () => {
  mockStatus = linked({ connection: "awaitingQr", qr: { value: "qr-value", expiresAt: Date.now() - 1 } });
  const screen = render(<WhatsAppLinkScreen />);
  expect(screen.getByText("El código venció. Solicita uno nuevo.")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Nuevo código QR" }));
  await waitFor(() => expect(mockRuntime.reception.connect).toHaveBeenCalledTimes(1));
});

test("shows success when the connection becomes connected", () => {
  mockStatus = linked({ connection: "connected", unsynced: 2 });
  const screen = render(<WhatsAppLinkScreen />);
  expect(screen.getByText("WhatsApp conectado")).toBeTruthy();
  expect(screen.getByText("2 mensajes sin sincronizar")).toBeTruthy();
});

test("offers relinking when the session expires", async () => {
  mockStatus = linked({ connection: "sessionExpired" });
  const screen = render(<WhatsAppLinkScreen />);
  expect(screen.getByText("La sesión de WhatsApp venció. Vuelve a vincular la cuenta.")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Volver a vincular" }));
  await waitFor(() => expect(mockRuntime.linkAccount).toHaveBeenCalledTimes(1));
  expect(mockRuntime.unlinkAccount.mock.invocationCallOrder[0]).toBeLessThan(mockRuntime.linkAccount.mock.invocationCallOrder[0] ?? 0);
});

test("shows the other-company notice and offers only unlinking", () => {
  mockStatus = { ...initialWhatsAppStatus, link: "otherCompany" };
  const screen = render(<WhatsAppLinkScreen />);
  expect(screen.getByText(/vinculado a otra empresa/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Desvincular" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Vincular WhatsApp" })).toBeNull();
});

test("shows non-blocking notices for RECOVERY_BUFFER_FULL, HISTORY_LIMIT_REACHED and IDENTITY_UNAVAILABLE", () => {
  for (const [code, text] of [["RECOVERY_BUFFER_FULL", /almacenamiento temporal/], ["HISTORY_LIMIT_REACHED", /límite del historial/], ["IDENTITY_UNAVAILABLE", /identificar un mensaje/]] as const) {
    mockStatus = linked({ connection: "connected", notice: code });
    const screen = render(<WhatsAppLinkScreen />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByText("WhatsApp conectado")).toBeTruthy();
    screen.unmount();
  }
});

test("shows LOCAL_STORAGE_FAILED as a visible error", () => {
  mockStatus = linked({ connection: "connected", lastError: { code: "LOCAL_STORAGE_FAILED", message: "x" } });
  expect(render(<WhatsAppLinkScreen />).getByText(/No se pudo guardar un mensaje/)).toBeTruthy();
});

test("warns that the device may stay linked after REMOTE_LOGOUT_UNCONFIRMED", async () => {
  mockStatus = linked({ connection: "connected" });
  mockRuntime.unlinkAccount.mockResolvedValue(ok({ remoteLogoutConfirmed: false }));
  const screen = render(<WhatsAppLinkScreen />);
  fireEvent.press(screen.getByRole("button", { name: "Desvincular" }));
  expect(await screen.findByText(/seguir visible/)).toBeTruthy();
});

test("shows an error when linking fails", async () => {
  mockRuntime.linkAccount.mockResolvedValue({ success: false, error: { code: "CONNECTION_FAILED", message: "x" } });
  const screen = render(<WhatsAppLinkScreen />);
  fireEvent.press(screen.getByRole("button", { name: "Vincular WhatsApp" }));
  expect(await screen.findByText("No se pudo vincular WhatsApp. Vuelve a intentar.")).toBeTruthy();
});

test("shows the library error code and offers to reconnect after an unexpected disconnect", async () => {
  mockStatus = linked({ connection: "disconnected", lastError: { code: "INVALID_INPUT", message: "x" } });
  const screen = render(<WhatsAppLinkScreen />);
  expect(screen.getByText(/se desconectó por un error \(INVALID_INPUT\)/)).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Reintentar conexión" }));
  await waitFor(() => expect(mockRuntime.reception.connect).toHaveBeenCalledTimes(1));
});

test("does not offer reconnecting when disconnected without an error", () => {
  mockStatus = linked({ connection: "disconnected" });
  expect(render(<WhatsAppLinkScreen />).queryByRole("button", { name: "Reintentar conexión" })).toBeNull();
});

function fakeController(permission: "granted" | "denied" | "undetermined") {
  const state = { permission, prompts: 0, enables: 0 };
  const controller: NoticesController = {
    session: () => null,
    setSession: () => {},
    permission: async () => state.permission,
    promptOnConnected: async () => { state.prompts++; return state.permission; },
    enable: async () => { state.enables++; state.permission = "granted"; return state.permission; },
    sync: async () => "unchanged",
    flushPending: async () => false,
    onTokenChange: () => () => {},
    watchResponses: () => () => {},
    watchArrivals: () => () => {},
    decideForeground: async () => "show",
  };
  return { controller, state };
}

const loadReady = async () => ok("ready" as const);
const renderWithNotices = (controller: NoticesController, state: "no_active_products" | "no_searchable_photos" | "ready" = "ready") =>
  render(<NoticesProvider controller={controller} companyId="company-1" loadCatalogReadiness={async () => ok(state)}><WhatsAppLinkScreen /></NoticesProvider>);

test("asks for notification permission once when the WhatsApp link first becomes connected", async () => {
  const { controller, state } = fakeController("undetermined");
  mockStatus = linked({ connection: "connecting" });
  const screen = renderWithNotices(controller);
  await waitFor(() => expect(screen.getByText("Conectando…")).toBeTruthy());
  expect(state.prompts).toBe(0);

  mockStatus = linked({ connection: "connected" });
  screen.rerender(<NoticesProvider controller={controller} companyId="company-1" loadCatalogReadiness={loadReady}><WhatsAppLinkScreen /></NoticesProvider>);
  await waitFor(() => expect(state.prompts).toBe(1));
  screen.rerender(<NoticesProvider controller={controller} companyId="company-1" loadCatalogReadiness={loadReady}><WhatsAppLinkScreen /></NoticesProvider>);
  expect(state.prompts).toBe(1);
});

test("does not ask for permission after an expired QR", async () => {
  const { controller, state } = fakeController("undetermined");
  mockStatus = linked({ connection: "awaitingQr", qr: { value: "qr-value", expiresAt: Date.now() - 1 } });
  const screen = renderWithNotices(controller);
  await waitFor(() => expect(screen.getByText("El código venció. Solicita uno nuevo.")).toBeTruthy());
  expect(state.prompts).toBe(0);
});

test("shows the notices-off banner and removes it once the permission is granted", async () => {
  const { controller, state } = fakeController("undetermined");
  mockStatus = linked({ connection: "disconnected" });
  const screen = renderWithNotices(controller);
  await waitFor(() => expect(screen.getByText(/Los avisos están desactivados/)).toBeTruthy());

  fireEvent.press(screen.getByRole("button", { name: "Activar avisos" }));
  await waitFor(() => expect(state.enables).toBe(1));
  await waitFor(() => expect(screen.queryByText(/Los avisos están desactivados/)).toBeNull());
});

test("hides the notices-off banner while permission is granted", async () => {
  const { controller } = fakeController("granted");
  mockStatus = linked({ connection: "connected" });
  const screen = renderWithNotices(controller);
  await waitFor(() => expect(screen.getByText("WhatsApp conectado")).toBeTruthy());
  expect(screen.queryByText(/Los avisos están desactivados/)).toBeNull();
});

test("shows the catalog hint for no products and for products without searchable photos", async () => {
  const { controller } = fakeController("granted");
  mockStatus = linked({ connection: "connected" });

  const noProducts = renderWithNotices(controller, "no_active_products");
  await waitFor(() => expect(noProducts.getByText(/Aún no tienes productos/)).toBeTruthy());
  fireEvent.press(noProducts.getByRole("button", { name: "Ir a Productos" }));
  expect(mockPush).toHaveBeenCalledWith("/products");
  noProducts.unmount();

  const noPhotos = renderWithNotices(controller, "no_searchable_photos");
  await waitFor(() => expect(noPhotos.getByText(/todavía no puede reconocer fotos/)).toBeTruthy());
  noPhotos.unmount();

  const ready = renderWithNotices(controller, "ready");
  await waitFor(() => expect(ready.getByText("WhatsApp conectado")).toBeTruthy());
  expect(ready.queryByText("Ir a Productos")).toBeNull();
});
