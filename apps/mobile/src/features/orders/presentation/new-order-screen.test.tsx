import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import NewOrderScreen from "@mobile/features/orders/presentation/new-order-screen";
import { getPeruDistrict, getPeruProvinces, peruDepartments } from "@shared/peru-geography";
import type { DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import i18n from "@mobile/i18n";

const mockId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mockReplace = jest.fn();
const mockCompleteOrder = jest.fn();
const mockQuotation = jest.fn();
const mockSettingsGet = jest.fn();
const mockReadPending = jest.fn();
const mockResolvePending = jest.fn();
const mockResendPending = jest.fn();
const mockReviewPending = jest.fn();
const mockLoadReview = jest.fn();
const mockReviewOrder = jest.fn();
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
  reviewLegacyPendingDelivery: (...args: unknown[]) => mockReviewPending(...args),
  loadPendingOrderReview: (...args: unknown[]) => mockLoadReview(...args),
  reviewPendingOrder: (...args: unknown[]) => mockReviewOrder(...args),
  resolvePendingOrderConfirmation: (...args: unknown[]) => mockResolvePending(...args),
  searchOrderCatalog: async () => ({ success: true, data: [{ id: mockId(4), name: "Camisa", currency: "PEN",
    variants: [{ id: mockId(2), attributes: { Talla: "M" }, sku: "CAM-M", price: 10, stock: 3 }] }] }),
  searchOrderContacts: async () => ({ success: true, data: [] }),
  completeOrder: (...args: unknown[]) => mockCompleteOrder(...args),
} }));
jest.mock("@mobile/features/delivery-settings/composition", () => ({ deliverySettings: {
  get: (...args: unknown[]) => mockSettingsGet(...args), createQuotation: (...args: unknown[]) => mockQuotation(...args),
} }));
jest.mock("@expo/ui/community/menu", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return { MenuView: ({ children, onPressAction }: { children: React.ReactNode; onPressAction: (event: { nativeEvent: { event: string } }) => void }) =>
    <View {...{ onValueChange: (index: number) => onPressAction({ nativeEvent: { event: String(index) } }) }}>{children}</View> };
});
jest.mock("@expo/ui", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const Picker = ({ onValueChange, children, testID, selectedValue }: { onValueChange: (value: number) => void; children: React.ReactNode; testID?: string; selectedValue: number }) => <View testID={testID} accessible accessibilityRole="adjustable" {...{ onValueChange, selectedValue }}>{children}</View>;
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
jest.mock("react-native-screens/experimental", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));

const firstRate = { id: mockId(30), method: "home" as const, price: { amount: 8, currency: "PEN" as const } };
const secondRate = { ...firstRate, id: mockId(31), price: { amount: 12, currency: "PEN" as const } };
const freeAgency = { ...firstRate, id: mockId(32), method: "agency" as const, price: { amount: 0, currency: "PEN" as const } };
const quotation = { id: mockId(33), districtCode: "150122", rates: [firstRate, secondRate, freeAgency] };
const allMethods: DeliverySettingsResponse = { version: 1, home: { enabled: true }, agency: { enabled: true }, couriers: [],
  store: { enabled: true, pickupPoint: { name: "Pickup", address: "Current pickup", instructions: null } } };
