import { SymbolView } from "expo-symbols";
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
let mockPending: unknown = ok([]);
const mockRefreshPending = jest.fn(async () => {});
const mockSyncPending = jest.fn();
const mockDiscardPending = jest.fn();
const mockLoadReview = jest.fn();
const mockReviewOrder = jest.fn();
let mockDirty = false;
let mockCountry = "PE";
let mockNextId = 3;
let mockDiscardVersion = 0;
let mockOffline = false;
let mockStock = 3;
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
  discardPendingOrderConfirmation: (...args: unknown[]) => mockDiscardPending(...args),
  loadPendingOrderReview: (...args: unknown[]) => mockLoadReview(...args),
  reviewPendingOrder: (...args: unknown[]) => mockReviewOrder(...args),
  searchOrderCatalog: async () => ({ success: true, data: [{ id: mockId(4), name: "Camisa", currency: "PEN",
    variants: [{ id: mockId(2), attributes: { Talla: "M" }, sku: "CAM-M", price: 10, stock: mockStock }] }] }),
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
jest.mock("@expo/ui/community/datetime-picker", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return { DateTimePicker: ({ testID, onValueChange }: { testID?: string; onValueChange: (event: unknown, date: Date) => void }) =>
    <View testID={testID} {...{ onValueChange }} /> };
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
jest.mock("@mobile/features/orders/presentation/pending-order-sync-provider", () => ({ usePendingOrders: () => ({
  pending: mockPending, refresh: mockRefreshPending, trigger: mockSyncPending }) }));
jest.mock("@mobile/features/orders/presentation/order-result", () => ({ useOrderResult: () => ({ show: mockShow }) }));
jest.mock("react-native-screens/experimental", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));

const firstRate = { id: mockId(30), method: "home" as const, name: "Standard", zoneName: "Lima", price: { amount: 8, currency: "PEN" as const } };
const secondRate = { ...firstRate, id: mockId(31), price: { amount: 12, currency: "PEN" as const } };
const branch = { id: mockId(40), name: "Branch", address: "Av. Test 123", courier: { id: mockId(41), name: "Shalom" },
  location: { country: "PE" as const, districtCode: "150122", district: "MIRAFLORES", province: "LIMA METROPOLITANA", department: "LIMA" } };
const freeAgency = { ...firstRate, id: mockId(32), method: "agency" as const, price: { amount: 0, currency: "PEN" as const }, agencies: [branch] };
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
  expect(screen.getByRole("radio", { name: "Pendiente" })).toHaveProp("accessibilityState", expect.objectContaining({ checked: true }));
  fireEvent.press(screen.getByRole("button", { name: "Registrar adelanto" }));
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

test("scheduled dispatch date is sent when chosen and omitted otherwise", async () => {
  mockCompleteOrder.mockResolvedValue(ok({ kind: "completed", shownTotal: { amount: 10, currency: "PEN" },
    order: { id: mockId(3) } }));
  const withoutDay = await review();
  fireEvent.press(withoutDay.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledTimes(1));
  expect(mockCompleteOrder.mock.calls[0][0]).not.toHaveProperty("scheduledDispatchDate");
  withoutDay.unmount();
  mockCompleteOrder.mockClear();
  const screen = await review();
  fireEvent.press(screen.getByRole("button", { name: /^Despacho programado/ }));
  fireEvent(screen.getByTestId("order-despacho programado-picker"), "valueChange", {}, new Date(2026, 9, 20, 12));
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledTimes(1));
  expect(mockCompleteOrder.mock.calls[0][0]).toEqual(expect.objectContaining({ scheduledDispatchDate: "2026-10-20" }));
});

