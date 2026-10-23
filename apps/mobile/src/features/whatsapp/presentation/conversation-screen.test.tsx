import { AccessibilityInfo, FlatList } from "react-native";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import ConversationScreen, { mergeLatest } from "@mobile/features/whatsapp/presentation/conversation-screen";
import i18n from "@mobile/i18n";

let mockVersion = 0;
const mockListMessages = jest.fn();
const mockViewImage = jest.fn();
const mockReleaseImage = jest.fn(async () => ok(undefined));
const mockFind = jest.fn();
const mockListFrom = jest.fn();
let mockParams: Record<string, string> = { chatId: "123456@lid" };
let mockArrival: (destination: unknown) => void = () => undefined;
const runtime = { store: { listMessages: (...args: unknown[]) => mockListMessages(...args), findByCoreMessageId: (...args: unknown[]) => mockFind(...args), listFromArrivalSeq: (...args: unknown[]) => mockListFrom(...args) }, viewImage: (...args: unknown[]) => mockViewImage(...args), releaseImage: (...args: unknown[]) => mockReleaseImage(...(args as [])) };
jest.mock("expo-router", () => ({ useLocalSearchParams: () => mockParams }));
jest.mock("@mobile/features/notifications/presentation/notices-provider", () => ({ useNoticeArrivals: (listener: (destination: unknown) => void) => { mockArrival = listener; } }));
jest.mock("expo-image", () => ({ Image: jest.requireActual("react-native").View }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: { status: "ready", company: { id: "c1" } } }) }));
jest.mock("@mobile/features/whatsapp/presentation/whatsapp-provider", () => ({ useWhatsApp: () => ({ runtime, status: { unsynced: 0 }, refresh: jest.fn(), messagesVersion: mockVersion }) }));

beforeEach(async () => { jest.clearAllMocks(); mockVersion = 0; mockParams = { chatId: "123456@lid" }; await i18n.changeLanguage("es"); });
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

test("a message change keeps the older pages already loaded and adds the new message", async () => {
  const firstPage = Array.from({ length: 30 }, (_, index) => text(60 - index));
  mockListMessages.mockResolvedValueOnce(ok(firstPage));
  mockListMessages.mockResolvedValueOnce(ok([text(30), text(29)]));
  const screen = render(<ConversationScreen />);
  fireEvent.press(await screen.findByRole("button", { name: "Cargar mensajes anteriores" }));
  const shown = () => screen.UNSAFE_getByType(FlatList).props.data.map((message: { arrivalSeq: number }) => message.arrivalSeq);
  await waitFor(() => expect(shown()).toHaveLength(32));
  mockListMessages.mockResolvedValueOnce(ok([text(61), ...firstPage.slice(0, 29)]));
  mockVersion = 1;
  screen.rerender(<ConversationScreen />);
  await waitFor(() => expect(shown()).toHaveLength(33));
  expect(shown()).toEqual([61, ...Array.from({ length: 32 }, (_, index) => 60 - index)]);
});

test("mergeLatest updates an existing message in place without duplicating it", () => {
  const stale = { ...text(2), sync: { status: "pending" } } as never;
  const synced = { ...text(2), sync: { status: "synced" } } as never;
  const merged = mergeLatest([text(3), stale, text(1)] as never, [text(4), text(3), synced] as never);
  expect(merged.map((message) => message.arrivalSeq)).toEqual([4, 3, 2, 1]);
  expect(merged[2]).toBe(synced);
});

