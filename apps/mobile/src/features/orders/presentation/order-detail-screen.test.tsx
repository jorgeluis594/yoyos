import * as Clipboard from "expo-clipboard";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import OrderDetailScreen from "@mobile/features/orders/presentation/order-detail-screen";
import i18n from "@mobile/i18n";

const mockId = "00000000-0000-4000-8000-000000000003";
let mockNotice: { id: string; shownTotal: { amount: number; currency: string } } | null = null;
let mockCountry = "PE";
const mockClear = jest.fn();
const mockPush = jest.fn();
let mockFocus: () => void;
let mockLoadFailed = false;
const mockRegisterPayment = jest.fn();
const mockVoidPayment = jest.fn();
const mockEnableCheckout = jest.fn();
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));
const initialOrder: OrderAggregateResponse = { number: 1001, id: mockId, companyId: "00000000-0000-4000-8000-000000000001", sellerId: "seller",
  buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null, createdAt: "2026-09-29T11:00:00.000Z", deliveredAt: "2026-09-29T12:00:00.000Z", completedAt: "2026-09-29T12:00:00.000Z",
  status: "completed", paymentStatus: "paid", paidAmount: { amount: 12, currency: "PEN" },
  balanceDue: { amount: 0, currency: "PEN" }, overpaidAmount: { amount: 0, currency: "PEN" }, cancelled: false,
  delivery: null, deliveryStatus: "delivered", stockDeducted: true, itemsTotal: { amount: 12, currency: "PEN" },
  deliveryCost: { amount: 0, currency: "PEN" }, deliveryCharge: { amount: 0, currency: "PEN" }, total: { amount: 12, currency: "PEN" },
  payments: [{ id: "00000000-0000-4000-8000-000000000006", orderId: mockId, amount: { amount: 12, currency: "PEN" },
    method: "digital_wallet", status: "confirmed", data: { confirmedAt: "2026-09-29T12:00:00.000Z", confirmedBy: { kind: "legacy" }, evidence: { kind: "manual" } } }],
  items: [{ id: "00000000-0000-4000-8000-000000000005", variantId: "00000000-0000-4000-8000-000000000002",
    productName: "Camisa", variantAttributes: { Talla: "M" }, sku: null, quantity: 1,
    unitPrice: { amount: 12, currency: "PEN" }, subtotal: { amount: 12, currency: "PEN" } }] };
let mockOrder = initialOrder;
beforeEach(() => { mockOrder = initialOrder; mockNotice = null; mockCountry = "PE"; mockPush.mockReset(); mockLoadFailed = false; mockEnableCheckout.mockReset(); mockRegisterPayment.mockReset(); mockVoidPayment.mockReset(); jest.mocked(Clipboard.setStringAsync).mockResolvedValue(true); });

jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), push: mockPush }),
  useLocalSearchParams: () => ({ id: mockId }),
  useFocusEffect: (callback: () => void) => { mockFocus = callback; jest.requireActual("react").useEffect(callback, [callback]); } }));
jest.mock("@mobile/features/orders/composition", () => ({ orders: {
  enableOrderCheckout: (...args: unknown[]) => mockEnableCheckout(...args),
  loadOrderAggregate: async () => mockLoadFailed ? ({ success: false, error: { code: "NETWORK_ERROR" } }) : ({ success: true, data: mockOrder }),
  clearPendingOrderConfirmation: async () => ({ success: true, data: undefined }),
  registerPayment: (...args: unknown[]) => mockRegisterPayment(...args),
  voidPayment: (...args: unknown[]) => mockVoidPayment(...args),
} }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: {
  status: "ready", company: { id: "00000000-0000-4000-8000-000000000001", country: mockCountry },
} }) }));
jest.mock("@mobile/features/orders/presentation/order-result", () => ({ useOrderResult: () => ({ notice: mockNotice, clear: mockClear }) }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));

test("immediate result shows the amount difference; history detail shows only the recorded total", async () => {
  mockCountry = "CL";
  mockNotice = { id: mockId, shownTotal: { amount: 10, currency: "PEN" } };
  const immediate = render(<OrderDetailScreen />);
  await immediate.findByText("Revisa el importe cobrado");
  expect(immediate.getByText(/Diferencia:/)).toBeTruthy();
  immediate.unmount();
  mockNotice = null;
  const history = render(<OrderDetailScreen />);
  await history.findByText("Venta completada");
  expect(history.queryByText("Revisa el importe cobrado")).toBeNull();
});

test("pending detail shows the actual balance, stock and creation date", async () => {
  mockOrder = { ...mockOrder, status: "active", paymentStatus: "pending", completedAt: null,
    paidAmount: { amount: 4, currency: "PEN" }, balanceDue: { amount: 8, currency: "PEN" },
    deliveryStatus: "pending", stockDeducted: false };
  mockNotice = null;
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Orden activa");
  expect(screen.getByText(/Saldo pendiente:/)).toBeTruthy();
  expect(screen.getByText("Stock pendiente")).toBeTruthy();
  expect(screen.queryByText(/Completada el/)).toBeNull();
});

