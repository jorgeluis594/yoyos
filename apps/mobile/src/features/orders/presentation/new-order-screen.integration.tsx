// Run by core/tests/e2e/mobile-order-creation.spec.ts against its isolated API/database.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";
import { createOrderOperations } from "@mobile/features/orders/application/order-operations";
import { createOrderApi } from "@mobile/features/orders/infrastructure/order-api";
import { createPendingOrderConfirmationStore } from "@mobile/features/orders/infrastructure/pending-order-confirmation";
import NewOrderScreen from "@mobile/features/orders/presentation/new-order-screen";
import "@mobile/i18n";

const mockReplace = jest.fn();
let mockOrders: ReturnType<typeof createOrderOperations>;
let mockLoseResponse = false;
let mockOfflineRead = false;
let mockPosts = 0;
let directory: string;

// Native navigation/session are supplied by the harness; feature code and HTTP remain real.
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), replace: mockReplace }), useNavigation: () => ({ dispatch: jest.fn() }) }));
jest.mock("expo-router/react-navigation", () => ({ usePreventRemove: jest.fn() }));
jest.mock("expo-crypto", () => ({ randomUUID: () => jest.requireActual<typeof import("node:crypto")>("node:crypto").randomUUID() }));
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
  getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }) }));
jest.mock("@mobile/features/orders/composition", () => ({ orders: {
  readPendingOrderConfirmation: (...args: Parameters<typeof mockOrders.readPendingOrderConfirmation>) => mockOrders.readPendingOrderConfirmation(...args),
  resolvePendingOrderConfirmation: (...args: Parameters<typeof mockOrders.resolvePendingOrderConfirmation>) => mockOrders.resolvePendingOrderConfirmation(...args),
  searchOrderCatalog: (...args: Parameters<typeof mockOrders.searchOrderCatalog>) => mockOrders.searchOrderCatalog(...args),
  searchOrderContacts: (...args: Parameters<typeof mockOrders.searchOrderContacts>) => mockOrders.searchOrderContacts(...args),
  completeOrder: (...args: Parameters<typeof mockOrders.completeOrder>) => mockOrders.completeOrder(...args),
  resendPendingOrder: (...args: Parameters<typeof mockOrders.resendPendingOrder>) => mockOrders.resendPendingOrder(...args),
} }));
jest.mock("@mobile/features/delivery-settings/composition", () => ({ deliverySettings: { get: async () => ({ success: true,
  data: { version: 0, home: { enabled: false }, store: { enabled: false, pickupPoint: null }, agency: { enabled: false }, couriers: [] } }) } }));
