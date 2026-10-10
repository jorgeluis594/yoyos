import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { ok } from "@shared/functional";
import ConversationsScreen from "@mobile/features/whatsapp/presentation/conversations-screen";
import i18n from "@mobile/i18n";

const mockPush = jest.fn();
const mockListConversations = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: { status: "ready", company: { id: "c1" } } }) }));
const mockContext = { runtime: { store: { listConversations: (...args: unknown[]) => mockListConversations(...args) } }, status: { unsynced: 0, connection: "connected" }, refresh: jest.fn() };
jest.mock("@mobile/features/whatsapp/presentation/whatsapp-provider", () => ({ useWhatsApp: () => mockContext }));

beforeEach(async () => { jest.clearAllMocks(); await i18n.changeLanguage("es"); });
afterEach(cleanup);

const summary = (chatId: string, overrides = {}) => ({
  chatId, lastMessage: { preview: "hola", type: "text", sentAt: new Date(1_700_000_000_000), direction: "incoming" }, messageCount: 2, unsynced: 0, ...overrides,
});

test("lists conversations with their unsynced indicator and the abbreviated LID as name", async () => {
  mockListConversations.mockResolvedValue(ok([summary("51987654321@lid", { unsynced: 1 }), summary("5199999@lid")]));
  const screen = render(<ConversationsScreen />);
  expect(await screen.findByText("…4321")).toBeTruthy();
  expect(screen.getByText("…9999")).toBeTruthy();
  expect(screen.getAllByText("Sin sincronizar")).toHaveLength(1);
  expect(mockListConversations).toHaveBeenCalledWith("c1");
});

test("shows 'Fecha desconocida' for a conversation whose last message has no date", async () => {
  mockListConversations.mockResolvedValue(ok([summary("123456@lid", { lastMessage: { preview: null, type: "image", sentAt: null, direction: "incoming" } })]));
  const screen = render(<ConversationsScreen />);
  expect(await screen.findByText(/Imagen · Fecha desconocida/)).toBeTruthy();
});

test("opens a conversation by its chat id", async () => {
  mockListConversations.mockResolvedValue(ok([summary("123456@lid")]));
  const screen = render(<ConversationsScreen />);
  fireEvent.press(await screen.findByText("…3456"));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/whatsapp/chats/[chatId]", params: { chatId: "123456@lid" } });
});

test("shows an empty state without conversations", async () => {
  mockListConversations.mockResolvedValue(ok([]));
  expect(await render(<ConversationsScreen />).findByText("Aún no hay conversaciones")).toBeTruthy();
});

test("offers retry when conversations cannot be read", async () => {
  mockListConversations.mockResolvedValueOnce({ success: false, error: { code: "LOCAL_STORAGE_FAILED", message: "x" } });
  mockListConversations.mockResolvedValueOnce(ok([summary("123456@lid")]));
  const screen = render(<ConversationsScreen />);
  fireEvent.press(await screen.findByRole("button", { name: "Reintentar" }));
  expect(await screen.findByText("…3456")).toBeTruthy();
});
