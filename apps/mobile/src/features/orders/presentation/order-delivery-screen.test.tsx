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
  const Picker = ({ onValueChange, children }: { onValueChange: (value: number) => void; children: React.ReactNode }) => <View accessible accessibilityRole="adjustable" {...{ onValueChange }}>{children}</View>;
  Picker.Item = function PickerItem() { return null; };
  return { Host: View, Picker };
});
const initialOrder: OrderAggregateResponse = { id: mockId, companyId: "00000000-0000-4000-8000-000000000001", sellerId: "seller",
  customer: { kind: "general_public" }, createdAt: "2026-09-29T11:00:00.000Z", completedAt: "2026-09-29T12:00:00.000Z",
  status: "completed", paymentStatus: "paid", paidAmount: { amount: 12, currency: "PEN" },
  balanceDue: { amount: 0, currency: "PEN" }, overpaidAmount: { amount: 0, currency: "PEN" }, cancelled: false,
  delivery: null, deliveryStatus: "delivered", stockDeducted: true, itemsTotal: { amount: 12, currency: "PEN" },
  deliveryCost: { amount: 0, currency: "PEN" }, deliveryCharge: { amount: 0, currency: "PEN" }, total: { amount: 12, currency: "PEN" },
  payments: [{ id: "00000000-0000-4000-8000-000000000006", orderId: mockId, amount: { amount: 12, currency: "PEN" },
    method: "digital_wallet", recordedAt: "2026-09-29T12:00:00.000Z" }],
  items: [{ id: "00000000-0000-4000-8000-000000000005", variantId: "00000000-0000-4000-8000-000000000002",
    productName: "Camisa", variantAttributes: { Talla: "M" }, sku: null, quantity: 1,
    unitPrice: { amount: 12, currency: "PEN" }, subtotal: { amount: 12, currency: "PEN" } }] };

const load = jest.mocked(orders.loadOrderAggregate);
const save = jest.mocked(orders.setDelivery);
const getSettings = jest.mocked(deliverySettings.get);
const point = { name: "Pickup", address: "Current address", instructions: "Ask for Ana" };
const pending: OrderAggregateResponse = { ...initialOrder, status: "active", deliveryStatus: "pending", completedAt: null,
  customer: { kind: "contact", contactId: "00000000-0000-4000-8000-000000000004", name: "Customer", phone: "555001" } };
beforeEach(() => {
  load.mockReset(); save.mockReset(); getSettings.mockReset(); mockBack.mockReset(); mockPush.mockReset();
  load.mockResolvedValue(ok(pending)); getSettings.mockResolvedValue(ok({ version: 1, home: { enabled: false }, store: { enabled: true, pickupPoint: point } }));
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
  expect(save).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText("Nombre del destinatario *"), "Recipient");
  fireEvent(screen.getByRole("adjustable"), "valueChange", 2);
  fireEvent.press(screen.getByText("Guardar entrega"));
  expect(save).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText("Número de documento *"), "00-A123");
  fireEvent.press(screen.getByText("Guardar entrega"));
  await screen.findByText(/No se pudo guardar la entrega/);
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
  expect(save).toHaveBeenCalledTimes(1);
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
  getSettings.mockResolvedValueOnce(ok({ version: 0, home: { enabled: false }, store: { enabled: false, pickupPoint: null } }));
  const screen = render(<OrderDeliveryScreen />);
  await screen.findByText(/no está habilitado/);
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
  getSettings.mockResolvedValueOnce(ok({ version: 0, home: { enabled: false }, store: { enabled: false, pickupPoint: null } }))
    .mockResolvedValueOnce(ok({ version: 1, home: { enabled: false }, store: { enabled: true, pickupPoint: point } }))
    .mockResolvedValueOnce(ok({ version: 2, home: { enabled: false }, store: { enabled: true, pickupPoint: { ...point, address: "Updated" } } }));
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
