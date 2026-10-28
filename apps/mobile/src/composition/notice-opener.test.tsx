import { Alert } from "react-native";
import { act, cleanup, render, waitFor } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import { createNoticeInbox } from "@mobile/features/notifications/application/open-notice";
import { createNoticesController } from "@mobile/features/notifications/application/notices-controller";
import { createFakeApi, createFakeGateway, createFakeStore } from "@mobile/features/notifications/application/fakes";
import { NoticeResponseCapture } from "@mobile/features/notifications/presentation/notice-responses";
import { NoticeOpener } from "@mobile/composition/notice-opener";
import i18n from "@mobile/i18n";

const company = "6f1d5c1e-5b0b-4c53-9a53-0d6a0b3b2a11";
const other = "0b1f2a43-9f3c-4f0e-8d0b-6f1a2b3c4d5e";
const messageId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const orderId = "9d3b1f7a-1c52-4c2e-bb0f-2f5d2f3b8a10";
const data = (target: "message" | "order" = "message", companyId = company) => ({ v: 1, companyId, messageId, target });

const mockNavigate = jest.fn();
let mockNavigationKey: string | undefined = "root";
let mockAccess: { status: string; company?: { id: string } } = { status: "ready", company: { id: company } };
let mockRuntime: unknown = null;
const mockProductDraft = { dirty: false, discard: jest.fn() };
const mockOrderDraft = { dirty: false, discard: jest.fn() };
const mockFindByCoreMessageId = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ navigate: mockNavigate }),
  useRootNavigationState: () => ({ key: mockNavigationKey }),
}));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: mockAccess }) }));
jest.mock("@mobile/features/whatsapp/presentation/whatsapp-provider", () => ({ useWhatsApp: () => ({ runtime: mockRuntime }) }));
jest.mock("@mobile/features/products/presentation/draft-guard", () => ({ useProductDraft: () => mockProductDraft }));
jest.mock("@mobile/features/orders/presentation/order-draft-guard", () => ({ useOrderDraft: () => mockOrderDraft }));

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage("es");
  mockNavigationKey = "root";
  mockAccess = { status: "ready", company: { id: company } };
  mockRuntime = { store: { findByCoreMessageId: (...args: unknown[]) => mockFindByCoreMessageId(...args) } };
  mockProductDraft.dirty = false;
  mockOrderDraft.dirty = false;
  mockFindByCoreMessageId.mockResolvedValue(ok({ chatId: "123456@lid" }));
});
afterEach(cleanup);

function setup(resolveOrder: jest.Mock = jest.fn(async () => ok(orderId))) {
  const gateway = createFakeGateway();
  const controller = createNoticesController({
    gateway: gateway.gateway, store: createFakeStore().store, api: createFakeApi().api, platform: "android",
    readSessionId: async () => "s", locale: () => "es", confirm: async () => true,
  });
  const inbox = createNoticeInbox();
  const tree = () => (<>
    <NoticeResponseCapture controller={controller} inbox={inbox} />
    <NoticeOpener inbox={inbox} resolveOrder={resolveOrder} />
  </>);
  return { gateway, inbox, tree, resolveOrder };
}

test("opens the chat on the notice's message when the seller taps a message notice", async () => {
  const { gateway, tree } = setup();
  render(tree());
  await act(async () => { gateway.emitResponse({ id: "n1", data: data() }); });
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ pathname: "/whatsapp/chats/[chatId]", params: { chatId: "123456@lid", noticeMessageId: messageId } }));
  expect(mockFindByCoreMessageId).toHaveBeenCalledWith(company, messageId);
});

test("opens the chats list with the chat missing marker when the phone has no such message", async () => {
  mockFindByCoreMessageId.mockResolvedValue(ok(null));
  const { gateway, tree } = setup();
  render(tree());
  await act(async () => { gateway.emitResponse({ id: "n1", data: data() }); });
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ pathname: "/whatsapp/chats", params: { noticeChatMissing: "1" } }));
});

test("opens the order of an order notice in its current state", async () => {
  const { gateway, tree, resolveOrder } = setup();
  render(tree());
  await act(async () => { gateway.emitResponse({ id: "n1", data: data("order") }); });
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ pathname: "/orders/[id]", params: { id: orderId, noticeAt: expect.any(String) } }));
  expect(resolveOrder).toHaveBeenCalledWith(messageId);
});