test("seller confirms a reported partial amount from the mobile order", async () => {
  const reportId = "00000000-0000-4000-8000-000000000099";
  mockOrder = { ...initialOrder, status: "active", paymentStatus: "pending", completedAt: null,
    paidAmount: { amount: 0, currency: "PEN" }, balanceDue: { amount: 12, currency: "PEN" },
    deliveryStatus: "pending", stockDeducted: false,
    payments: [{ id: reportId, orderId: mockId, status: "reported", currency: "PEN", amount: null, method: null,
      data: { receiptImageId: "00000000-0000-4000-8000-000000000098", reportedAt: "2026-09-29T11:30:00.000Z" } }] };
  mockRegisterPayment.mockResolvedValue({ success: false, error: { code: "INSUFFICIENT_STOCK" } });
  const screen = render(<OrderDetailScreen />);
  await screen.findByText(/Pago reportado, pendiente de revisión/);
  const inputs = screen.getAllByLabelText(/Importe recibido/);
  fireEvent.changeText(inputs[0], "4.50");
  fireEvent.press(screen.getAllByRole("button", { name: "Confirmar pago" })[0]);
  await waitFor(() => expect(mockRegisterPayment).toHaveBeenCalledWith(mockId, {
    paymentId: reportId, source: "buyer_report", amount: { amount: 4.5, currency: "PEN" },
    method: "digital_wallet", deductStockIfPartial: false,
  }));
  expect(screen.getByText("No hay stock suficiente para confirmar el pago.")).toBeTruthy();
});

test("seller can void a confirmed payment from mobile", async () => {
  mockVoidPayment.mockResolvedValue({ success: true, data: { ...initialOrder, payments: [] } });
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Venta completada");
  fireEvent.press(screen.getByRole("button", { name: "Anular pago" }));
  await waitFor(() => expect(mockVoidPayment).toHaveBeenCalledWith(mockId, initialOrder.payments[0].id));
});

test('order detail translates amounts and labels to Portuguese', async () => {
  await i18n.changeLanguage('pt-BR');
  mockOrder = { ...initialOrder, status: 'active', completedAt: null, paymentStatus: 'pending',
    balanceDue: { amount: 8, currency: 'PEN' }, deliveryStatus: 'pending', stockDeducted: false };
  mockNotice = { id: mockId, shownTotal: { amount: 10, currency: 'PEN' } };
  try {
    const detail = render(<OrderDetailScreen />);
    await detail.findByText('Confira o valor cobrado');
    expect(detail.getByText(/Diferença:/)).toBeTruthy();
    expect(detail.getByText('Público geral')).toBeTruthy();
    expect(detail.getByText('Pedido ativo')).toBeTruthy();
    expect(detail.getByText(/Saldo pendente:/)).toBeTruthy();
    expect(detail.getByText('Estoque pendente')).toBeTruthy();
    expect(detail.queryByText(/Concluído em/)).toBeNull();
    detail.unmount();
  } finally {
    await i18n.changeLanguage('es');
  }
});

 test("pending details open assignment, while immediate sales keep null delivery presentation", async () => {
  mockOrder = { ...initialOrder, status: "active", completedAt: null, deliveryStatus: "pending" };
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Entrega por definir");
  fireEvent.press(screen.getByText("Asignar entrega"));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/orders/delivery", params: { id: mockId } });
  screen.unmount(); mockOrder = initialOrder;
  const completed = render(<OrderDetailScreen />);
  await completed.findByText("Venta completada");
  expect(completed.queryByText("Entrega por definir")).toBeNull();
  expect(completed.queryByText("Asignar entrega")).toBeNull();
 });
 test("saved pickup detail shows historic destination, author and absorbed delivery cost", async () => {
  mockOrder = { ...initialOrder, status: "active", completedAt: null, deliveryStatus: "pending", deliveryCost: { amount: 3, currency: "PEN" },
    delivery: { method: "store", recipient: { name: "Recipient", phone: "555", identity: { kind: "absent" } }, pickupPoint: { name: "Historic store", address: "Historic address", instructions: "Historic instructions" }, recordedBy: { kind: "seller", userId: "second-seller" } } };
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Historic address");
  expect(screen.getByText("Historic instructions")).toBeTruthy();
  expect(screen.getByText(/Registrada por vendedor: second-seller/)).toBeTruthy();
  expect(screen.getByText(/Costo de entrega:/)).toBeTruthy();
  expect(screen.getByText(/Cargo al cliente:/)).toBeTruthy();
  expect(screen.getByText("Editar entrega")).toBeTruthy();
 });
 test.each(["shipped", "delivered"] as const)("%s details hide assignment", async deliveryStatus => {
   mockOrder = { ...initialOrder, status: "active", deliveryStatus };
   const screen = render(<OrderDetailScreen />); await screen.findByText("Orden activa");
   expect(screen.queryByText("Asignar entrega")).toBeNull();
 });

