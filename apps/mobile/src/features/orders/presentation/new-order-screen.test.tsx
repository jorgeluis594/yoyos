import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import NewOrderScreen from "@mobile/features/orders/presentation/new-order-screen";
import i18n from "@mobile/i18n";

const mockId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mockReplace = jest.fn();
const mockCompleteOrder = jest.fn();
const mockReadPending = jest.fn();
const mockResolvePending = jest.fn();
const mockResendPending = jest.fn();
let mockDirty = false;
let mockCountry = "PE";
let mockNextId = 3;
let mockDiscardVersion = 0;
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
jest.mock("expo-crypto", () => ({ randomUUID: () => mockId(mockNextId++) }));
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isConnected: !mockOffline, isInternetReachable: !mockOffline }),
  getNetworkStateAsync: async () => ({ isConnected: !mockOffline, isInternetReachable: !mockOffline }) }));
jest.mock("@mobile/features/orders/composition", () => ({ orders: {
  readPendingOrderConfirmation: (...args: unknown[]) => mockReadPending(...args),
  resendPendingOrder: (...args: unknown[]) => mockResendPending(...args),
  resolvePendingOrderConfirmation: (...args: unknown[]) => mockResolvePending(...args),
  searchOrderCatalog: async () => ({ success: true, data: [{ id: mockId(4), name: "Camisa", currency: "PEN",
    variants: [{ id: mockId(2), attributes: { Talla: "M" }, sku: "CAM-M", price: 10, stock: 3 }] }] }),
  searchOrderContacts: async () => ({ success: true, data: [] }),
  completeOrder: (...args: unknown[]) => mockCompleteOrder(...args),
} }));
jest.mock("@mobile/features/delivery-settings/composition", () => ({ deliverySettings: { get: async () => ({ success: true,
  data: { version: 1, home: { enabled: true }, store: { enabled: false, pickupPoint: null }, agency: { enabled: false }, couriers: [] } }) } }));
jest.mock("@expo/ui", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const Picker = ({ onValueChange, children, testID }: { onValueChange: (value: number) => void; children: React.ReactNode; testID?: string }) => <View testID={testID} accessible accessibilityRole="adjustable" {...{ onValueChange }}>{children}</View>;
  Picker.Item = function PickerItem() { return null; };
  return { Host: View, Picker };
});
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: {
  status: "ready", company: { id: mockId(1), name: "Mi tienda", country: mockCountry }, user: { id: "seller" },
} }) }));
jest.mock("@mobile/features/orders/presentation/order-draft-guard", () => ({ useOrderDraft: () => ({
  dirty: mockDirty, setDirty: mockSetDirty, discardVersion: mockDiscardVersion,
}) }));
jest.mock("@mobile/features/orders/presentation/order-result", () => ({ useOrderResult: () => ({ show: mockShow }) }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));

beforeEach(() => { jest.clearAllMocks(); mockNextId = 3; mockCountry = "PE"; mockDirty = false; mockDiscardVersion = 0; mockOffline = false; mockReadPending.mockResolvedValue(ok(null)); });