describe("opening a notice", () => {
  const coreMessageId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => text(to - index));
  const open = () => { mockParams = { chatId: "123456@lid", noticeMessageId: coreMessageId }; };
  const shownSeqs = (screen: ReturnType<typeof render>) => screen.UNSAFE_getByType(FlatList).props.data.map((message: { arrivalSeq: number }) => message.arrivalSeq);

  test("opens the chat on the notice's message loaded in one query from its position", async () => {
    open();
    mockFind.mockResolvedValue(ok({ ...text(30), chatId: "123456@lid" }));
    mockListFrom.mockResolvedValue(ok(range(30, 100)));
    const scrollToIndex = jest.spyOn(FlatList.prototype, "scrollToIndex").mockImplementation(() => undefined);
    const screen = render(<ConversationScreen />);
    expect(screen.getByText("Buscando el mensaje del aviso…")).toBeTruthy();
    await waitFor(() => expect(shownSeqs(screen)).toHaveLength(71));
    expect(mockFind).toHaveBeenCalledWith("c1", coreMessageId);
    expect(mockListFrom).toHaveBeenCalledTimes(1);
    expect(mockListFrom).toHaveBeenCalledWith("c1", "123456@lid", 30, 1000);
    expect(mockListMessages).not.toHaveBeenCalled();
    expect(screen.getAllByText("Aviso")).toHaveLength(1);
    fireEvent(screen.UNSAFE_getByType(FlatList), "contentSizeChange", 300, 4000);
    expect(scrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 70, animated: false }));
    scrollToIndex.mockRestore();
  });

  test("shows retry when loading fails while searching for the notice's message", async () => {
    open();
    mockFind.mockResolvedValueOnce(err({ code: "LOCAL_STORAGE_FAILED", message: "x" }));
    const screen = render(<ConversationScreen />);
    expect(await screen.findByText("No se pudo cargar el mensaje del aviso")).toBeTruthy();
    mockFind.mockResolvedValue(ok({ ...text(3), chatId: "123456@lid" }));
    mockListFrom.mockResolvedValue(ok(range(3, 5)));
    fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(shownSeqs(screen)).toEqual([5, 4, 3]));
    expect(screen.getAllByText("Aviso")).toHaveLength(1);
  });

  test("shows the message is no longer on the phone when it is not found", async () => {
    open();
    mockFind.mockResolvedValue(ok(null));
    mockListMessages.mockResolvedValue(ok([text(2), text(1)]));
    const screen = render(<ConversationScreen />);
    expect(await screen.findByText("Ese mensaje ya no está en este teléfono")).toBeTruthy();
    expect(shownSeqs(screen)).toEqual([2, 1]);
    expect(screen.queryByText("Aviso")).toBeNull();
  });

  test("shows the chat is no longer on the phone when the chat is missing", async () => {
    open();
    mockFind.mockResolvedValue(ok(null));
    mockListMessages.mockResolvedValue(ok([]));
    const screen = render(<ConversationScreen />);
    expect(await screen.findByText("Este chat ya no está en este teléfono")).toBeTruthy();
  });

  test("marks the notice's message with the Aviso label and announces it to screen readers", async () => {
    open();
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    mockFind.mockResolvedValue(ok({ ...text(2), chatId: "123456@lid" }));
    mockListFrom.mockResolvedValue(ok(range(2, 3)));
    const screen = render(<ConversationScreen />);
    expect(await screen.findByText("Aviso")).toBeTruthy();
    expect(announce).toHaveBeenCalledWith("Aviso: este mensaje necesita tu revisión");
  });

  test("marks the message of a notice that arrives for the open chat without moving the scroll", async () => {
    mockListMessages.mockResolvedValue(ok(range(1, 3)));
    const screen = render(<ConversationScreen />);
    await screen.findByText("mensaje 3");
    const scrollToIndex = jest.spyOn(FlatList.prototype, "scrollToIndex");
    const scrollToOffset = jest.spyOn(FlatList.prototype, "scrollToOffset");
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    mockFind.mockResolvedValue(ok({ ...text(2), chatId: "123456@lid" }));
    await act(async () => { mockArrival({ v: 1, companyId: "c1", messageId: coreMessageId, target: "message" }); });
    expect(await screen.findByText("Aviso")).toBeTruthy();
    expect(mockFind).toHaveBeenCalledWith("c1", coreMessageId);
    expect(announce).toHaveBeenCalled();
    expect(scrollToIndex).not.toHaveBeenCalled();
    expect(scrollToOffset).not.toHaveBeenCalled();
    expect(mockListMessages).toHaveBeenCalledTimes(1);
  });

  test("ignores a notice that arrives for another chat or for an order", async () => {
    mockListMessages.mockResolvedValue(ok(range(1, 3)));
    const screen = render(<ConversationScreen />);
    await screen.findByText("mensaje 3");
    mockFind.mockResolvedValue(ok({ ...text(2), chatId: "999@lid" }));
    await act(async () => { mockArrival({ v: 1, companyId: "c1", messageId: coreMessageId, target: "message" }); });
    await act(async () => { mockArrival({ v: 1, companyId: "c1", messageId: coreMessageId, target: "order" }); });
    expect(screen.queryByText("Aviso")).toBeNull();
    expect(mockFind).toHaveBeenCalledTimes(1);
  });
});