test("tells the seller when the notice cannot be opened and goes nowhere", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const { gateway, tree } = setup(jest.fn(async () => err({ message: "offline" })));
  render(tree());
  await act(async () => { gateway.emitResponse({ id: "n1", data: data("order") }); });
  await waitFor(() => expect(alert).toHaveBeenCalledWith("No se pudo abrir el aviso. Inténtalo de nuevo"));
  expect(mockNavigate).not.toHaveBeenCalled();
});

test("asks to discard a dirty sale before opening a notice", async () => {
  mockOrderDraft.dirty = true;
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const { gateway, tree } = setup();
  render(tree());
  await act(async () => { gateway.emitResponse({ id: "n1", data: data() }); });
  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(alert.mock.calls[0][0]).toBe("¿Descartar cambios?");
  expect(mockNavigate).not.toHaveBeenCalled();
  const discard = (alert.mock.calls[0][2] as { text: string; onPress: () => void }[]).find((button) => button.text === "Descartar");
  await act(async () => { discard?.onPress(); });
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
  expect(mockOrderDraft.discard).toHaveBeenCalled();
  expect(mockProductDraft.discard).not.toHaveBeenCalled();
});

test("keeps a notice tapped while signed out and goes to its destination after signing in to the same company", async () => {
  mockAccess = { status: "signed_out" };
  const { gateway, tree } = setup();
  const view = render(tree());
  await act(async () => { gateway.emitResponse({ id: "n1", data: data() }); });
  expect(mockNavigate).not.toHaveBeenCalled();
  mockAccess = { status: "ready", company: { id: company } };
  view.rerender(tree());
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/whatsapp/chats/[chatId]" })));
});

test("goes home after signing in to another company", async () => {
  mockAccess = { status: "signed_out" };
  const { gateway, tree } = setup();
  const view = render(tree());
  await act(async () => { gateway.emitResponse({ id: "n1", data: data("message", other) }); });
  mockAccess = { status: "ready", company: { id: company } };
  view.rerender(tree());
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
  expect(mockFindByCoreMessageId).not.toHaveBeenCalled();
});

test("waits for the session to be restored and for the navigator before opening a tapped notice", async () => {
  mockAccess = { status: "checking" };
  mockNavigationKey = undefined;
  const { gateway, tree } = setup();
  gateway.state.last = { id: "launch", data: data() };
  const view = render(tree());
  await act(async () => { await Promise.resolve(); });
  expect(mockNavigate).not.toHaveBeenCalled();
  mockAccess = { status: "ready", company: { id: company } };
  view.rerender(tree());
  await act(async () => { await Promise.resolve(); });
  expect(mockNavigate).not.toHaveBeenCalled();
  mockNavigationKey = "root";
  view.rerender(tree());
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
});

test("waits for the local message store before looking for the message", async () => {
  mockRuntime = null;
  const { gateway, tree } = setup();
  const view = render(tree());
  await act(async () => { gateway.emitResponse({ id: "n1", data: data() }); });
  expect(mockNavigate).not.toHaveBeenCalled();
  mockRuntime = { store: { findByCoreMessageId: (...args: unknown[]) => mockFindByCoreMessageId(...args) } };
  view.rerender(tree());
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
});

test("opens an order notice and goes home without the local message store", async () => {
  mockRuntime = null;
  const { gateway, tree } = setup();
  const view = render(tree());
  await act(async () => { gateway.emitResponse({ id: "n1", data: data("order") }); });
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ pathname: "/orders/[id]", params: { id: orderId, noticeAt: expect.any(String) } }));
  await act(async () => { gateway.emitResponse({ id: "n2", data: data("message", other) }); });
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
  expect(mockFindByCoreMessageId).not.toHaveBeenCalled();
  view.unmount();
});

test("gives every order tap its own noticeAt so the same open order can reload", async () => {
  const { gateway, tree } = setup();
  render(tree());
  let tick = 0;
  jest.spyOn(Date, "now").mockImplementation(() => (tick += 1000));
  await act(async () => { gateway.emitResponse({ id: "n1", data: data("order") }); });
  await act(async () => { gateway.emitResponse({ id: "n2", data: data("order") }); });
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(2));
  const [first, second] = mockNavigate.mock.calls.map(([target]) => target.params.noticeAt);
  expect(first).not.toBe(second);
});