test("products stay read-only on the form and returning preserves entered data", async () => {
  const screen = await review();
  expect(screen.queryByRole("button", { name: "+" })).toBeNull();
  expect(screen.getByText("Talla: M")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Quitar" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Registrar adelanto" }));
  fireEvent.changeText(screen.getByLabelText(/Monto/), "10");
  fireEvent.press(screen.getByRole("button", { name: "Datos de envío" }));
  expect(screen.getByTestId("delivery-status")).toHaveProp("accessibilityLabel", "Estado: Pendiente");
  fireEvent(screen.getByTestId("delivery-status"), "valueChange", 1);
  fireEvent.changeText(screen.getByLabelText(/Dirección de entrega/), "Calle 1");
  fireEvent.press(screen.getByRole("button", { name: "Editar productos" }));
  expect(screen.getByRole("button", { name: "+" })).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  expect(screen.getByLabelText(/Monto/)).toHaveProp("value", "10");
  expect(screen.getByLabelText(/Dirección de entrega/)).toHaveProp("value", "Calle 1");
  expect(screen.getByTestId("delivery-status")).toHaveProp("accessibilityLabel", "Estado: Entregado");
});

test("delivered status explains missing payment and allows saving once covered", async () => {
  const screen = await review();
  fireEvent(screen.getByTestId("delivery-status"), "valueChange", 1);
  expect(screen.getByText(/Completa el pago/)).toHaveProp("accessibilityRole", "alert");
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
  fireEvent.press(screen.getByRole("button", { name: "Registrar adelanto" }));
  fireEvent.changeText(screen.getByLabelText(/Monto/), "10");
  expect(screen.queryByText(/Completa el pago/)).toBeNull();
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeEnabled();
});
beforeEach(() => { jest.clearAllMocks(); mockQuotation.mockReset(); mockSettingsGet.mockReset();
  mockQuotation.mockResolvedValue(ok(quotation));
  mockSettingsGet.mockResolvedValue(ok({ version: 1, home: { enabled: true }, store: { enabled: false, pickupPoint: null }, agency: { enabled: false }, couriers: [] })); mockNextId = 3; mockCountry = "PE"; mockDirty = false; mockDiscardVersion = 0; mockOffline = false; mockPending = ok([]); mockStock = 3; });