function selectDistrict(screen: ReturnType<typeof render>, code = "150122") {
  const district = getPeruDistrict(code)!;
  fireEvent(screen.getByTestId("delivery-department"), "valueChange", peruDepartments.findIndex(value => value.code === district.departmentCode));
  fireEvent(screen.getByTestId("delivery-province"), "valueChange", getPeruProvinces(district.departmentCode).findIndex(value => value.code === district.provinceCode));
  fireEvent.changeText(screen.getByLabelText("Buscar distrito"), code);
  fireEvent(screen.getByTestId("delivery-district"), "valueChange", 0);
}
async function review() {
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Camisa");
  fireEvent.press(screen.getByRole("button", { name: /Camisa/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  return screen;
}

test("review preserves payment and shows one save action", async () => {
  mockCompleteOrder.mockResolvedValue(ok({ kind: "completed", shownTotal: { amount: 10, currency: "PEN" },
    order: { id: mockId(3) } }));
  const screen = await review();
  expect(screen.getByText("Productos (referencial)")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Resumen de productos" })).toHaveProp("accessibilityState", { expanded: false });
  fireEvent.press(screen.getByRole("button", { name: "Agregar pago" }));
  fireEvent.changeText(screen.getByLabelText(/Monto/), "5");
  expect(screen.getByLabelText(/Monto/)).toHaveProp("value", "5");
  expect(screen.getAllByRole("button", { name: "Guardar pedido" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeEnabled();
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledTimes(1));
  expect(mockCompleteOrder).toHaveBeenCalledWith(expect.objectContaining({
    payments: [expect.objectContaining({ amount: "5" })],
  }), mockId(1));
});

test("products stay read-only on the form and returning preserves entered data", async () => {
  const screen = await review();
  expect(screen.queryByRole("button", { name: "+" })).toBeNull();
  expect(screen.getByRole("button", { name: "Resumen de productos" })).toHaveProp("accessibilityState", { expanded: false });
  fireEvent.press(screen.getByRole("button", { name: "Resumen de productos" }));
  expect(screen.getByText(/Talla: M/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Quitar" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Agregar pago" }));
  fireEvent.changeText(screen.getByLabelText(/Monto/), "10");
  fireEvent.press(screen.getByRole("button", { name: "Datos de envío" }));
  expect(screen.getByTestId("delivery-status")).toHaveProp("selectedValue", 0);
  fireEvent(screen.getByTestId("delivery-status"), "valueChange", 1);
  fireEvent.changeText(screen.getByLabelText(/Dirección de entrega/), "Calle 1");
  fireEvent.press(screen.getByRole("button", { name: "Editar productos" }));
  expect(screen.getByRole("button", { name: "+" })).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  expect(screen.getByLabelText(/Monto/)).toHaveProp("value", "10");
  expect(screen.getByLabelText(/Dirección de entrega/)).toHaveProp("value", "Calle 1");
  expect(screen.getByTestId("delivery-status")).toHaveProp("selectedValue", 1);
});

test("delivered status explains missing payment and allows saving once covered", async () => {
  const screen = await review();
  fireEvent(screen.getByTestId("delivery-status"), "valueChange", 1);
  expect(screen.getByText(/Completa el pago/)).toHaveProp("accessibilityRole", "alert");
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
  fireEvent.press(screen.getByRole("button", { name: "Agregar pago" }));
  fireEvent.changeText(screen.getByLabelText(/Monto/), "10");
  expect(screen.queryByText(/Completa el pago/)).toBeNull();
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeEnabled();
});
beforeEach(() => { jest.clearAllMocks(); mockQuotation.mockReset(); mockSettingsGet.mockReset();
  mockQuotation.mockResolvedValue(ok(quotation));
  mockSettingsGet.mockResolvedValue(ok({ version: 1, home: { enabled: true }, store: { enabled: false, pickupPoint: null }, agency: { enabled: false }, couriers: [] })); mockNextId = 3; mockCountry = "PE"; mockDirty = false; mockDiscardVersion = 0; mockOffline = false; mockReadPending.mockResolvedValue(ok(null)); });

test("Chile seller selects a variant, reviews the amount, and opens the completed sale", async () => {
  mockCountry = "CL";
  mockCompleteOrder.mockResolvedValue(ok({ kind: "completed", shownTotal: { amount: 10, currency: "PEN" },
    order: { id: mockId(3), total: 12 } }));
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Camisa");
  fireEvent.press(screen.getByRole("button", { name: /Camisa/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
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
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await screen.findByText("Venta pendiente de confirmar");
  fireEvent.press(screen.getByRole("button", { name: "Verificar venta" }));
  await waitFor(() => expect(mockResolvePending).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole("button", { name: "Verificar venta" })).toBeEnabled());
  fireEvent.press(screen.getByRole("button", { name: "Verificar venta" }));
  await screen.findByRole("button", { name: "Reenviar mismo intento" });
  fireEvent.press(screen.getByRole("button", { name: "Reenviar mismo intento" }));
  await waitFor(() => expect(mockResendPending).toHaveBeenCalledTimes(1));
  await screen.findByText("Ya no hay stock suficiente. Corrige la cantidad y vuelve a confirmar.");
  expect(screen.getByRole("button", { name: "Editar productos" })).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Editar productos" }));
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
  expect(reopened.getByRole("button", { name: "Continuar" })).toBeDisabled();
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
  expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
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
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
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
    fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByRole('button', { name: 'Salvar pedido' })).toBeTruthy();
    expect(screen.getByText('Produtos (estimativa)')).toBeTruthy();
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
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar pago" }));
  fireEvent.changeText(screen.getByLabelText(/Monto/), "5");
  fireEvent.press(screen.getByRole("button", { name: "Agregar pago" }));
  fireEvent.changeText(screen.getAllByLabelText(/Monto/)[1], "13");
  fireEvent.press(screen.getByRole("button", { name: "Datos de envío" }));
  fireEvent.changeText(screen.getByLabelText(/Dirección de entrega/), "Av. Lima 123");
  selectDistrict(screen);
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 0);
  fireEvent.changeText(screen.getByLabelText(/Nombre del destinatario/), "Ana");
  fireEvent.changeText(screen.getByLabelText(/Teléfono del destinatario/), "999001");
  fireEvent(screen.getByTestId("delivery-status"), "valueChange", 1);
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeEnabled());
  expect(mockCompleteOrder.mock.calls[0][0]).toMatchObject({ id: mockId(3), payments: [
    { paymentId: mockId(4), amount: "5" }, { paymentId: mockId(5), amount: "13" }],
    ratedDelivery: { expectedPrice: firstRate.price, delivery: { method: "home", rateId: firstRate.id,
      destination: { address: "Av. Lima 123", districtCode: "150122" }, recipient: { name: "Ana", phone: "999001" } } }, deliverImmediately: true });
  expect(screen.getByLabelText(/Dirección de entrega/)).toHaveProp("value", "Av. Lima 123");
  expect(screen.getAllByLabelText(/Monto/)[1]).toHaveProp("value", "13");
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledTimes(2));
  expect(mockCompleteOrder.mock.calls[1][0]).toEqual(mockCompleteOrder.mock.calls[0][0]);
});

test("decimal comma in an initial payment updates the summary and allows saving", async () => {
  mockCompleteOrder.mockResolvedValue(err({ code: "INVALID_ORDER", message: "Rejected" }));
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Camisa");
  fireEvent.press(screen.getByRole("button", { name: /Camisa/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar pago" }));
  fireEvent.changeText(screen.getByLabelText(/Monto/), "5,50");
  expect(screen.getByText(/5[.,]50/)).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText(/Monto/), "1e309");
  expect(screen.queryByText(/5[.,]50/)).toBeNull();
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
  fireEvent.changeText(screen.getByLabelText(/Monto/), "5,50");
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeEnabled();
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledWith(expect.objectContaining({
    payments: [expect.objectContaining({ amount: "5.50" })],
  }), mockId(1)));
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
  await waitFor(() => expect(screen.getByRole("button", { name: "Verificar venta" })).toBeEnabled());
  fireEvent.press(screen.getByRole("button", { name: "Verificar venta" }));
  fireEvent.press(await screen.findByRole("button", { name: "Reenviar mismo intento" }));
  await waitFor(() => expect(mockResendPending).toHaveBeenCalledWith(mockId(1)));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/orders/${mockId(3)}`));
  expect(mockCompleteOrder).not.toHaveBeenCalled();
});

test("legacy recovery reviews an explicit rate while retaining recipient and original payment identities", async () => {
  const pending = { version: 2, companyId: mockId(1), id: mockId(3), shownTotal: { amount: 10, currency: "PEN" },
    request: { id: mockId(3), contactId: null, items: [{ variantId: mockId(2), quantity: 1 }],
      payments: [{ paymentId: mockId(8), amount: { amount: 4.5, currency: "PEN" }, method: "bank_transfer", deductStockIfPartial: false }],
      delivery: { chargeDeliveryToCustomer: false, delivery: { method: "home", recipient: { name: "Ana", phone: "999001", identity: { kind: "absent" } },
        destination: { address: "Original street", district: "Miraflores", instructions: "Door 2" } } } } };
  mockReadPending.mockResolvedValue(ok(pending));
  const screen = render(<NewOrderScreen />);
  fireEvent.press(await screen.findByRole("button", { name: "Revisar entrega guardada" }));
  await screen.findByLabelText(/Dirección de entrega/);
  expect(screen.getByLabelText(/Dirección de entrega/)).toHaveProp("value", "Original street");
  expect(screen.getByLabelText(/Nombre del destinatario/)).toHaveProp("value", "Ana");
  expect(screen.getByText(/4[.,]50/)).toBeTruthy();
  expect(mockQuotation).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Guardar entrega revisada" })).toBeDisabled();
  selectDistrict(screen);
  await screen.findByTestId("delivery-rate");
  expect(screen.getByRole("button", { name: "Guardar entrega revisada" })).toBeDisabled();
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 1);
  expect(screen.getByText(/Total:\sS\/\s22\.00/)).toBeTruthy();
  const delivery = { expectedPrice: secondRate.price, delivery: { method: "home", rateId: secondRate.id,
    recipient: pending.request.delivery.delivery.recipient, destination: { districtCode: "150122", address: "Original street", instructions: "Door 2" } } };
  const revised = { ...pending, shownTotal: { amount: 22, currency: "PEN" }, request: { ...pending.request, delivery } };
  mockReviewPending.mockResolvedValueOnce(err({ code: "PENDING_STORAGE_UNAVAILABLE", message: "Cannot save" }));
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar entrega revisada" })); });
  await waitFor(() => expect(mockReviewPending).toHaveBeenCalledWith(mockId(1), delivery));
  await screen.findByText("No se pudo guardar la confirmación pendiente. Reintenta sin salir.");
  await waitFor(() => expect(screen.getByRole("button", { name: "Guardar entrega revisada" })).toBeEnabled());
  expect(screen.getByLabelText(/Dirección de entrega/)).toHaveProp("value", "Original street");
  mockReviewPending.mockResolvedValueOnce(ok({ kind: "uncertain", pending: revised }));
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar entrega revisada" })); });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Guardar entrega revisada" })).toBeNull());
  expect(mockCompleteOrder).not.toHaveBeenCalled();
  expect(mockResendPending).not.toHaveBeenCalled();
  mockResolvePending.mockResolvedValue(ok({ kind: "uncertain", pending: revised }));
  for (let index = 0; index < 2; index++) {
    fireEvent.press(screen.getByRole("button", { name: "Verificar venta" }));
    await waitFor(() => expect(mockResolvePending).toHaveBeenCalledTimes(index + 1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Verificar venta" })).toBeEnabled());
  }
  expect(screen.getByRole("button", { name: "Reenviar mismo intento" })).toBeEnabled();
  expect(mockQuotation).toHaveBeenCalledTimes(1);
});

test("new order selects one overlapping home rate and reviews the full charge without manual pricing", async () => {
  mockCompleteOrder.mockResolvedValue(ok({ kind: "completed", shownTotal: { amount: 22, currency: "PEN" }, order: { id: mockId(3) } }));
  const screen = await review();
  fireEvent.press(screen.getByRole("button", { name: "Datos de envío" }));
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
  selectDistrict(screen);
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 1);
  expect(screen.getAllByText(/S\/\s10\.00/).length).toBeGreaterThan(0);
  expect(screen.getByText(/S\/\s12\.00/)).toBeTruthy();
  expect(screen.getAllByText(/S\/\s22\.00/).length).toBeGreaterThan(0);
  expect(screen.getByText("Saldo referencial")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
  fireEvent.changeText(screen.getByLabelText(/Dirección de entrega/), "Calle nueva");
  fireEvent.changeText(screen.getByLabelText(/Nombre del destinatario/), "Recipient");
  fireEvent.changeText(screen.getByLabelText(/Teléfono del destinatario/), "999001");
  fireEvent.press(screen.getByRole("button", { name: "Editar productos" }));
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  expect(screen.getByLabelText(/Dirección de entrega/)).toHaveProp("value", "Calle nueva");
  expect(mockQuotation).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText("Cobrar el costo de entrega al cliente")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalled());
  expect(mockCompleteOrder).toHaveBeenCalledWith(expect.objectContaining({ ratedDelivery: {
    expectedPrice: secondRate.price, delivery: { method: "home", rateId: secondRate.id,
      recipient: { name: "Recipient", phone: "999001", identity: { kind: "absent" } },
      destination: { districtCode: "150122", address: "Calle nueva", instructions: null } },
  } }), mockId(1));
});

test("price conflict preserves creation fields and requires explicit selection of refreshed rates", async () => {
  mockCompleteOrder.mockResolvedValue(err({ code: "TOTAL_CHANGED", message: "Private", currentPrice: { amount: 10, currency: "PEN" } }));
  const screen = await review();
  fireEvent.press(screen.getByRole("button", { name: "Datos de envío" }));
  fireEvent.changeText(screen.getByLabelText(/Dirección de entrega/), "Preserved street");
  fireEvent.changeText(screen.getByLabelText(/Nombre del destinatario/), "Ana");
  fireEvent.changeText(screen.getByLabelText(/Teléfono del destinatario/), "999001");
  selectDistrict(screen);
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 0);
  let finishSettings: ((result: ReturnType<typeof ok<DeliverySettingsResponse>>) => void) | undefined;
  mockSettingsGet.mockImplementationOnce(() => new Promise(resolve => { finishSettings = resolve; }));
  mockQuotation.mockResolvedValue(ok({ ...quotation, rates: [{ ...firstRate, id: mockId(35), price: { amount: 10, currency: "PEN" } }] }));
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await screen.findByText(/La tarifa cambió/);
  expect(screen.queryByTestId("delivery-rate")).toBeNull();
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
  await act(async () => { finishSettings?.(ok({ ...allMethods, store: { enabled: false, pickupPoint: null }, version: 2 })); });
  await waitFor(() => expect(mockQuotation).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
  expect(screen.getByLabelText(/Dirección de entrega/)).toHaveProp("value", "Preserved street");
  expect(screen.getByLabelText(/Nombre del destinatario/)).toHaveProp("value", "Ana");
  expect(screen.queryByText("Private")).toBeNull();
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 0);
  expect(screen.getAllByText(/S\/\s20\.00/).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeEnabled();
});

test("agency creation uses an explicit zero rate and requires identity without operational fields", async () => {
  mockSettingsGet.mockResolvedValue(ok(allMethods));
  mockCompleteOrder.mockResolvedValue(err({ code: "INVALID_ORDER", message: "Rejected" }));
  const screen = await review();
  fireEvent.press(screen.getByRole("button", { name: "Datos de envío" }));
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 2);
  selectDistrict(screen);
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 0);
  fireEvent.changeText(screen.getByLabelText(/Nombre del destinatario/), "Ana");
  fireEvent.changeText(screen.getByLabelText(/Teléfono del destinatario/), "999001");
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
  expect(screen.queryByTestId("delivery-courier")).toBeNull();
  expect(screen.queryByLabelText("Agencia de destino *")).toBeNull();
  fireEvent(screen.getByTestId("delivery-document-type"), "valueChange", 0);
  fireEvent.changeText(screen.getByLabelText(/Número de documento/), "00123456");
  expect(screen.getAllByText(/S\/\s10\.00/).length).toBeGreaterThan(0);
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledWith(expect.objectContaining({ ratedDelivery: {
    expectedPrice: freeAgency.price, delivery: { method: "agency", rateId: freeAgency.id, districtCode: "150122",
      recipient: { name: "Ana", phone: "999001", identity: { kind: "document", documentType: "national_id", document: "00123456" } },
    },
  } }), mockId(1)));
});

test("quotation failure and empty coverage block creation while pickup remains explicitly free", async () => {
  mockSettingsGet.mockResolvedValue(ok(allMethods));
  mockQuotation.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "Offline" })).mockResolvedValue(ok({ ...quotation, rates: [] }));
  mockCompleteOrder.mockResolvedValue(err({ code: "INVALID_ORDER", message: "Rejected" }));
  const screen = await review();
  fireEvent.press(screen.getByRole("button", { name: "Datos de envío" }));
  fireEvent.changeText(screen.getByLabelText(/Nombre del destinatario/), "Ana");
  fireEvent.changeText(screen.getByLabelText(/Teléfono del destinatario/), "999001");
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 1);
  fireEvent.changeText(screen.getByLabelText(/Dirección de entrega/), "Keep street");
  selectDistrict(screen);
  await screen.findByText(/No se pudieron consultar las tarifas/);
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
  fireEvent.press(screen.getByRole("button", { name: "Consultar tarifas nuevamente" }));
  await screen.findByText(/No hay cobertura/);
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
  expect(screen.queryByText("Total")).toBeNull();
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 0);
  expect(screen.getByText("Current pickup")).toBeTruthy();
  expect(screen.getAllByText(/S\/\s0\.00/).length).toBeGreaterThan(0);
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledWith(expect.objectContaining({ ratedDelivery: {
    expectedPrice: { amount: 0, currency: "PEN" }, delivery: { method: "store", recipient: { name: "Ana", phone: "999001", identity: { kind: "absent" } } },
  } }), mockId(1)));
  expect(mockQuotation).toHaveBeenCalledTimes(2);
});

test("late destination quotations cannot restore another district or a shipping charge after pickup", async () => {
  mockSettingsGet.mockResolvedValue(ok(allMethods));
  let finish: ((result: ReturnType<typeof ok<typeof quotation>>) => void) | undefined;
  mockQuotation.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(ok({ ...quotation, districtCode: "040110", rates: [secondRate] }));
  const screen = await review();
  fireEvent.press(screen.getByRole("button", { name: "Datos de envío" }));
  fireEvent.changeText(screen.getByLabelText(/Nombre del destinatario/), "Ana");
  fireEvent.changeText(screen.getByLabelText(/Teléfono del destinatario/), "999001");
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 1);
  fireEvent.changeText(screen.getByLabelText(/Dirección de entrega/), "Street");
  selectDistrict(screen);
  await waitFor(() => expect(mockQuotation).toHaveBeenCalledTimes(1));
  selectDistrict(screen, "040110");
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 0);
  expect(screen.getAllByText(/S\/\s22\.00/).length).toBeGreaterThan(0);
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 0);
  await act(async () => { finish?.(ok(quotation)); });
  expect(screen.queryByTestId("delivery-rate")).toBeNull();
  expect(screen.getAllByText(/S\/\s10\.00/).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeEnabled();
});

test("reselecting the same district generates new options and cannot revive an earlier selection", async () => {
  const screen = await review();
  fireEvent.press(screen.getByRole("button", { name: "Datos de envío" }));
  fireEvent.changeText(screen.getByLabelText(/Dirección de entrega/), "Street");
  fireEvent.changeText(screen.getByLabelText(/Nombre del destinatario/), "Ana");
  fireEvent.changeText(screen.getByLabelText(/Teléfono del destinatario/), "999001");
  selectDistrict(screen);
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 0);
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeEnabled();
  let finish: ((result: ReturnType<typeof ok<typeof quotation>>) => void) | undefined;
  mockQuotation.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  selectDistrict(screen);
  await waitFor(() => expect(mockQuotation).toHaveBeenCalledTimes(2));
  expect(screen.queryByTestId("delivery-rate")).toBeNull();
  expect(screen.queryByText("Total")).toBeNull();
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
  await act(async () => { finish?.(ok({ ...quotation, rates: [{ ...firstRate, id: mockId(39) }] })); });
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 0);
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeEnabled();
});

test("disabled delivery after a rejection preserves the form and can be explicitly removed", async () => {
  mockCompleteOrder.mockResolvedValue(err({ code: "DELIVERY_METHOD_DISABLED", message: "Disabled" }));
  const screen = await review();
  fireEvent.press(screen.getByRole("button", { name: "Datos de envío" }));
  fireEvent.changeText(screen.getByLabelText(/Dirección de entrega/), "Preserved street");
  fireEvent.changeText(screen.getByLabelText(/Nombre del destinatario/), "Ana");
  fireEvent.changeText(screen.getByLabelText(/Teléfono del destinatario/), "999001");
  selectDistrict(screen);
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 0);
  mockSettingsGet.mockResolvedValue(ok({ ...allMethods, version: 2, home: { enabled: false }, agency: { enabled: false }, store: { enabled: false, pickupPoint: null } }));
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled());
  await waitFor(() => expect(screen.queryByTestId("delivery-rate")).toBeNull());
  expect(screen.getByLabelText(/Dirección de entrega/)).toHaveProp("value", "Preserved street");
  fireEvent.press(screen.getByRole("button", { name: "Quitar datos de envío" }));
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeEnabled();
  expect(screen.queryByTestId("delivery-rate")).toBeNull();
});

test("a saved rated delivery can be reviewed without charging its old fee twice", async () => {
  const pending = { version: 2, companyId: mockId(1), id: mockId(3), shownTotal: { amount: 18, currency: "PEN" },
    request: { id: mockId(3), contactId: null, items: [{ variantId: mockId(2), quantity: 1 }],
      delivery: { expectedPrice: { amount: 8, currency: "PEN" }, delivery: { method: "home", rateId: mockId(9),
        recipient: { name: "Ana", phone: "999001", identity: { kind: "absent" } },
        destination: { address: "Original street", districtCode: "150122", instructions: null } } } } };
  mockReadPending.mockResolvedValue(ok(pending));
  mockResolvePending.mockResolvedValue(ok({ kind: "uncertain", pending }));
  const screen = render(<NewOrderScreen />);
  await screen.findByRole("button", { name: "Revisar entrega guardada" });
  fireEvent.press(screen.getByRole("button", { name: "Verificar venta" }));
  await waitFor(() => expect(mockResolvePending).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole("button", { name: "Verificar venta" })).toBeEnabled());
  fireEvent.press(screen.getByRole("button", { name: "Verificar venta" }));
  await screen.findByRole("button", { name: "Reenviar mismo intento" });
  fireEvent.press(screen.getByRole("button", { name: "Revisar entrega guardada" }));
  expect(screen.queryByRole("button", { name: "Reenviar mismo intento" })).toBeNull();
  await screen.findByLabelText(/Dirección de entrega/);
  expect(screen.getByLabelText(/Dirección de entrega/)).toHaveProp("value", "Original street");
  selectDistrict(screen);
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 1);
  expect(screen.getByText(/Total:\sS\/\s22\.00/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Guardar entrega revisada" })).toBeEnabled();
  expect(mockCompleteOrder).not.toHaveBeenCalled();
  expect(mockResendPending).not.toHaveBeenCalled();
});


test("restarted seller corrects missing references and payments before saving the same attempt", async () => {
  const pending = { version: 2, companyId: mockId(1), id: mockId(3), shownTotal: { amount: 30, currency: "PEN" },
    request: { id: mockId(3), contactId: mockId(7), items: [{ variantId: mockId(2), quantity: 2 }, { variantId: mockId(6), quantity: 1 }],
      payments: [{ paymentId: mockId(8), amount: { amount: 4.5, currency: "PEN" }, method: "bank_transfer", deductStockIfPartial: false }] } };
  const draft = { kind: "items", id: pending.id, customer: { kind: "contact", contactId: mockId(7), name: null, phone: "" },
    items: [{ variantId: mockId(2), quantity: 2, productName: "Camisa", variantAttributes: {}, sku: null,
      shownUnitPrice: { amount: 10, currency: "PEN" }, shownStock: 1 }],
    payments: [{ paymentId: mockId(8), amount: "4.5", method: "bank_transfer", deductStockIfPartial: false }] };
  mockReadPending.mockResolvedValue(ok(pending));
  mockLoadReview.mockResolvedValue(ok({ kind: "review", pending, draft, unavailableVariantIds: [mockId(6)], contactUnavailable: true }));
  const screen = render(<NewOrderScreen />);
  const reviewButton = await screen.findByRole("button", { name: "Corregir intento guardado" });
  await act(async () => { fireEvent.press(reviewButton); });
  expect(mockLoadReview).toHaveBeenCalledWith(mockId(1));
  expect(screen.getByText(/Revisa los productos no disponibles/)).toBeTruthy();
  expect(screen.getByText(/El cliente guardado ya no está disponible/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Guardar correcciones" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Reenviar mismo intento" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Editar productos" }));
  expect(screen.getByText(/El producto guardado 1 ya no está disponible/)).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Quitar producto no disponible 1" }));
  fireEvent.press(screen.getByRole("button", { name: "−" }));
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  expect(screen.getByRole("button", { name: "Guardar correcciones" })).toBeDisabled();
  fireEvent.press(screen.getByRole("button", { name: "Quitar contacto" }));
  fireEvent.changeText(screen.getByLabelText(/Monto/), "5.50");
  expect(screen.getByRole("button", { name: "Guardar correcciones" })).toBeEnabled();
  mockReviewOrder.mockResolvedValueOnce(err({ code: "PENDING_STORAGE_UNAVAILABLE", message: "Cannot save" }));
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar correcciones" })); });
  expect(screen.getByLabelText(/Monto/)).toHaveProp("value", "5.50");
  expect(mockReviewOrder).toHaveBeenLastCalledWith(mockId(1), expect.objectContaining({ id: pending.id,
    customer: { kind: "general_public" }, items: [expect.objectContaining({ variantId: mockId(2), quantity: 1 })],
    payments: [expect.objectContaining({ paymentId: mockId(8), amount: "5.50" })] }));
  mockReviewOrder.mockResolvedValueOnce(ok({ kind: "uncertain", pending }));
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar correcciones" })); });
  expect(screen.queryByRole("button", { name: "Guardar correcciones" })).toBeNull();
  expect(screen.getByRole("button", { name: "Verificar venta" })).toBeEnabled();
  expect(mockCompleteOrder).not.toHaveBeenCalled();
  expect(mockResendPending).not.toHaveBeenCalled();
});