test("a failed refetch after returning hides obsolete details and offers retry", async () => {
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Venta completada");
  mockLoadFailed = true;
  await act(async () => { mockFocus(); });
  await screen.findByText("No se pudo abrir la venta");
  expect(screen.queryByText("Venta completada")).toBeNull();
  mockLoadFailed = false;
  fireEvent.press(screen.getByText("Reintentar"));
  await screen.findByText("Venta completada");
});

test("home details show historical address, district, instructions and seller alongside cost and charge", async () => {
  mockOrder = { ...initialOrder, status: "active", completedAt: null, deliveryStatus: "pending", deliveryCost: { amount: 3, currency: "PEN" },
    delivery: { method: "home", recipient: { name: "Recipient", phone: "555", identity: { kind: "absent" } }, destination: { address: "Historic destination", district: "Historic district", instructions: "Historic instructions" }, recordedBy: { kind: "seller", userId: "second-seller" } } };
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Historic destination");
  expect(screen.getByText("Historic district")).toBeTruthy();
  expect(screen.getByText("Historic instructions")).toBeTruthy();
  expect(screen.getByText(/Registrada por vendedor: second-seller/)).toBeTruthy();
  expect(screen.getByText(/Costo de entrega:/)).toBeTruthy();
  expect(screen.getByText(/Cargo al cliente:/)).toBeTruthy();
});

test("agency history shows the saved courier and document after shipment", async () => {
  mockOrder = { ...initialOrder, status: "active", completedAt: null, deliveryStatus: "shipped",
    delivery: { method: "agency", recipient: { name: "Recipient", phone: "00123", identity: { kind: "document", documentType: "passport", document: "00-A001" } },
      courier: { id: "00000000-0000-4000-8000-000000000011", name: "Historic courier" }, agency: "Historic agency", recordedBy: { kind: "seller", userId: "second-seller" } } };
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Historic courier");
  expect(screen.getByText("Historic agency")).toBeTruthy();
  expect(screen.getByText(/00-A001/)).toBeTruthy();
  expect(screen.queryByText("Editar entrega")).toBeNull();
});

test("seller obtains and copies checkout link without changing the payment display", async () => {
  const url = `https://shop.example/checkout/${initialOrder.companyId}/${mockId}`;
  mockEnableCheckout.mockImplementation(async () => {
    mockOrder = { ...mockOrder, checkoutEnabledAt: "2026-10-05T00:00:00.000Z" };
    return { success: true, data: { url } };
  });
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Enlace aún no habilitado");
  fireEvent.press(screen.getByText("Obtener enlace"));
  await screen.findByText("Pendiente de confirmación");
  expect(mockEnableCheckout).toHaveBeenCalledWith(mockId);
  fireEvent.press(screen.getByText("Copiar enlace"));
  await screen.findByText("Enlace copiado");
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(url);
  expect(screen.getByText(/Pago cubierto/)).toBeTruthy();
  jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(false);
  fireEvent.press(screen.getByText("Copiar enlace"));
  await screen.findByText("Mantén pulsado el enlace para copiarlo.");
  expect(screen.getByText(url).props.selectable).toBe(true);
});

test("confirmed and cancelled checkouts display persisted state while link failures remain retryable", async () => {
  mockOrder = { ...initialOrder, number: 10000, checkoutEnabledAt: "2026-10-05T00:00:00.000Z", checkoutConfirmedAt: "2026-10-05T01:00:00.000Z", buyer: { name: "Ana", phone: "+51987654321", contactId: null } };
  const confirmed = render(<OrderDetailScreen />);
  await confirmed.findByText("Confirmado por el comprador");
  expect(confirmed.getByText("Pedido #10000")).toBeTruthy();
  mockEnableCheckout.mockResolvedValue({ success: false, error: { code: "SERVICE_UNAVAILABLE" } });
  fireEvent.press(confirmed.getByText("Obtener enlace"));
  await confirmed.findByText("No se pudo obtener el enlace. Inténtalo de nuevo.");
  expect(confirmed.queryByText("Copiar enlace")).toBeNull();
  confirmed.unmount();
  mockOrder = { ...mockOrder, cancelled: true, status: "cancelled" };
  const cancelled = render(<OrderDetailScreen />);
  await cancelled.findByText("Pedido cancelado");
  expect(cancelled.queryByText("Obtener enlace")).toBeNull();
});