test("Chile seller selects a variant, reviews the amount, and opens the completed sale", async () => {
  mockCountry = "CL";
  mockCompleteOrder.mockResolvedValue(ok({ kind: "completed", shownTotal: { amount: 10, currency: "PEN" },
    order: { id: mockId(3), total: 12 } }));
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Camisa");
  fireEvent.press(screen.getByRole("button", { name: /Camisa/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  fireEvent.press(screen.getByRole("button", { name: "Revisar venta" }));
  expect(screen.getAllByText(/10[.,]00/).length).toBeGreaterThan(0);
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledWith(expect.objectContaining({ id: mockId(3) }), mockId(1)));
  expect(mockShow).toHaveBeenCalledWith({ id: mockId(3), shownTotal: { amount: 10, currency: "PEN" } });
  expect(mockReplace).toHaveBeenCalledWith(`/orders/${mockId(3)}`);
});

test("known stock rejection after uncertain resend returns to the editable cart", async () => {
  const pending = { version: 2, companyId: mockId(1), id: mockId(3), shownTotal: { amount: 10, currency: "PEN" }, request: { id: mockId(3), contactId: null, items: [{ variantId: mockId(2), quantity: 1 }] } };
  mockCompleteOrder.mockResolvedValueOnce(ok({ kind: "uncertain", pending }));
  mockResendPending.mockResolvedValueOnce(err({
    code: "INSUFFICIENT_STOCK", message: "No stock", issues: [{ field: "items", reason: "STOCK", variantId: mockId(2) }],
  }));
  mockResolvePending.mockResolvedValue(ok({ kind: "uncertain", pending }));
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Camisa");
  fireEvent.press(screen.getByRole("button", { name: /Camisa/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  fireEvent.press(screen.getByRole("button", { name: "Revisar venta" }));
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await screen.findByText("Venta pendiente de confirmar");
  fireEvent.press(screen.getByRole("button", { name: "Verificar venta" }));
  await waitFor(() => expect(mockResolvePending).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByRole("button", { name: "Verificar venta" }));
  await screen.findByRole("button", { name: "Reenviar mismo intento" });
  fireEvent.press(screen.getByRole("button", { name: "Reenviar mismo intento" }));
  await waitFor(() => expect(mockResendPending).toHaveBeenCalledTimes(1));
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

test("tab discard rearms draft protection for a new selection on the mounted screen", async () => {
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Camisa");
  fireEvent.press(screen.getByRole("button", { name: /Camisa/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  expect(mockDirty).toBe(true);

  mockDirty = false;
  mockDiscardVersion += 1;
  screen.rerender(<NewOrderScreen />);
  expect(screen.getByRole("button", { name: "Revisar venta" })).toBeDisabled();
  expect(mockDirty).toBe(false);

  fireEvent.press(screen.getByRole("button", { name: /Camisa/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  expect(mockDirty).toBe(true);
  screen.rerender(<NewOrderScreen />);
  expect(mockUsePreventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));
  mockUsePreventRemove.mock.lastCall?.[1]({ data: { action: { type: "GO_BACK" } } });
  expect(mockShowConfirmation).toHaveBeenCalledWith(expect.objectContaining({ title: "¿Descartar venta?" }));
  expect(mockDispatch).not.toHaveBeenCalled();
});

test("offline selection remains editable without a confirm action", async () => {
  mockOffline = true;
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Camisa");
  fireEvent.press(screen.getByRole("button", { name: /Camisa/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  fireEvent.press(screen.getByRole("button", { name: "Revisar venta" }));
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Editar productos" })).toBeTruthy();
  expect(mockCompleteOrder).not.toHaveBeenCalled();
});

test('new sale translates selection and review actions to Portuguese', async () => {
  await i18n.changeLanguage('pt-BR');
  try {
    const screen = render(<NewOrderScreen />);
    await screen.findByText('Camisa');
    fireEvent.press(screen.getByRole('button', { name: /Camisa/ }));
    fireEvent.press(screen.getByRole('button', { name: 'Adicionar' }));
    fireEvent.press(screen.getByRole('button', { name: 'Revisar venda' }));
    expect(screen.getByRole('button', { name: 'Salvar pedido' })).toBeTruthy();
    screen.unmount();
  } finally {
    await i18n.changeLanguage('es');
  }
});

test("one save retains editable payments and delivery on rejection and prevents double taps", async () => {
  mockCompleteOrder.mockResolvedValue(err({ code: "DELIVERY_UNAVAILABLE", message: "Unavailable" }));
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Camisa");
  fireEvent.press(screen.getByRole("button", { name: /Camisa/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  fireEvent.press(screen.getByRole("button", { name: "Revisar venta" }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar pago" }));
  fireEvent.changeText(screen.getByLabelText(/Importe recibido/), "5");
  fireEvent.press(screen.getByRole("button", { name: "Agregar pago" }));
  fireEvent.changeText(screen.getAllByLabelText(/Importe recibido/)[1], "8");
  fireEvent(screen.getByLabelText("Configurar datos de entrega"), "valueChange", true);
  fireEvent.changeText(screen.getByLabelText(/Dirección de entrega/), "Av. Lima 123");
  fireEvent.changeText(screen.getByLabelText(/Distrito/), "Lima");
  fireEvent.changeText(screen.getByLabelText(/Nombre del destinatario/), "Ana");
  fireEvent.changeText(screen.getByLabelText(/Teléfono del destinatario/), "999001");
  fireEvent(screen.getByLabelText("Marcar como entregado al guardar"), "valueChange", true);
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeEnabled());
  expect(mockCompleteOrder.mock.calls[0][0]).toMatchObject({ id: mockId(3), payments: [
    { paymentId: mockId(4), amount: "5" }, { paymentId: mockId(5), amount: "8" }],
    delivery: { address: "Av. Lima 123", district: "Lima", name: "Ana", phone: "999001" }, deliverImmediately: true });
  expect(screen.getByLabelText(/Dirección de entrega/)).toHaveProp("value", "Av. Lima 123");
  expect(screen.getAllByLabelText(/Importe recibido/)[1]).toHaveProp("value", "8");
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledTimes(2));
  expect(mockCompleteOrder.mock.calls[1][0]).toEqual(mockCompleteOrder.mock.calls[0][0]);
});

test("restart verifies and resends a saved request without rebuilding another order", async () => {
  const pending = { version: 2, companyId: mockId(1), id: mockId(3), shownTotal: { amount: 10, currency: "PEN" },
    request: { id: mockId(3), contactId: null, items: [{ variantId: mockId(2), quantity: 1 }], payments: [] } };
  mockReadPending.mockResolvedValue(ok(pending));
  mockResolvePending.mockResolvedValue(ok({ kind: "uncertain", pending }));
  mockResendPending.mockResolvedValue(ok({ kind: "completed", shownTotal: pending.shownTotal, order: { id: pending.id, status: "active" } }));
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Venta pendiente de confirmar");
  expect(screen.queryByRole("button", { name: "Guardar pedido" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Verificar venta" }));
  await waitFor(() => expect(mockResolvePending).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByRole("button", { name: "Verificar venta" }));
  fireEvent.press(await screen.findByRole("button", { name: "Reenviar mismo intento" }));
  await waitFor(() => expect(mockResendPending).toHaveBeenCalledWith(mockId(1)));
  expect(mockReplace).toHaveBeenCalledWith(`/orders/${mockId(3)}`);
  expect(mockCompleteOrder).not.toHaveBeenCalled();
});