jest.mock("@expo/ui", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const Picker = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Picker.Item = function PickerItem() { return null; };
  return { Host: View, Picker };
});
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: {
  status: "ready", company: { id: process.env.ORDER_JOURNEY_COMPANY, name: "Journey company", country: "PE" }, user: { id: "seller" },
} }) }));
jest.mock("@mobile/features/orders/presentation/order-draft-guard", () => ({ useOrderDraft: () => ({ dirty: false, setDirty: jest.fn(), discardVersion: 0 }) }));
jest.mock("@mobile/features/orders/presentation/order-result", () => ({ useOrderResult: () => ({ show: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));

async function request(path: string, init: RequestInit = {}): Promise<Result<unknown, TransportError>> {
  if (mockOfflineRead && path.endsWith("/aggregate")) return err({ code: "NETWORK_ERROR", message: "Read unavailable" });
  const result = await new Promise<Result<unknown, TransportError>>((resolve) => {
    const outgoing = httpRequest(new URL(path, process.env.ORDER_JOURNEY_ORIGIN), {
      method: init.method ?? "GET", headers: { "content-type": "application/json", cookie: process.env.ORDER_JOURNEY_COOKIE! },
    }, incoming => {
      let raw = "";
      incoming.setEncoding("utf8");
      incoming.on("data", chunk => { raw += chunk; });
      incoming.on("end", () => {
        try {
          const body: unknown = JSON.parse(raw);
          resolve(incoming.statusCode! < 400 ? ok(body) : err({ code: "API_ERROR", message: "API rejected request", http: { status: incoming.statusCode!, body } }));
        } catch { resolve(err({ code: "INVALID_RESPONSE", message: "Invalid JSON" })); }
      });
    });
    outgoing.on("error", () => resolve(err({ code: "NETWORK_ERROR", message: "HTTP unavailable" })));
    outgoing.end(typeof init.body === "string" ? init.body : undefined);
  });
  if (path === "/api/orders" && init.method === "POST") {
    mockPosts++;
    if (mockLoseResponse) return err({ code: "NETWORK_ERROR", message: "Response lost after commit" });
  }
  return result;
}

function restartOperations() {
  const store = createPendingOrderConfirmationStore({
    getItemAsync: async key => {
      try { return readFileSync(join(directory, key), "utf8"); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null; throw cause; }
    },
    setItemAsync: async (key, value) => { writeFileSync(join(directory, key), value); },
    deleteItemAsync: async key => { unlinkSync(join(directory, key)); },
  });
  mockOrders = createOrderOperations(createOrderApi(request), store);
}

beforeEach(() => {
  mockReplace.mockClear(); mockLoseResponse = false; mockOfflineRead = false; mockPosts = 0;
  directory = mkdtempSync(join(tmpdir(), "mobile-order-journey-"));
  restartOperations();
});
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

async function review() {
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Journey product");
  fireEvent.press(screen.getByRole("button", { name: /Journey product/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  fireEvent.press(screen.getByRole("button", { name: "Revisar venta" }));
  return screen;
}

test("mobile interface creates a pending order without payments or stock changes", async () => {
  const screen = await review();
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
  const id = mockReplace.mock.calls[0][0].split("/").at(-1);
  expect(await mockOrders.loadOrder(id)).toMatchObject({ success: true, data: {
    status: "active", paymentStatus: "pending", deliveryStatus: "pending", payments: [], stockDeducted: false, completedAt: null,
  } });
  expect(mockPosts).toBe(1);
});

test("mobile interface creates an immediate sale with payment, stock deduction and delivery", async () => {
  const screen = await review();
  fireEvent.press(screen.getByRole("button", { name: "Agregar pago" }));
  fireEvent.changeText(screen.getByLabelText(/Importe recibido/), "10");
  fireEvent(screen.getByRole("switch", { name: "Marcar como entregado al guardar" }), "valueChange", true);
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
  const id = mockReplace.mock.calls[0][0].split("/").at(-1);
  expect(await mockOrders.loadOrder(id)).toMatchObject({ success: true, data: {
    status: "completed", paymentStatus: "paid", deliveryStatus: "delivered", stockDeducted: true, completedAt: expect.any(String),
    payments: [expect.objectContaining({ status: "confirmed", amount: { amount: 10, currency: "PEN" } })],
  } });
  expect(mockPosts).toBe(1);
});

test("mobile recovers a persisted pending creation after a lost response and restart without reposting", async () => {
  const screen = await review();
  mockLoseResponse = true; mockOfflineRead = true;
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await screen.findByText("Venta pendiente de confirmar");
  expect(mockReplace).not.toHaveBeenCalled();
  const saved = await mockOrders.readPendingOrderConfirmation(process.env.ORDER_JOURNEY_COMPANY!);
  expect(saved).toMatchObject({ success: true, data: { version: 2, request: { contactId: null } } });
  if (!saved.success || !saved.data) throw new Error("Missing persisted attempt");
  const id = saved.data.id;
  screen.unmount();
  mockOfflineRead = false; mockLoseResponse = false;
  restartOperations();
  const reopened = render(<NewOrderScreen />);
  await reopened.findByText("Venta pendiente de confirmar");
  fireEvent.press(reopened.getByRole("button", { name: "Verificar venta" }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/orders/${id}`));
  expect(await mockOrders.loadOrder(id)).toMatchObject({ success: true, data: {
    status: "active", payments: [], stockDeducted: false, deliveryStatus: "pending", completedAt: null,
  } });
  expect(mockPosts).toBe(1);
  expect(await mockOrders.clearPendingOrderConfirmation(process.env.ORDER_JOURNEY_COMPANY!, id)).toMatchObject({ success: true });
  expect(await mockOrders.readPendingOrderConfirmation(process.env.ORDER_JOURNEY_COMPANY!)).toEqual(ok(null));
});
