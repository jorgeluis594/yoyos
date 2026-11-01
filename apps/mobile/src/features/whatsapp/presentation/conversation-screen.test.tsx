import { AccessibilityInfo, FlatList, StyleSheet } from "react-native";
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
const mockFindQuestions = jest.fn();
const runtime = { questions: { findOpenQuestions: (...args: unknown[]) => mockFindQuestions(...args) }, store: { listMessages: (...args: unknown[]) => mockListMessages(...args), findByCoreMessageId: (...args: unknown[]) => mockFind(...args), listFromArrivalSeq: (...args: unknown[]) => mockListFrom(...args) }, viewImage: (...args: unknown[]) => mockViewImage(...args), releaseImage: (...args: unknown[]) => mockReleaseImage(...(args as [])) };
let mockFocused = true;
jest.mock("expo-router", () => ({ useLocalSearchParams: () => mockParams, useIsFocused: () => mockFocused }));
jest.mock("@mobile/features/notifications/presentation/notices-provider", () => ({ useNoticeArrivals: (listener: (destination: unknown) => void) => { mockArrival = listener; } }));
jest.mock("expo-image", () => ({ Image: jest.requireActual("react-native").View }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: { status: "ready", company: { id: "c1" } } }) }));
jest.mock("@mobile/features/whatsapp/presentation/whatsapp-provider", () => ({ useWhatsApp: () => ({ runtime, status: { unsynced: 0 }, refresh: jest.fn(), messagesVersion: mockVersion }) }));

beforeEach(async () => { jest.clearAllMocks(); mockFindQuestions.mockResolvedValue(ok(new Map())); mockVersion = 0; mockFocused = true; mockParams = { chatId: "123456@lid" }; await i18n.changeLanguage("es"); });
afterEach(cleanup);

const text = (seq: number, sentAt: Date | null = new Date(1_700_000_000_000)) => ({
  id: `wa-message:v1:m${seq}`, arrivalSeq: seq, direction: "incoming", sentAt, content: { type: "text", text: `mensaje ${seq}` },
  sync: { state: "synced", coreMessageId: `core-${seq}`, syncedAt: new Date(1_700_000_000_000) },
});
const image = (seq: number) => ({ ...text(seq), content: { type: "image", caption: null, mimeType: "image/png", size: 1, reference: "wa-image:v1:x" } });

test("shows 'Fecha desconocida' for a message without date", async () => {
  mockListMessages.mockResolvedValue(ok([text(1, null)]));
  expect(await render(<ConversationScreen />).findByText(/Recibido · Fecha desconocida/)).toBeTruthy();
});