async function reviewWithQuantity(stock: number, quantity: number) {
  mockStock = stock;
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Camisa");
  fireEvent.press(screen.getByRole("button", { name: /Camisa/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  for (let count = 1; count < quantity; count++) fireEvent.press(screen.getByRole("button", { name: "+" }));
  return screen;
}
const stockWarning = /disponibles?\. Puedes guardar el pedido/;

test("line warning says how many units are available and what happens, only above the shown stock", async () => {
  const screen = await reviewWithQuantity(0, 4);
  expect(screen.getByText("Solo hay 0 disponibles. Puedes guardar el pedido, pero no cobrarlo completo ni despacharlo hasta reponer stock.")).toBeTruthy();
  screen.unmount();
  const single = await reviewWithQuantity(1, 2);
  expect(single.getByText(/^Solo hay 1 disponible\. Puedes guardar/)).toBeTruthy();
  single.unmount();
  const within = await reviewWithQuantity(3, 3);
  expect(within.queryByText(stockWarning)).toBeNull();
});

test("line warning renders as a note with the warning icon", async () => {
  const screen = await reviewWithQuantity(0, 4);
  expect(screen.getByText(stockWarning)).toBeTruthy();
  expect(screen.UNSAFE_getAllByType(SymbolView).some(node => node.props.name?.android === "warning")).toBe(true);
});

test("line warning is in Portuguese with the available count", async () => {
  try {
    const screen = await reviewWithQuantity(2, 3);
    await act(async () => { await i18n.changeLanguage("pt-BR"); });
    expect(screen.getByText("Só há 2 disponíveis. Você pode salvar o pedido, mas não cobrá-lo por completo nem despachá-lo até repor o estoque.")).toBeTruthy();
  } finally { await i18n.changeLanguage("es"); }
});

const dialogDescription = "Camisa: pediste 4, hay 3.\n\nSe guardará con sus pagos y el stock quedará pendiente de descontar hasta reponer el stock.";

test("payment that covers the total with quantity above stock warns early and keeps Save enabled", async () => {
  const screen = await reviewWithQuantity(3, 4);
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.press(screen.getByRole("button", { name: "Registrar adelanto" }));
  fireEvent.changeText(screen.getByLabelText(/Monto/), "40");
  expect(screen.getByText(/Con este pago se descuenta stock/)).toHaveProp("accessibilityRole", "alert");
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeEnabled();
  fireEvent.changeText(screen.getByLabelText(/Monto/), "5");
  expect(screen.queryByText(/Con este pago se descuenta stock/)).toBeNull();
});

async function payFully(quantity: number) {
  mockCompleteOrder.mockResolvedValue(ok({ kind: "completed", shownTotal: { amount: 40, currency: "PEN" }, order: { id: mockId(3) } }));
  const screen = await reviewWithQuantity(3, quantity);
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.press(screen.getByRole("radio", { name: "Pagado" }));
  fireEvent.press(screen.getByRole("button", { name: "Confirmar pago" }));
  return screen;
}

test("Pagado with quantity above stock asks on Save, and saving as pending sends the payment with deferred stock", async () => {
  const screen = await payFully(4);
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  expect(mockCompleteOrder).not.toHaveBeenCalled();
  expect(mockShowConfirmation).toHaveBeenCalledWith(expect.objectContaining({ title: "No hay stock suficiente", description: dialogDescription,
    confirmLabel: "Guardar como pendiente", cancelLabel: "Volver" }));
  mockShowConfirmation.mock.lastCall?.[0].onConfirm();
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledTimes(1));
  const sent = mockCompleteOrder.mock.calls[0][0];
  expect(sent.payments).toEqual([expect.objectContaining({ amount: "40.00" })]);
  expect(sent.deferStockDeduction).toBe(true);
  expect(mockCompleteOrder.mock.calls[0][1]).toBe(mockId(1));
});

test("saving as pending keeps an advance that covers the total and defers stock", async () => {
  mockCompleteOrder.mockResolvedValue(ok({ kind: "completed", shownTotal: { amount: 40, currency: "PEN" }, order: { id: mockId(3) } }));
  const screen = await reviewWithQuantity(3, 4);
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.press(screen.getByRole("button", { name: "Registrar adelanto" }));
  fireEvent.changeText(screen.getByLabelText(/Monto/), "40");
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  expect(mockShowConfirmation.mock.lastCall?.[0].description).toBe(dialogDescription);
  mockShowConfirmation.mock.lastCall?.[0].onConfirm();
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledTimes(1));
  expect(mockCompleteOrder.mock.calls[0][0]).toMatchObject({ payments: [expect.objectContaining({ amount: "40" })], deferStockDeduction: true });
});

test("saving as pending keeps a partial advance with its stock deduction option", async () => {
  mockCompleteOrder.mockResolvedValue(ok({ kind: "completed", shownTotal: { amount: 40, currency: "PEN" }, order: { id: mockId(3) } }));
  const screen = await reviewWithQuantity(3, 4);
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.press(screen.getByRole("button", { name: "Registrar adelanto" }));
  fireEvent.changeText(screen.getByLabelText(/Monto/), "10");
  fireEvent(screen.getByLabelText("Descontar stock con abono parcial"), "valueChange", true);
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  expect(mockShowConfirmation.mock.lastCall?.[0].description).toBe(dialogDescription);
  mockShowConfirmation.mock.lastCall?.[0].onConfirm();
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledTimes(1));
  expect(mockCompleteOrder.mock.calls[0][0]).toMatchObject({ payments: [expect.objectContaining({ amount: "10", deductStockIfPartial: true })], deferStockDeduction: true });
});

