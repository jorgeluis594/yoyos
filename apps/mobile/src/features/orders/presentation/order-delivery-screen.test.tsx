import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { ok, err } from "@shared/functional";
import { orders } from "@mobile/features/orders/composition";
import { deliverySettings } from "@mobile/features/delivery-settings/composition";
import OrderDeliveryScreen from "@mobile/features/orders/presentation/order-delivery-screen";
import i18n from "@mobile/i18n";
const mockId = "00000000-0000-4000-8000-000000000003";
const mockBack = jest.fn();
const mockPush = jest.fn();
let mockFocus: () => void;
jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack, push: mockPush }), useLocalSearchParams: () => ({ id: mockId }),
  useFocusEffect: (callback: () => void) => { mockFocus = callback; jest.requireActual("react").useEffect(callback, [callback]); } }));
jest.mock("@mobile/features/orders/composition", () => ({ orders: { loadOrderAggregate: jest.fn(), setDelivery: jest.fn() } }));
jest.mock("@mobile/features/delivery-settings/composition", () => ({ deliverySettings: { get: jest.fn() } }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: { status: "ready", company: { id: "company", country: "PE" } } }) }));
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
const point = { name: "Pickup", address: "Current address", instructions: "Ask for Ana" };
const pending: OrderAggregateResponse = { ...initialOrder, status: "active", deliveryStatus: "pending", completedAt: null,
  buyer: { contactId: "00000000-0000-4000-8000-000000000004", name: "Customer", phone: "555001" } };
beforeEach(() => {
  load.mockReset(); save.mockReset(); getSettings.mockReset(); mockBack.mockReset(); mockPush.mockReset();
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
  fireEvent(screen.getByLabelText("Cobrar el costo de entrega al cliente"), "valueChange", true);
  fireEvent.press(screen.getByText("Guardar entrega"));
  await screen.findByText(/No se pudo determinar/);
  expect(mockBack).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Nombre del destinatario *").props.value).toBe("Recipient");
  expect(screen.queryByText("private")).toBeNull();
  fireEvent.press(screen.getByText("Guardar entrega"));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenLastCalledWith(mockId, { delivery: { method: "store", recipient: { name: "Recipient", phone: "555002", identity: { kind: "absent" } } }, chargeDeliveryToCustomer: true });
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

test("home-only settings default to home, require district and preserve destination after unavailable costs", async () => {
  getSettings.mockResolvedValue(ok({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: { enabled: false, pickupPoint: null } }));
  save.mockResolvedValue(err({ code: "DELIVERY_UNAVAILABLE", message: "private" }));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByLabelText("Dirección de entrega *");
  fireEvent.changeText(screen.getByLabelText("Dirección de entrega *"), "Destination");
  fireEvent.press(screen.getByText("Guardar entrega"));
  await screen.findByText("Completa la dirección y el distrito de entrega.");
  expect(save).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText("Distrito *"), " District ");
  fireEvent.changeText(screen.getByLabelText("Indicaciones de entrega (opcional)"), "  ");
  fireEvent.press(screen.getByText("Guardar entrega"));
  await screen.findByText(/No se pudo determinar/);
  expect(save).toHaveBeenCalledWith(mockId, { delivery: { method: "home", recipient: { name: "Customer", phone: "555001", identity: { kind: "absent" } },
    destination: { address: "Destination", district: "District", instructions: null } }, chargeDeliveryToCustomer: false });
  expect(screen.getByLabelText("Dirección de entrega *").props.value).toBe("Destination");
  expect(mockBack).not.toHaveBeenCalled();
});

test("switching store to home preserves shared recipient, document and charge and removes pickup data from request", async () => {
  getSettings.mockResolvedValue(ok({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: { enabled: true, pickupPoint: point } }));
  save.mockResolvedValue(ok({ ...pending, delivery: { method: "home", recipient: { name: "Different", phone: "555001", identity: { kind: "document", documentType: "passport", document: "00-A" } },
    destination: { address: "Destination", district: "District", instructions: "Side door" }, recordedBy: { kind: "seller", userId: "server-author" } } }));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByText("Current address");
  fireEvent.changeText(screen.getByLabelText("Nombre del destinatario *"), "Different");
  fireEvent(screen.getByTestId("delivery-document-type"), "valueChange", 2);
  fireEvent.changeText(screen.getByLabelText("Número de documento *"), "00-A");
  fireEvent(screen.getByLabelText("Cobrar el costo de entrega al cliente"), "valueChange", true);
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 1);
  expect(screen.queryByText("Current address")).toBeNull();
  expect(screen.getByLabelText("Nombre del destinatario *").props.value).toBe("Different");
  fireEvent.changeText(screen.getByLabelText("Dirección de entrega *"), "Destination");
  fireEvent.changeText(screen.getByLabelText("Distrito *"), "District");
  fireEvent.changeText(screen.getByLabelText("Indicaciones de entrega (opcional)"), "Side door");
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 0);
  await screen.findByText("Current address");
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 1);
  expect(screen.getByLabelText("Dirección de entrega *").props.value).toBe("Destination");
  fireEvent.press(screen.getByText("Guardar entrega"));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledWith(mockId, { delivery: { method: "home", recipient: { name: "Different", phone: "555001", identity: { kind: "document", documentType: "passport", document: "00-A" } },
    destination: { address: "Destination", district: "District", instructions: "Side door" } }, chargeDeliveryToCustomer: true });
});

