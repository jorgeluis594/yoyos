import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { ok, err } from "@shared/functional";
import { orders } from "@mobile/features/orders/composition";
import { deliverySettings } from "@mobile/features/delivery-settings/composition";
import OrderDeliveryScreen from "@mobile/features/orders/presentation/order-delivery-screen";
import i18n from "@mobile/i18n";
import { getPeruDistrict, getPeruProvinces, peruDepartments } from "@shared/peru-geography";
const mockId = "00000000-0000-4000-8000-000000000003";
const mockBack = jest.fn();
const mockPush = jest.fn();
let mockFocus: () => void;
jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack, push: mockPush }), useLocalSearchParams: () => ({ id: mockId }),
  useFocusEffect: (callback: () => void) => { mockFocus = callback; jest.requireActual("react").useEffect(callback, [callback]); } }));
jest.mock("@mobile/features/orders/composition", () => ({ orders: { loadOrderAggregate: jest.fn(), setDelivery: jest.fn() } }));
jest.mock("@mobile/features/delivery-settings/composition", () => ({ deliverySettings: { get: jest.fn(), createQuotation: jest.fn() } }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: { status: "ready", company: { id: "company", country: "PE" } } }) }));
jest.mock("react-native-screens/experimental", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@expo/ui", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const Picker = ({ onValueChange, children, testID }: { onValueChange: (value: number) => void; children: React.ReactNode; testID?: string }) => <View testID={testID} accessible accessibilityRole="adjustable" {...{ onValueChange }}>{children}</View>;
  Picker.Item = function PickerItem() { return null; };
  return { Host: View, Picker };
});
const initialOrder: OrderAggregateResponse = { id: mockId, companyId: "00000000-0000-4000-8000-000000000001", sellerId: "seller",
  number: 1001, buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null, checkoutDeliveryRequest: null, deliveredAt: "2026-09-29T12:00:00.000Z", createdAt: "2026-09-29T11:00:00.000Z", completedAt: "2026-09-29T12:00:00.000Z",
  status: "completed", paymentStatus: "paid", paidAmount: { amount: 12, currency: "PEN" },
  balanceDue: { amount: 0, currency: "PEN" }, overpaidAmount: { amount: 0, currency: "PEN" }, cancelled: false,
  delivery: null, deliveryStatus: "delivered", stockDeducted: true, itemsTotal: { amount: 12, currency: "PEN" },
  deliveryCost: { amount: 0, currency: "PEN" }, deliveryCharge: { amount: 0, currency: "PEN" }, total: { amount: 12, currency: "PEN" },
  payments: [{ id: "00000000-0000-4000-8000-000000000006", orderId: mockId, amount: { amount: 12, currency: "PEN" },
    status: "confirmed", method: "digital_wallet", data: { confirmedAt: "2026-09-29T12:00:00.000Z", confirmedBy: { kind: "seller", userId: "seller" }, evidence: { kind: "manual" } } }],
  items: [{ id: "00000000-0000-4000-8000-000000000005", variantId: "00000000-0000-4000-8000-000000000002",
    productName: "Camisa", variantAttributes: { Talla: "M" }, sku: null, quantity: 1,
    unitPrice: { amount: 12, currency: "PEN" }, subtotal: { amount: 12, currency: "PEN" } }] };

const load = jest.mocked(orders.loadOrderAggregate);
const save = jest.mocked(orders.setDelivery);
const getSettings = jest.mocked(deliverySettings.get);
const quote = jest.mocked(deliverySettings.createQuotation);
const firstRate = { id: "00000000-0000-4000-8000-000000000030", method: "home" as const, price: { amount: 8, currency: "PEN" as const } };
const secondRate = { ...firstRate, id: "00000000-0000-4000-8000-000000000031", price: { amount: 12, currency: "PEN" as const } };
const agencyRate = { ...firstRate, id: "00000000-0000-4000-8000-000000000032", method: "agency" as const, price: { amount: 0, currency: "PEN" as const } };
const quotation = { id: "00000000-0000-4000-8000-000000000033", districtCode: "150122", rates: [firstRate, secondRate, agencyRate] };
const point = { name: "Pickup", address: "Current address", instructions: "Ask for Ana" };
const pending: OrderAggregateResponse = { ...initialOrder, status: "active", deliveryStatus: "pending", completedAt: null,
  buyer: { contactId: "00000000-0000-4000-8000-000000000004", name: "Customer", phone: "555001" } };
