import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import ConversationScreen from "@mobile/features/whatsapp/presentation/conversation-screen";
import i18n from "@mobile/i18n";

const mockListMessages = jest.fn();
const mockViewImage = jest.fn();
const mockReleaseImage = jest.fn(async () => ok(undefined));
const runtime = { store: { listMessages: (...args: unknown[]) => mockListMessages(...args) }, viewImage: (...args: unknown[]) => mockViewImage(...args), releaseImage: (...args: unknown[]) => mockReleaseImage(...(args as [])) };
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ chatId: "123456@lid" }) }));
jest.mock("expo-image", () => ({ Image: jest.requireActual("react-native").View }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: { status: "ready", company: { id: "c1" } } }) }));
jest.mock("@mobile/features/whatsapp/presentation/whatsapp-provider", () => ({ useWhatsApp: () => ({ runtime, status: { unsynced: 0 }, refresh: jest.fn() }) }));

beforeEach(async () => { jest.clearAllMocks(); await i18n.changeLanguage("es"); });
afterEach(cleanup);

const text = (seq: number, sentAt: Date | null = new Date(1_700_000_000_000)) => ({
  id: `wa-message:v1:m${seq}`, arrivalSeq: seq, direction: "incoming", sentAt, content: { type: "text", text: `mensaje ${seq}` },
});
const image = (seq: number) => ({ ...text(seq), content: { type: "image", caption: null, mimeType: "image/png", size: 1, reference: "wa-image:v1:x" } });

test("shows 'Fecha desconocida' for a message without date", async () => {
  mockListMessages.mockResolvedValue(ok([text(1, null)]));
  expect(await render(<ConversationScreen />).findByText(/Recibido · Fecha desconocida/)).toBeTruthy();
});

test("loads older messages by arrival sequence", async () => {
  const firstPage = Array.from({ length: 30 }, (_, index) => text(60 - index));
  mockListMessages.mockResolvedValueOnce(ok(firstPage));
  mockListMessages.mockResolvedValueOnce(ok([text(30), text(29)]));
  const screen = render(<ConversationScreen />);
  fireEvent.press(await screen.findByRole("button", { name: "Cargar mensajes anteriores" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Cargar mensajes anteriores" })).toBeNull());
  expect(mockListMessages).toHaveBeenNthCalledWith(1, "c1", "123456@lid", { beforeArrivalSeq: null, limit: 30 });
  expect(mockListMessages).toHaveBeenNthCalledWith(2, "c1", "123456@lid", { beforeArrivalSeq: 31, limit: 30 });
});

test("loads an image on demand and releases it when leaving the screen", async () => {
  mockListMessages.mockResolvedValue(ok([image(1)]));
  mockViewImage.mockResolvedValue(ok({ uri: "file:///private/a.png", mimeType: "image/png", size: 1 }));
  const screen = render(<ConversationScreen />);
  expect(mockViewImage).not.toHaveBeenCalled();
  fireEvent.press(await screen.findByRole("button", { name: "Ver imagen" }));
  await waitFor(() => expect(screen.getByLabelText("Imagen")).toBeTruthy());
  expect(mockViewImage).toHaveBeenCalledWith("c1", "wa-message:v1:m1");
  screen.unmount();
  expect(mockReleaseImage).toHaveBeenCalledWith("wa-message:v1:m1");
});

test("offers retry for IMAGE_DOWNLOAD_FAILED and shows IMAGE_UNAVAILABLE as final", async () => {
  mockListMessages.mockResolvedValue(ok([image(1)]));
  mockViewImage.mockResolvedValueOnce(err({ code: "IMAGE_DOWNLOAD_FAILED", message: "x" }));
  const screen = render(<ConversationScreen />);
  fireEvent.press(await screen.findByRole("button", { name: "Ver imagen" }));
  expect(await screen.findByText("No se pudo descargar la imagen.")).toBeTruthy();
  mockViewImage.mockResolvedValueOnce(err({ code: "IMAGE_UNAVAILABLE", message: "x" }));
  fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByText("La imagen ya no está disponible en WhatsApp.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  expect(mockReleaseImage).not.toHaveBeenCalled();
});
