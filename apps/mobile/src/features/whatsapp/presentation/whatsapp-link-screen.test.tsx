import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ok } from "@shared/functional";
import WhatsAppLinkScreen from "@mobile/features/whatsapp/presentation/whatsapp-link-screen";
import { initialWhatsAppStatus, type WhatsAppStatus } from "@mobile/features/whatsapp/presentation/whatsapp-status";
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
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
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