beforeEach(() => {
  load.mockReset(); save.mockReset(); getSettings.mockReset(); quote.mockReset(); quote.mockResolvedValue(ok(quotation)); mockBack.mockReset(); mockPush.mockReset();
  load.mockResolvedValue(ok(pending)); getSettings.mockResolvedValue(ok({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: point } }));
});
test("recipient can differ from buyer; unavailable save preserves data and confirmed aggregate returns to detail", async () => {
  save.mockResolvedValueOnce(err({ code: "DELIVERY_UNAVAILABLE", message: "private" })).mockResolvedValueOnce(ok({ ...pending,
    delivery: { method: "store", recipient: { name: "Recipient", phone: "555002", identity: { kind: "absent" } }, pickupPoint: point, recordedBy: { kind: "seller", userId: "server-author" } },
    deliveryCost: { amount: 3, currency: "PEN" }, deliveryCharge: { amount: 3, currency: "PEN" }, total: { amount: 15, currency: "PEN" } }));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByText("Current address");
  expect(screen.getByLabelText("Nombre del destinatario *").props.value).toBe("Customer");
  fireEvent.changeText(screen.getByLabelText("Nombre del destinatario *"), "Recipient");
  fireEvent.changeText(screen.getByLabelText("Teléfono del destinatario *"), "555002");
  fireEvent.press(screen.getByText("Guardar entrega"));
  await screen.findByText(/No se pudo determinar/);
  expect(mockBack).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Nombre del destinatario *").props.value).toBe("Recipient");
  expect(screen.queryByText("private")).toBeNull();
  fireEvent.press(screen.getByText("Guardar entrega"));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenLastCalledWith(mockId, { delivery: { method: "store", recipient: { name: "Recipient", phone: "555002", identity: { kind: "absent" } } }, expectedPrice: { amount: 0, currency: "PEN" } });
});
test("validation requires recipient and selected document; values preserve leading zeros and language changes", async () => {
  save.mockResolvedValue(err({ code: "NETWORK_ERROR", message: "offline" }));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByText("Current address");
  fireEvent.changeText(screen.getByLabelText("Nombre del destinatario *"), " ");
  fireEvent.press(screen.getByText("Guardar entrega"));
  await screen.findByText(/Completa el nombre/);
  expect(screen.getByLabelText("Nombre del destinatario *").props.accessibilityHint).toMatch(/Completa el nombre/);
  expect(save).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText("Nombre del destinatario *"), "Recipient");
  fireEvent(screen.getByTestId("delivery-document-type"), "valueChange", 2);
  fireEvent.press(screen.getByText("Guardar entrega"));
  await waitFor(() => expect(screen.getByLabelText("Número de documento *").props.accessibilityHint).toMatch(/Completa el nombre/));
  expect(save).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText("Número de documento *"), "00-A123");
  fireEvent.press(screen.getByText("Guardar entrega"));
  await screen.findByText(/No se pudo guardar la entrega/);
  expect(screen.getByLabelText("Nombre del destinatario *").props.accessibilityHint).toBeUndefined();
  expect(screen.getByLabelText("Número de documento *").props.accessibilityHint).toBeUndefined();
  expect(save).toHaveBeenCalledWith(mockId, expect.objectContaining({ delivery: expect.objectContaining({ recipient: expect.objectContaining({ identity: { kind: "document", documentType: "passport", document: "00-A123" } }) }) }));
  await act(async () => { await i18n.changeLanguage("pt-BR"); });
  try {
    expect(screen.getByText(/Não foi possível salvar a entrega/)).toBeTruthy();
    expect(screen.getByLabelText("Número do documento *").props.value).toBe("00-A123");
    expect(load).toHaveBeenCalledTimes(1);
  } finally { screen.unmount(); await act(async () => { await i18n.changeLanguage("es"); }); }
});
test("pending save guards duplicate taps, and a state race locks edits without navigating", async () => {
  let finish: ((result: Awaited<ReturnType<typeof orders.setDelivery>>) => void) | undefined;
  save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByText("Current address");
  fireEvent.press(screen.getByText("Guardar entrega")); fireEvent.press(screen.getByText("Guardar entrega"));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "Guardar entrega" }).props.accessibilityState.disabled).toBe(true);
  await act(async () => { finish?.(err({ code: "DELIVERY_LOCKED", message: "already shipped" })); });
  expect(screen.queryByText("Guardar entrega")).toBeNull();
  expect(screen.getAllByText(/ya no se puede editar/).length).toBeGreaterThan(0);
  expect(mockBack).not.toHaveBeenCalled();
});
test.each(["shipped", "delivered"] as const)("direct route to %s order exposes no delivery editor", async deliveryStatus => {
  load.mockResolvedValue(ok({ ...pending, deliveryStatus }));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByText(/ya no se puede editar/);
  expect(screen.queryByText("Guardar entrega")).toBeNull(); expect(save).not.toHaveBeenCalled();
});
test("disabled store points to configuration and failed settings read never becomes editable defaults", async () => {
  getSettings.mockResolvedValueOnce(ok({ version: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: null } }));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByText(/no está habilitad/);
  expect(screen.queryByText("Guardar entrega")).toBeNull();
  fireEvent.press(screen.getByText("Configurar modalidades")); expect(mockPush).toHaveBeenCalledWith("/settings/delivery");
  screen.unmount();
  getSettings.mockResolvedValueOnce(err({ code: "INVALID_RESPONSE", message: "malformed" }));
  const failed = render(<OrderDeliveryScreen />);
  await failed.findByText("No se pudo cargar la entrega");
  expect(failed.queryByText("Configurar modalidades")).toBeNull();
  expect(failed.queryByText("Guardar entrega")).toBeNull();
});

