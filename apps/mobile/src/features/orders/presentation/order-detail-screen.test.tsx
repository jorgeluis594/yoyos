import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import OrderDetailScreen from "@mobile/features/orders/presentation/order-detail-screen";
import i18n from "@mobile/i18n";

const mockId = "00000000-0000-4000-8000-000000000003";
let mockNotice: { id: string; shownTotal: { amount: number; currency: string } } | null = null;
let mockCountry = "PE";
const mockClear = jest.fn();
const mockRegisterPayment = jest.fn();
const mockVoidPayment = jest.fn();
const initialOrder: OrderAggregateResponse = { id: mockId, companyId: "00000000-0000-4000-8000-000000000001", sellerId: "seller",
  customer: { kind: "general_public" }, createdAt: "2026-09-29T11:00:00.000Z", deliveredAt: "2026-09-29T12:00:00.000Z", completedAt: "2026-09-29T12:00:00.000Z",
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
beforeEach(() => { mockOrder = initialOrder; mockNotice = null; mockCountry = "PE"; mockRegisterPayment.mockReset(); mockVoidPayment.mockReset(); });

jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn() }),
  useLocalSearchParams: () => ({ id: mockId }),
  useFocusEffect: (callback: () => void) => jest.requireActual("react").useEffect(callback, [callback]) }));
jest.mock("@mobile/features/orders/composition", () => ({ orders: {
  loadOrderAggregate: async () => ({ success: true, data: mockOrder }),
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