test("Volver on the stock dialog sends nothing", async () => {
  const screen = await payFully(4);
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  mockShowConfirmation.mock.lastCall?.[0].onCancel?.();
  expect(mockCompleteOrder).not.toHaveBeenCalled();
});

test("Pagado with quantity within stock sends directly without a dialog", async () => {
  const screen = await payFully(3);
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledTimes(1));
  expect(mockShowConfirmation).not.toHaveBeenCalledWith(expect.objectContaining({ title: "No hay stock suficiente" }));
});

test("Pagado sheet with quantity above stock shows the alert, and lowering the quantity removes it", async () => {
  const screen = await reviewWithQuantity(3, 4);
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.press(screen.getByRole("radio", { name: "Pagado" }));
  fireEvent.press(screen.getByRole("button", { name: "Confirmar pago" }));
  expect(screen.getByText(/Con este pago se descuenta stock/)).toHaveProp("accessibilityRole", "alert");
  fireEvent.press(screen.getByRole("button", { name: "Editar productos" }));
  fireEvent.press(screen.getByRole("button", { name: "−" }));
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  expect(screen.queryByText(/Con este pago se descuenta stock/)).toBeNull();
});

test("delivered with payment and quantity above stock shows a single stock alert", async () => {
  const screen = await reviewWithQuantity(3, 4);
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.press(screen.getByRole("button", { name: "Registrar adelanto" }));
  fireEvent.changeText(screen.getByLabelText(/Monto/), "40");
  fireEvent(screen.getByTestId("delivery-status"), "valueChange", 1);
  expect(screen.getAllByRole("alert").filter(node => /stock/.test(String(node.props.children)))).toHaveLength(1);
  expect(screen.getByText(/repón el stock para guardarlo como entregado/)).toBeTruthy();
  expect(screen.queryByText(/deja el pago como pendiente/)).toBeNull();
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
  expect(mockShowConfirmation).not.toHaveBeenCalled();
});

test("delivered without payment still reports the stock need and blocks saving", async () => {
  const screen = await reviewWithQuantity(3, 4);
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  fireEvent(screen.getByTestId("delivery-status"), "valueChange", 1);
  expect(screen.getByText(/repón el stock para guardarlo como entregado/)).toHaveProp("accessibilityRole", "alert");
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
});

test("pending order with quantity above stock still saves and is sent", async () => {
  mockCompleteOrder.mockResolvedValue(ok({ kind: "completed", shownTotal: { amount: 40, currency: "PEN" }, order: { id: mockId(3) } }));
  const screen = await reviewWithQuantity(3, 4);
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeEnabled();
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledWith(expect.objectContaining({
    items: [expect.objectContaining({ quantity: 4 })] }), mockId(1)));
});

test("stock warning texts exist in Spanish and Portuguese", () => {
  for (const language of ["es", "pt-BR"]) {
    for (const key of ["creationStockWarning", "paymentNeedsStock", "stockShortTitle", "stockShortItem", "stockShortAdvice", "saveAsPending", "stockShortBack"]) {
      expect(i18n.getFixedT(language)(key, { count: 0 })).not.toBe(key);
    }
  }
});

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
  fireEvent.press(screen.getByRole("button", { name: "Registrar adelanto" }));
  fireEvent.changeText(screen.getByLabelText(/Monto/), "5");
  fireEvent.press(screen.getByRole("button", { name: "Registrar adelanto" }));
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
  fireEvent.press(screen.getByRole("button", { name: "Registrar adelanto" }));
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