test("cancelled orders expose no editor even when delivery remains pending", async () => {
  load.mockResolvedValue(ok({ ...pending, status: "cancelled", cancelled: true }));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByText(/ya no se puede editar/);
  expect(screen.queryByText("Guardar entrega")).toBeNull(); expect(save).not.toHaveBeenCalled();
});

test("returning from configuration refreshes availability and point without erasing recipient draft", async () => {
  getSettings.mockResolvedValueOnce(ok({ version: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: null } }))
    .mockResolvedValueOnce(ok({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: point } }))
    .mockResolvedValueOnce(ok({ version: 2, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: { ...point, address: "Updated" } } }));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByText("Configurar modalidades");
  await act(async () => { mockFocus(); });
  await screen.findByText("Guardar entrega");
  fireEvent.changeText(screen.getByLabelText("Nombre del destinatario *"), "My draft");
  await act(async () => { mockFocus(); });
  await screen.findByText("Updated");
  expect(screen.getByLabelText("Nombre del destinatario *").props.value).toBe("My draft");
  expect(load).toHaveBeenCalledTimes(1);
});

const allMethods = { version: 1, agency: { enabled: true }, couriers: [{ id: "00000000-0000-4000-8000-000000000011", name: "Courier", enabled: true }],
  home: { enabled: true }, store: { enabled: true as const, pickupPoint: point } };
function selectDistrict(screen: ReturnType<typeof render>, code = "150122") {
  const edit = screen.queryByRole("button", { name: /^Distrito:/ });
  if (edit) fireEvent.press(edit);
  const district = getPeruDistrict(code)!;
  fireEvent(screen.getByTestId("delivery-department"), "valueChange", peruDepartments.findIndex(item => item.code === district.departmentCode));
  fireEvent(screen.getByTestId("delivery-province"), "valueChange", getPeruProvinces(district.departmentCode).findIndex(item => item.code === district.provinceCode));
  fireEvent.changeText(screen.getByLabelText("Buscar distrito"), code);
  fireEvent(screen.getByTestId("delivery-district"), "valueChange", 0);
}

test("seller chooses one home rate, sees products plus one charge, and editing recipient or street does not requote", async () => {
  getSettings.mockResolvedValue(ok(allMethods));
  save.mockResolvedValue(ok(pending));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByText("Current address");
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 1);
  expect(screen.getByRole("button", { name: "Guardar entrega" }).props.accessibilityState.disabled).toBe(true);
  expect(quote).not.toHaveBeenCalled();
  selectDistrict(screen);
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 1);
  expect(screen.getByText(/Productos:\sS\/\s12\.00/)).toBeTruthy();
  expect(screen.getByText(/Entrega:\sS\/\s12\.00/)).toBeTruthy();
  expect(screen.getByText(/Total:\sS\/\s24\.00/)).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText("Dirección de entrega *"), "Final street");
  fireEvent.changeText(screen.getByLabelText("Nombre del destinatario *"), "Recipient");
  fireEvent.changeText(screen.getByLabelText("Indicaciones de entrega (opcional)"), "Side door");
  expect(quote).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText("Cobrar el costo de entrega al cliente")).toBeNull();
  fireEvent.press(screen.getByText("Guardar entrega"));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledWith(mockId, { delivery: { method: "home", rateId: secondRate.id,
    recipient: { name: "Recipient", phone: "555001", identity: { kind: "absent" } },
    destination: { districtCode: "150122", address: "Final street", instructions: "Side door" } }, expectedPrice: secondRate.price });
});