test("loads older messages by arrival sequence", async () => {
  jest.setTimeout(15_000);
  const firstPage = Array.from({ length: 30 }, (_, index) => text(60 - index));
  mockListMessages.mockResolvedValueOnce(ok(firstPage));
  mockListMessages.mockResolvedValueOnce(ok([text(30), text(29)]));
  const screen = render(<ConversationScreen />);
  fireEvent.press(await screen.findByRole("button", { name: "Cargar mensajes anteriores" }, { timeout: 5000 }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Cargar mensajes anteriores" })).toBeNull(), { timeout: 5000 });
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
    expect(announce).toHaveBeenCalledWith("Mensaje del aviso");
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

  test("keeps the loaded messages with a progress indicator while older pages load, and hides the load more button", async () => {
    open();
    mockFind.mockResolvedValue(ok({ ...text(10), chatId: "123456@lid" }));
    mockListFrom.mockResolvedValue(ok(range(1001, 2000)));
    let release: (value: unknown) => void = () => undefined;
    mockListMessages.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const screen = render(<ConversationScreen />);
    expect(await screen.findByText("mensaje 2000")).toBeTruthy();
    expect(screen.getByText("Buscando el mensaje del aviso…")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cargar mensajes anteriores" })).toBeNull();
    await act(async () => { release(ok(range(501, 1000).slice(0, 500))); });
    await act(async () => { await Promise.resolve(); });
  });

  test("keeps what was loaded when a page fails and Reintentar continues the search from where it stopped", async () => {
    open();
    mockFind.mockResolvedValue(ok({ ...text(10), chatId: "123456@lid" }));
    mockListFrom.mockResolvedValue(ok(range(1001, 2000)));
    mockListMessages.mockResolvedValueOnce(err({ code: "LOCAL_STORAGE_FAILED", message: "x" }));
    const screen = render(<ConversationScreen />);
    expect(await screen.findByText("No se pudo cargar el mensaje del aviso")).toBeTruthy();
    expect(screen.getByText("mensaje 2000")).toBeTruthy();
    mockListMessages.mockResolvedValueOnce(ok(range(10, 509).slice(0, 500)));
    fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(shownSeqs(screen)).toHaveLength(1500));
    expect(screen.queryByText("No se pudo cargar el mensaje del aviso")).toBeNull();
    expect(mockFind).toHaveBeenCalledTimes(1);
    expect(mockListFrom).toHaveBeenCalledTimes(1);
    expect(mockListMessages).toHaveBeenLastCalledWith("c1", "123456@lid", { beforeArrivalSeq: 1001, limit: 500 });
  });

  test("tints the notice's message differently from incoming and outgoing bubbles", async () => {
    open();
    mockFind.mockResolvedValue(ok({ ...text(2), chatId: "123456@lid" }));
    mockListFrom.mockResolvedValue(ok([{ ...text(3), direction: "outgoing" }, text(2)]));
    const screen = render(<ConversationScreen />);
    const notice = await screen.findByTestId("notice-message");
    const background = (node: { props: Record<string, unknown> }): unknown => (StyleSheet.flatten(node.props.style as never) as { backgroundColor?: string }).backgroundColor;
    const { Colors } = jest.requireActual("@mobile/constants/theme");
    expect(background(notice)).toBe(Colors.light.warningSurface);
    expect(background(notice)).not.toBe(Colors.light.backgroundElement);
    expect(background(notice)).not.toBe(Colors.light.backgroundSelected);
  });

  test("reads «Mensaje del aviso» with the message as one element for a text notice", async () => {
    open();
    mockFind.mockResolvedValue(ok({ ...text(2), chatId: "123456@lid" }));
    mockListFrom.mockResolvedValue(ok([text(2)]));
    const screen = render(<ConversationScreen />);
    const notice = await screen.findByTestId("notice-message");
    expect(notice.props.accessible).toBe(true);
    expect(notice.props.accessibilityLabel).toMatch(/^Mensaje del aviso\. mensaje 2\./);
  });

  test("keeps the image of a notice reachable and still speaks «Mensaje del aviso» for its label", async () => {
    open();
    mockFind.mockResolvedValue(ok({ ...image(2), chatId: "123456@lid" }));
    mockListFrom.mockResolvedValue(ok([image(2)]));
    const screen = render(<ConversationScreen />);
    expect(await screen.findByLabelText("Mensaje del aviso")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ver imagen" })).toBeTruthy();
  });

  test("does not announce a notice while the conversation is not focused but still marks it", async () => {
    mockListMessages.mockResolvedValue(ok(range(1, 3)));
    const screen = render(<ConversationScreen />);
    await screen.findByText("mensaje 3");
    mockFocused = false;
    screen.rerender(<ConversationScreen />);
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    mockFind.mockResolvedValue(ok({ ...text(2), chatId: "123456@lid" }));
    await act(async () => { mockArrival({ v: 1, companyId: "c1", messageId: coreMessageId, target: "message" }); });
    expect(await screen.findByText("Aviso")).toBeTruthy();
    expect(announce).not.toHaveBeenCalled();
  });
});

const question = (id: string, questionText: string) => ({ id, text: questionText, about: "Polo básico" });

test("the chat view shows a question box with Copiar pregunta under a message with an open point", async () => {
  mockListMessages.mockResolvedValue(ok([text(2), text(1)]));
  mockFindQuestions.mockResolvedValue(ok(new Map([["core-1", [question("p1", "Polo básico: ¿en qué talla, S, M o L?")]]])));
  const screen = render(<ConversationScreen />);
  expect(await screen.findByText("Pregúntale al cliente:")).toBeTruthy();
  expect(screen.getByText("Polo básico: ¿en qué talla, S, M o L?")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Copiar pregunta" })).toHaveLength(1);
  expect(mockFindQuestions).toHaveBeenCalledWith(["core-2", "core-1"]);
});

test("the chat view shows up to three boxes for a message with several points", async () => {
  mockListMessages.mockResolvedValue(ok([text(1)]));
  mockFindQuestions.mockResolvedValue(ok(new Map([["core-1", ["a", "b", "c", "d"].map((id) => question(id, `pregunta ${id}`))]])));
  const screen = render(<ConversationScreen />);
  expect(await screen.findAllByRole("button", { name: "Copiar pregunta" })).toHaveLength(3);
  expect(screen.queryByText("pregunta d")).toBeNull();
});

test("asks core only for incoming messages core already has", async () => {
  mockListMessages.mockResolvedValue(ok([
    { ...text(3), direction: "outgoing" }, { ...text(2), sync: { state: "pending", attempts: 0, nextAttemptAt: new Date() } }, text(1),
  ]));
  render(<ConversationScreen />);
  await waitFor(() => expect(mockFindQuestions).toHaveBeenCalledWith(["core-1"]));
});

test("a lookup that fails leaves the chat as it is", async () => {
  mockListMessages.mockResolvedValue(ok([text(1)]));
  mockFindQuestions.mockResolvedValue(err({ code: "NETWORK_ERROR", message: "offline" }));
  const screen = render(<ConversationScreen />);
  expect(await screen.findByText("mensaje 1")).toBeTruthy();
  expect(screen.queryByText("Pregúntale al cliente:")).toBeNull();
});

test("a box leaves the next time the questions load, when the seller returns to the screen", async () => {
  mockListMessages.mockResolvedValue(ok([text(1)]));
  mockFindQuestions.mockResolvedValueOnce(ok(new Map([["core-1", [question("p1", "¿Cuál quieres?")]]])));
  const screen = render(<ConversationScreen />);
  expect(await screen.findByText("¿Cuál quieres?")).toBeTruthy();
  mockFocused = false;
  screen.rerender(<ConversationScreen />);
  expect(mockFindQuestions).toHaveBeenCalledTimes(1);
  mockFocused = true;
  screen.rerender(<ConversationScreen />);
  await waitFor(() => expect(mockFindQuestions).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText("¿Cuál quieres?")).toBeNull());
});

test("a refresh that fails removes the boxes and the next trigger retries", async () => {
  mockListMessages.mockResolvedValue(ok([text(1)]));
  mockFindQuestions.mockResolvedValueOnce(ok(new Map([["core-1", [question("p1", "¿Cuál quieres?")]]])));
  mockFindQuestions.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "offline" }));
  const screen = render(<ConversationScreen />);
  expect(await screen.findByText("¿Cuál quieres?")).toBeTruthy();
  mockFocused = false;
  screen.rerender(<ConversationScreen />);
  mockFocused = true;
  screen.rerender(<ConversationScreen />);
  await waitFor(() => expect(mockFindQuestions).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText("¿Cuál quieres?")).toBeNull());
  mockFindQuestions.mockResolvedValueOnce(ok(new Map([["core-1", [question("p1", "¿Cuál quieres?")]]])));
  mockFocused = false;
  screen.rerender(<ConversationScreen />);
  mockFocused = true;
  screen.rerender(<ConversationScreen />);
  expect(await screen.findByText("¿Cuál quieres?")).toBeTruthy();
});

test("a foreground notice for the chat loads the questions again", async () => {
  mockListMessages.mockResolvedValue(ok([text(1)]));
  mockFind.mockResolvedValue(ok({ ...text(1), chatId: "123456@lid" }));
  const screen = render(<ConversationScreen />);
  await screen.findByText("mensaje 1");
  await waitFor(() => expect(mockFindQuestions).toHaveBeenCalledTimes(1));
  mockFindQuestions.mockResolvedValueOnce(ok(new Map([["core-1", [question("p1", "¿Cuál quieres?")]]])));
  await act(async () => { mockArrival({ target: "message", messageId: "00000000-0000-4000-8000-000000000001" }); });
  expect(await screen.findByText("¿Cuál quieres?")).toBeTruthy();
});