test("saved home prefill and configuration refresh keep destination draft; disabling its method blocks save", async () => {
  load.mockResolvedValue(ok({ ...pending, delivery: { method: "home", recipient: { name: "Saved recipient", phone: "555", identity: { kind: "absent" } },
    destination: { address: "Historic destination", district: "Historic district", instructions: null }, recordedBy: { kind: "seller", userId: "seller" } } }));
  getSettings.mockResolvedValueOnce(ok({ version: 1, agency: { enabled: false }, couriers: [], home: { enabled: true }, store: { enabled: true, pickupPoint: point } }))
    .mockResolvedValueOnce(ok({ version: 2, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: true, pickupPoint: point } }));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByLabelText("Dirección de entrega *");
  expect(screen.getByLabelText("Dirección de entrega *").props.value).toBe("Historic destination");
  fireEvent.changeText(screen.getByLabelText("Dirección de entrega *"), "My draft");
  await act(async () => { mockFocus(); });
  expect(screen.getByLabelText("Dirección de entrega *").props.value).toBe("My draft");
  expect(screen.getByRole("button", { name: "Guardar entrega" }).props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByText("Guardar entrega"));
  expect(save).not.toHaveBeenCalled();
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 0);
  expect(screen.getByRole("button", { name: "Guardar entrega" }).props.accessibilityState.disabled).toBe(false);
});

test("agency-only defaults require a document and stale couriers refresh without erasing drafts", async () => {
  const courier = { id: "00000000-0000-4000-8000-000000000011", name: "Original", enabled: true };
  const alternate = { id: "00000000-0000-4000-8000-000000000012", name: "Alternate", enabled: true };
  const config = { version: 1, agency: { enabled: true }, couriers: [courier, alternate], home: { enabled: false }, store: { enabled: false as const, pickupPoint: null } };
  getSettings.mockResolvedValueOnce(ok(config)).mockResolvedValueOnce(ok({ ...config, version: 2, couriers: [{ ...courier, enabled: false }, alternate] }));
  save.mockResolvedValueOnce(err({ code: "COURIER_UNAVAILABLE", message: "private" })).mockResolvedValueOnce(ok(pending));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByLabelText("Agencia de destino *");
  expect(screen.getByRole("button", { name: "Guardar entrega" }).props.accessibilityState.disabled).toBe(true);
  fireEvent(screen.getByTestId("delivery-courier"), "valueChange", 0);
  fireEvent.changeText(screen.getByLabelText("Agencia de destino *"), "Lima centro");
  fireEvent.press(screen.getByText("Guardar entrega"));
  await screen.findByText(/Selecciona un courier activo y completa/);
  expect(save).not.toHaveBeenCalled();
  fireEvent(screen.getByTestId("delivery-document-type"), "valueChange", 1);
  fireEvent.changeText(screen.getByLabelText("Número de documento *"), "00-A001");
  fireEvent.press(screen.getByText("Guardar entrega"));
  await screen.findByText(/El courier ya no está disponible/);
  expect(screen.getByLabelText("Agencia de destino *").props.value).toBe("Lima centro");
  expect(screen.getByLabelText("Número de documento *").props.value).toBe("00-A001");
  expect(screen.getByRole("button", { name: "Guardar entrega" }).props.accessibilityState.disabled).toBe(true);
  expect(mockBack).not.toHaveBeenCalled();
  fireEvent(screen.getByTestId("delivery-courier"), "valueChange", 0);
  fireEvent.press(screen.getByText("Guardar entrega"));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenLastCalledWith(mockId, { delivery: { method: "agency", courierId: alternate.id, agency: "Lima centro", recipient: { name: "Customer", phone: "555001", identity: { kind: "document", documentType: "passport", document: "00-A001" } } }, chargeDeliveryToCustomer: false });
});

test("saved agency keeps its inactive courier unselected and preserves drafts across all methods", async () => {
  const courier = { id: "00000000-0000-4000-8000-000000000011", name: "Inactive", enabled: false };
  getSettings.mockResolvedValue(ok({ version: 2, agency: { enabled: true }, couriers: [courier, { ...courier, id: "00000000-0000-4000-8000-000000000012", name: "Active", enabled: true }], home: { enabled: true }, store: { enabled: true, pickupPoint: point } }));
  load.mockResolvedValue(ok({ ...pending, delivery: { method: "agency", recipient: { name: "Saved", phone: "00123", identity: { kind: "document", documentType: "foreign_id", document: "000123" } }, courier: { id: courier.id, name: "Historic" }, agency: "Historic agency", recordedBy: { kind: "seller", userId: "seller" } } }));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByLabelText("Agencia de destino *");
  expect(screen.getByRole("button", { name: "Guardar entrega" }).props.accessibilityState.disabled).toBe(true);
  fireEvent.changeText(screen.getByLabelText("Agencia de destino *"), "Agency draft");
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 1);
  fireEvent.changeText(screen.getByLabelText("Dirección de entrega *"), "Home draft");
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 0);
  await screen.findByText("Current address");
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 2);
  expect(screen.getByLabelText("Agencia de destino *").props.value).toBe("Agency draft");
  expect(screen.getByLabelText("Nombre del destinatario *").props.value).toBe("Saved");
  expect(screen.getByLabelText("Número de documento *").props.value).toBe("000123");
  fireEvent(screen.getByTestId("delivery-method"), "valueChange", 1);
  expect(screen.getByLabelText("Dirección de entrega *").props.value).toBe("Home draft");
});