test("agency selects district and explicit zero rate without operational fields, and still requires identity", async () => {
  getSettings.mockResolvedValue(ok(allMethods));
  save.mockResolvedValue(ok(pending));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByText("Current address");
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 2);
  selectDistrict(screen);
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 0);
  expect(screen.queryByTestId("delivery-courier")).toBeNull();
  expect(screen.queryByLabelText("Agencia de destino *")).toBeNull();
  fireEvent.press(screen.getByText("Guardar entrega"));
  await screen.findByText(/Completa el nombre, el teléfono y el documento/);
  expect(save).not.toHaveBeenCalled();
  fireEvent(screen.getByTestId("delivery-document-type"), "valueChange", 1);
  fireEvent.changeText(screen.getByLabelText("Número de documento *"), "00-A001");
  fireEvent.press(screen.getByText("Guardar entrega"));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledWith(mockId, { delivery: { method: "agency", districtCode: "150122", rateId: agencyRate.id,
    recipient: { name: "Customer", phone: "555001", identity: { kind: "document", documentType: "passport", document: "00-A001" } } }, expectedPrice: agencyRate.price });
});

test("a late shipping quotation cannot restore a charge after switching to pickup", async () => {
  getSettings.mockResolvedValue(ok(allMethods));
  let finish: ((value: Awaited<ReturnType<typeof deliverySettings.createQuotation>>) => void) | undefined;
  quote.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByText("Current address");
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 1);
  selectDistrict(screen);
  await screen.findByText("Buscando tarifas…");
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 0);
  await act(async () => { finish?.(ok(quotation)); });
  expect(screen.queryByTestId("delivery-rate")).toBeNull();
  expect(screen.getByText(/Entrega:\sS\/\s0\.00/)).toBeTruthy();
  expect(screen.getByText(/Total:\sS\/\s12\.00/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Guardar entrega" }).props.accessibilityState.disabled).toBe(false);
});

test("missing coverage and technical failure never display a free shipping charge and allow explicit retry", async () => {
  getSettings.mockResolvedValue(ok(allMethods));
  quote.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "private" })).mockResolvedValueOnce(ok({ ...quotation, rates: [] }));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByText("Current address");
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 1);
  selectDistrict(screen);
  fireEvent.changeText(screen.getByLabelText("Dirección de entrega *"), "Preserved");
  await screen.findByText(/No se pudieron consultar/);
  expect(screen.queryByText(/Entrega:\sS\/\s0\.00/)).toBeNull();
  expect(screen.queryByText("private")).toBeNull();
  fireEvent.press(screen.getByText("Consultar tarifas nuevamente"));
  await screen.findByText(/No hay cobertura/);
  expect(screen.getByLabelText("Dirección de entrega *").props.value).toBe("Preserved");
  expect(screen.getByRole("button", { name: "Guardar entrega" }).props.accessibilityState.disabled).toBe(true);
  expect(save).not.toHaveBeenCalled();
});

test("a changed price preserves the form and requires a new rate choice before reconfirming", async () => {
  getSettings.mockResolvedValueOnce(ok(allMethods)).mockResolvedValue(ok({ ...allMethods, version: 2 }));
  quote.mockResolvedValueOnce(ok(quotation)).mockResolvedValueOnce(ok({ ...quotation, rates: [{ ...firstRate,
    id: "00000000-0000-4000-8000-000000000034", price: { amount: 10, currency: "PEN" } }] }));
  save.mockResolvedValueOnce(err({ code: "TOTAL_CHANGED", message: "private", currentPrice: { amount: 10, currency: "PEN" } })).mockResolvedValueOnce(ok(pending));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByText("Current address");
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 1);
  selectDistrict(screen);
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 0);
  fireEvent.changeText(screen.getByLabelText("Dirección de entrega *"), "Preserved");
  fireEvent.press(screen.getByText("Guardar entrega"));
  await screen.findByText(/La tarifa cambió/);
  await waitFor(() => expect(quote).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText("Dirección de entrega *").props.value).toBe("Preserved");
  expect(screen.getByRole("button", { name: "Guardar entrega" }).props.accessibilityState.disabled).toBe(true);
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 0);
  fireEvent.press(screen.getByText("Guardar entrega"));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenLastCalledWith(mockId, expect.objectContaining({ expectedPrice: { amount: 10, currency: "PEN" } }));
});

