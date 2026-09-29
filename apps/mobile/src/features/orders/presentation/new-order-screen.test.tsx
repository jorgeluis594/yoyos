import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ok } from "@shared/functional";
import NewOrderScreen from "@mobile/features/orders/presentation/new-order-screen";

const mockId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mockReplace = jest.fn();
const mockCompleteOrder = jest.fn();
const mockSetDirty = jest.fn();
const mockShow = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), replace: mockReplace }),
  useNavigation: () => ({ dispatch: jest.fn() }) }));
jest.mock("expo-router/react-navigation", () => ({ usePreventRemove: jest.fn() }));
jest.mock("expo-crypto", () => ({ randomUUID: () => mockId(3) }));
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
  getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }) }));
jest.mock("@mobile/composition/orders", () => ({ orders: {
  readPendingOrderConfirmation: async () => ({ success: true, data: null }),
  searchOrderCatalog: async () => ({ success: true, data: [{ id: mockId(4), name: "Camisa", currency: "PEN",
    variants: [{ id: mockId(2), attributes: { Talla: "M" }, sku: "CAM-M", price: 10, stock: 3 }] }] }),
  searchOrderContacts: async () => ({ success: true, data: [] }),
  completeOrder: (...args: unknown[]) => mockCompleteOrder(...args),
} }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: {
  status: "ready", company: { id: mockId(1), name: "Mi tienda", country: "PE" }, user: { id: "seller" },
} }) }));
jest.mock("@mobile/features/orders/presentation/order-draft-guard", () => ({ useOrderDraft: () => ({
  dirty: false, setDirty: mockSetDirty, discardVersion: 0,
}) }));
jest.mock("@mobile/features/orders/presentation/order-result", () => ({ useOrderResult: () => ({ show: mockShow }) }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));

beforeEach(() => { jest.clearAllMocks(); });

test("seller selects a variant, reviews the amount, and opens the completed sale", async () => {
  mockCompleteOrder.mockResolvedValue(ok({ kind: "completed", shownTotal: { amount: 10, currency: "PEN" },
    order: { id: mockId(3), total: 12 } }));
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Camisa");
  fireEvent.press(screen.getByRole("button", { name: /Camisa/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  fireEvent.press(screen.getByRole("button", { name: "Revisar venta" }));
  expect(screen.getAllByText(/10[.,]00/).length).toBeGreaterThan(0);
  fireEvent.press(screen.getByRole("button", { name: "Confirmar cobro y entrega" }));
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledWith(expect.objectContaining({ id: mockId(3) }), mockId(1)));
  expect(mockShow).toHaveBeenCalledWith({ id: mockId(3), shownTotal: { amount: 10, currency: "PEN" } });
  expect(mockReplace).toHaveBeenCalledWith(`/orders/${mockId(3)}`);
});