test("new order selects one overlapping home rate and reviews the full charge without manual pricing", async () => {
  mockCompleteOrder.mockResolvedValue(ok({ kind: "completed", shownTotal: { amount: 22, currency: "PEN" }, order: { id: mockId(3) } }));
  const screen = await review();
  fireEvent.press(screen.getByRole("button", { name: "Datos de envío" }));
  expect(screen.getByRole("button", { name: "Guardar pedido" })).toBeDisabled();
  selectDistrict(screen);
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 1);
  expect(screen.getAllByText(/S\/\s10\.00/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/S\/\s12\.00/).length).toBeGreaterThan(0);
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
  expect(screen.getByTestId("delivery-agency")).toBeTruthy();
  fireEvent(screen.getByTestId("delivery-document-type"), "valueChange", 0);
  fireEvent.changeText(screen.getByLabelText(/Número de documento/), "00123456");
  expect(screen.getAllByText(/S\/\s10\.00/).length).toBeGreaterThan(0);
  fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" }));
  await waitFor(() => expect(mockCompleteOrder).toHaveBeenCalledWith(expect.objectContaining({ ratedDelivery: {
    expectedPrice: freeAgency.price, delivery: { method: "agency", rateId: freeAgency.id, districtCode: "150122", agencyId: branch.id,
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

const stockRejection = { code: "INSUFFICIENT_STOCK", message: "No stock" };

test("an unreadable saved sale can be discarded without blocking a new sale", async () => {
  mockPending = err({ code: "INVALID_PENDING_DATA", message: "Invalid pending order" });
  mockDiscardPending.mockResolvedValue(ok(undefined));
  const screen = render(<NewOrderScreen />);
  await screen.findByText("No se pudo leer una venta guardada en el teléfono");
  await screen.findByText("Camisa");
  fireEvent.press(screen.getByRole("button", { name: "Descartar venta ilegible" }));
  await waitFor(() => expect(mockDiscardPending).toHaveBeenCalledWith(mockId(1)));
  expect(mockRefreshPending).toHaveBeenCalled();
});

test("a sale core cannot confirm yet waits on the phone and the page starts a new sale", async () => {
  const pending = { version: 2, companyId: mockId(1), id: mockId(3), shownTotal: { amount: 10, currency: "PEN" }, request: { id: mockId(3), items: [{ variantId: mockId(2), quantity: 1 }] } };
  mockCompleteOrder.mockResolvedValueOnce(ok({ kind: "queued", pending }));
  const screen = await review();
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" })); });
  expect(screen.getByText(/Se enviará sola/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Guardar pedido" })).toBeNull();
  expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  expect(screen.queryByText(/Comprobar|por verificar|Venta sin confirmar/)).toBeNull();
  expect(mockSyncPending).toHaveBeenCalled();
  expect(mockRefreshPending).toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole("button", { name: /Camisa/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  expect(screen.queryByText(/Se enviará sola/)).toBeNull();
});

test("a refused sale is reviewed on its page with its delivery and saved again under the same attempt", async () => {
  const delivery = { expectedPrice: { amount: 8, currency: "PEN" }, delivery: { method: "home", rateId: mockId(9),
    recipient: { name: "Ana", phone: "999001", identity: { kind: "absent" } }, destination: { districtCode: "150122", address: "Original street", instructions: null } } };
  const pending = { version: 2, companyId: mockId(1), id: mockId(3), shownTotal: { amount: 18, currency: "PEN" },
    request: { id: mockId(3), items: [{ variantId: mockId(2), quantity: 1 }], delivery }, rejection: { code: "TOTAL_CHANGED", message: "Changed" } };
  const draft = { kind: "items", id: pending.id, ratedDelivery: delivery, items: [{ variantId: mockId(2), quantity: 1, productName: "Camisa",
    variantAttributes: {}, sku: null, shownUnitPrice: { amount: 10, currency: "PEN" }, shownStock: 3 }] };
  mockPending = ok([pending]);
  mockLoadReview.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "Offline" }))
    .mockResolvedValue(ok({ kind: "review", pending, draft, unavailableVariantIds: [] }));
  mockReviewOrder.mockResolvedValue(ok({ kind: "completed", shownTotal: pending.shownTotal, order: { id: pending.id, status: "active" } }));
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Venta no guardada");
  expect(screen.getByText(/El precio de entrega cambió|cambió/)).toBeTruthy();
  expect(screen.getByText(/18[.,]00/)).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Revisar venta" })); });
  expect(screen.getByText(/No se pudo abrir la venta/)).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Revisar venta" })); });
  expect(mockLoadReview).toHaveBeenLastCalledWith(mockId(1), mockId(3));
  expect(screen.queryByText("Venta no guardada")).toBeNull();
  expect(screen.getByLabelText(/Dirección de entrega/)).toHaveProp("value", "Original street");
  expect(screen.getByRole("button", { name: "Guardar otra vez" })).toBeDisabled();
  selectDistrict(screen);
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 1);
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar otra vez" })); });
  expect(mockReviewOrder).toHaveBeenCalledWith(mockId(1), expect.objectContaining({ id: pending.id,
    ratedDelivery: expect.objectContaining({ expectedPrice: secondRate.price }) }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/orders/${mockId(3)}`));
  expect(mockCompleteOrder).not.toHaveBeenCalled();
});

test("a seller corrects a refused sale's missing references and payments; a repeated refusal stays editable", async () => {
  const pending = { version: 2, companyId: mockId(1), id: mockId(3), shownTotal: { amount: 30, currency: "PEN" },
    request: { id: mockId(3), items: [{ variantId: mockId(2), quantity: 2 }, { variantId: mockId(6), quantity: 1 }],
      payments: [{ paymentId: mockId(8), amount: { amount: 4.5, currency: "PEN" }, method: "bank_transfer", deductStockIfPartial: false }] },
    rejection: stockRejection };
  const draft = { kind: "items", id: pending.id,
    items: [{ variantId: mockId(2), quantity: 2, productName: "Camisa", variantAttributes: {}, sku: null,
      shownUnitPrice: { amount: 10, currency: "PEN" }, shownStock: 1 }],
    payments: [{ paymentId: mockId(8), amount: "4.5", method: "bank_transfer", deductStockIfPartial: false }] };
  mockPending = ok([pending]);
  mockLoadReview.mockResolvedValue(ok({ kind: "review", pending, draft, unavailableVariantIds: [mockId(6)] }));
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Ya no hay stock suficiente. Corrige la cantidad y vuelve a confirmar.");
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Revisar venta" })); });
  expect(screen.getByText(/Revisa los productos no disponibles/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Guardar otra vez" })).toBeDisabled();
  fireEvent.press(screen.getByRole("button", { name: "Editar productos" }));
  expect(screen.getByText(/El producto guardado 1 ya no está disponible/)).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Quitar producto no disponible 1" }));
  fireEvent.press(screen.getByRole("button", { name: "−" }));
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  fireEvent.changeText(screen.getByLabelText(/Monto/), "5.50");
  expect(screen.getByRole("button", { name: "Guardar otra vez" })).toBeEnabled();
  mockReviewOrder.mockResolvedValueOnce(err({ code: "INSUFFICIENT_STOCK", message: "No stock", issues: [{ field: "items", reason: "STOCK", variantId: mockId(2) }] }));
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar otra vez" })); });
  expect(screen.getByLabelText(/Monto/)).toHaveProp("value", "5.50");
  expect(mockReviewOrder).toHaveBeenLastCalledWith(mockId(1), expect.objectContaining({ id: pending.id,
    items: [expect.objectContaining({ variantId: mockId(2), quantity: 1 })],
    payments: [expect.objectContaining({ paymentId: mockId(8), amount: "5.50" })] }));
  fireEvent.press(screen.getByRole("button", { name: "Editar productos" }));
  expect(screen.getByText("Revisa esta variante.")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  mockReviewOrder.mockResolvedValueOnce(ok({ kind: "queued", pending }));
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar otra vez" })); });
  expect(screen.getByText(/Se enviará sola/)).toBeTruthy();
  expect(mockCompleteOrder).not.toHaveBeenCalled();
});