test("a late quotation for the previous district cannot replace current options", async () => {
  getSettings.mockResolvedValue(ok(allMethods));
  let finish: ((value: Awaited<ReturnType<typeof deliverySettings.createQuotation>>) => void) | undefined;
  quote.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(ok({ ...quotation, districtCode: "040110", rates: [secondRate] }));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByText("Current address");
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 1);
  selectDistrict(screen);
  await screen.findByText("Buscando tarifas…");
  selectDistrict(screen, "040110");
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 0);
  await act(async () => { finish?.(ok(quotation)); });
  expect(screen.getByText(/Entrega:\sS\/\s12\.00/)).toBeTruthy();
  expect(screen.getByText("MIRAFLORES · AREQUIPA · AREQUIPA")).toBeTruthy();
  expect(quote).toHaveBeenCalledTimes(2);
});

test("replacing a historical home delivery retains recipient and street without guessing a district or rate", async () => {
  getSettings.mockResolvedValue(ok(allMethods));
  load.mockResolvedValue(ok({ ...pending, delivery: { method: "home", recipient: { name: "Historic", phone: "00123", identity: { kind: "absent" } },
    destination: { address: "Old street", district: "Miraflores", instructions: null }, recordedBy: { kind: "seller", userId: "seller" } } }));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByLabelText("Dirección de entrega *");
  expect(screen.getByLabelText("Dirección de entrega *").props.value).toBe("Old street");
  expect(screen.getByLabelText("Nombre del destinatario *").props.value).toBe("Historic");
  expect(screen.getByLabelText("Teléfono del destinatario *").props.value).toBe("00123");
  expect(quote).not.toHaveBeenCalled();
  expect(screen.queryByTestId("delivery-rate")).toBeNull();
  expect(screen.getByRole("button", { name: "Guardar entrega" }).props.accessibilityState.disabled).toBe(true);
  fireEvent.changeText(screen.getByLabelText("Dirección de entrega *"), "Draft street");
  getSettings.mockResolvedValue(ok({ ...allMethods, version: 2, home: { enabled: false } }));
  await act(async () => { mockFocus(); });
  expect(screen.getByLabelText("Dirección de entrega *").props.value).toBe("Draft street");
  expect(screen.getByRole("button", { name: "Guardar entrega" }).props.accessibilityState.disabled).toBe(true);
});

test("reselecting the destination requires fresh rates instead of reviving an older quotation", async () => {
  getSettings.mockResolvedValue(ok(allMethods));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByText("Current address");
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 1);
  fireEvent.changeText(screen.getByLabelText("Dirección de entrega *"), "Street");
  selectDistrict(screen);
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 0);
  expect(screen.getByRole("button", { name: "Guardar entrega" })).toBeEnabled();
  let finish: ((result: Awaited<ReturnType<typeof deliverySettings.createQuotation>>) => void) | undefined;
  quote.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  selectDistrict(screen);
  await waitFor(() => expect(quote).toHaveBeenCalledTimes(2));
  expect(screen.queryByTestId("delivery-rate")).toBeNull();
  expect(screen.getByRole("button", { name: "Guardar entrega" })).toBeDisabled();
  await act(async () => { finish?.(ok({ ...quotation, rates: [{ ...firstRate, id: "00000000-0000-4000-8000-000000000039" }] })); });
  expect(screen.getByRole("button", { name: "Guardar entrega" })).toBeDisabled();
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 0);
  expect(screen.getByRole("button", { name: "Guardar entrega" })).toBeEnabled();
});

test("chosen district collapses to an editable summary without losing the selected rate or recipient", async () => {
  getSettings.mockResolvedValue(ok(allMethods));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByText("Current address");
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 2);
  selectDistrict(screen);
  await screen.findByTestId("delivery-rate");
  fireEvent(screen.getByTestId("delivery-rate"), "valueChange", 0);
  expect(screen.queryByTestId("delivery-department")).toBeNull();
  expect(screen.getByRole("button", { name: /^Distrito:/ })).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: /^Distrito:/ }));
  expect(screen.getByTestId("delivery-department")).toBeTruthy();
  expect(screen.getByLabelText("Nombre del destinatario *").props.value).toBe("Customer");
  expect(screen.getByRole("button", { name: "Guardar entrega" })).toBeEnabled();
  expect(quote).toHaveBeenCalledTimes(1);
});
