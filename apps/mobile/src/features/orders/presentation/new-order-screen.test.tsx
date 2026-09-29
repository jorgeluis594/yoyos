import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import NewOrderScreen from "@mobile/features/orders/presentation/new-order-screen";

const mockId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mockReplace = jest.fn();
const mockCompleteOrder = jest.fn();
const mockReadPending = jest.fn();
const mockResolvePending = jest.fn();
let mockDirty = false;
let mockOffline = false;
const mockSetDirty = jest.fn((value: boolean) => { mockDirty = value; });
const mockDispatch = jest.fn();
const mockUsePreventRemove = jest.fn();
const mockShowConfirmation = jest.fn();
const mockShow = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), replace: mockReplace }),
  useNavigation: () => ({ dispatch: mockDispatch }) }));
jest.mock("expo-router/react-navigation", () => ({ usePreventRemove: (...args: unknown[]) => mockUsePreventRemove(...args) }));
jest.mock("@mobile/components/ui/show-confirmation", () => ({ showConfirmation: (...args: unknown[]) => mockShowConfirmation(...args) }));
jest.mock("expo-crypto", () => ({ randomUUID: () => mockId(3) }));
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isConnected: !mockOffline, isInternetReachable: !mockOffline }),
  getNetworkStateAsync: async () => ({ isConnected: !mockOffline, isInternetReachable: !mockOffline }) }));
jest.mock("@mobile/composition/orders", () => ({ orders: {
  readPendingOrderConfirmation: (...args: unknown[]) => mockReadPending(...args),
  resolvePendingOrderConfirmation: (...args: unknown[]) => mockResolvePending(...args),
  searchOrderCatalog: async () => ({ success: true, data: [{ id: mockId(4), name: "Camisa", currency: "PEN",
    variants: [{ id: mockId(2), attributes: { Talla: "M" }, sku: "CAM-M", price: 10, stock: 3 }] }] }),
  searchOrderContacts: async () => ({ success: true, data: [] }),
  completeOrder: (...args: unknown[]) => mockCompleteOrder(...args),
} }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: {
  status: "ready", company: { id: mockId(1), name: "Mi tienda", country: "PE" }, user: { id: "seller" },
} }) }));
jest.mock("@mobile/features/orders/presentation/order-draft-guard", () => ({ useOrderDraft: () => ({
  dirty: mockDirty, setDirty: mockSetDirty, discardVersion: 0,
}) }));
jest.mock("@mobile/features/orders/presentation/order-result", () => ({ useOrderResult: () => ({ show: mockShow }) }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));

beforeEach(() => { jest.clearAllMocks(); mockDirty = false; mockOffline = false; mockReadPending.mockResolvedValue(ok(null)); });

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

test("known stock rejection after uncertain resend returns to the editable cart", async () => {
  const pending = { companyId: mockId(1), id: mockId(3), shownTotal: { amount: 10, currency: "PEN" } };
  mockCompleteOrder.mockResolvedValueOnce(ok({ kind: "uncertain", pending })).mockResolvedValueOnce(err({
    code: "INSUFFICIENT_STOCK", message: "No stock", issues: [{ field: "items", reason: "STOCK", variantId: mockId(2) }],
  }));
  mockResolvePending.mockResolvedValue(ok({ kind: "uncertain", pending }));
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Camisa");
  fireEvent.press(screen.getByRole("button", { name: /Camisa/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  fireEvent.press(screen.getByRole("button", { name: "Revisar venta" }));
  fireEvent.press(screen.getByRole("button", { name: "Confirmar cobro y entrega" }));
  await screen.findByText("Venta pendiente de confirmar");
  fireEvent.press(screen.getByRole("button", { name: "Verificar venta" }));
  await waitFor(() => expect(mockResolvePending).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByRole("button", { name: "Verificar venta" }));
  await screen.findByRole("button", { name: "Reenviar mismo intento" });
  fireEvent.press(screen.getByRole("button", { name: "Reenviar mismo intento" }));
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledTimes(2));
  await screen.findByText("Ya no hay stock suficiente. Corrige la cantidad y vuelve a confirmar.");
  expect(screen.getByRole("button", { name: "Editar productos" })).toBeTruthy();
  expect(screen.getByText("Revisa esta variante.")).toBeTruthy();
});

test("leaving with items asks to discard and reopening starts with an empty cart", async () => {
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Camisa");
  fireEvent.press(screen.getByRole("button", { name: /Camisa/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  expect(mockSetDirty).toHaveBeenLastCalledWith(true);
  screen.rerender(<NewOrderScreen />);
  expect(mockUsePreventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));
  const onLeave = mockUsePreventRemove.mock.lastCall?.[1];
  onLeave({ data: { action: { type: "GO_BACK" } } });
  expect(mockShowConfirmation).toHaveBeenCalledWith(expect.objectContaining({ title: "¿Descartar venta?" }));
  expect(mockDispatch).not.toHaveBeenCalled();
  mockShowConfirmation.mock.lastCall?.[0].onConfirm();
  expect(mockDispatch).toHaveBeenCalledWith({ type: "GO_BACK" });
  screen.unmount();
  mockDirty = false;
  const reopened = render(<NewOrderScreen />);
  await reopened.findByText("Camisa");
  expect(reopened.getByRole("button", { name: "Revisar venta" })).toBeDisabled();
});

test("offline selection remains editable without a confirm action", async () => {
  mockOffline = true;
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Camisa");
  fireEvent.press(screen.getByRole("button", { name: /Camisa/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  fireEvent.press(screen.getByRole("button", { name: "Revisar venta" }));
  expect(screen.getByRole("button", { name: "Confirmar cobro y entrega" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Editar productos" })).toBeTruthy();
  expect(mockCompleteOrder).not.toHaveBeenCalled();
});
