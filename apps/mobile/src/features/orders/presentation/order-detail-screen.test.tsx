import { AccessibilityInfo, Alert, Linking, Share, StyleSheet } from "react-native";
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
let mockLoads = 0;
let mockNoticeAt: string | null = null;
let mockArrival: (destination: unknown) => void = () => undefined;
const mockStopArrivals = jest.fn();
const mockRegisterPayment = jest.fn();
const mockVoidPayment = jest.fn();
const mockRejectPayment = jest.fn();
const mockEnableCheckout = jest.fn();
const mockShip = jest.fn();
const mockDeliver = jest.fn();
const mockCancel = jest.fn();
const mockUpdateShipping = jest.fn();
const mockCheckCancellation = jest.fn();
let mockUserId = "seller";
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));
const initialOrder: OrderAggregateResponse = { number: 1001, id: mockId, companyId: "00000000-0000-4000-8000-000000000001", sellerId: "seller",
  buyer: null, source: "manual", checkoutEnabledAt: null, checkoutConfirmedAt: null, scheduledDispatchDate: null, shippedAt: null, createdAt: "2026-09-29T11:00:00.000Z", deliveredAt: "2026-09-29T12:00:00.000Z", completedAt: "2026-09-29T12:00:00.000Z",
  status: "completed", paymentStatus: "paid", paidAmount: { amount: 12, currency: "PEN" },
  balanceDue: { amount: 0, currency: "PEN" }, overpaidAmount: { amount: 0, currency: "PEN" }, cancelled: false,
  delivery: null, deliveryStatus: "delivered", stockDeducted: true, stockDue: null, itemsTotal: { amount: 12, currency: "PEN" },
  deliveryCost: { amount: 0, currency: "PEN" }, deliveryCharge: { amount: 0, currency: "PEN" }, total: { amount: 12, currency: "PEN" },
  payments: [{ id: "00000000-0000-4000-8000-000000000006", orderId: mockId, amount: { amount: 12, currency: "PEN" },
    method: "digital_wallet", status: "confirmed", data: { confirmedAt: "2026-09-29T12:00:00.000Z", confirmedBy: { kind: "legacy" }, evidence: { kind: "manual" } } }],
  items: [{ id: "00000000-0000-4000-8000-000000000005", variantId: "00000000-0000-4000-8000-000000000002",
    productName: "Camisa", variantAttributes: { Talla: "M" }, sku: null, quantity: 1,
    unitPrice: { amount: 12, currency: "PEN" }, subtotal: { amount: 12, currency: "PEN" }, mentionedPrice: null }] };
let mockOrder = initialOrder;
beforeEach(() => { mockUserId = "seller"; mockCancel.mockReset(); mockCheckCancellation.mockReset(); mockOrder = initialOrder; mockNotice = null; mockCountry = "PE"; mockPush.mockReset(); mockLoadFailed = false; mockLoads = 0; mockNoticeAt = null; mockStopArrivals.mockReset(); mockEnableCheckout.mockReset(); mockEnableCheckout.mockResolvedValue({ success: true, data: { url: linkUrl } }); mockShip.mockReset(); mockDeliver.mockReset(); mockRegisterPayment.mockReset(); mockRejectPayment.mockReset(); mockVoidPayment.mockReset(); jest.mocked(Clipboard.setStringAsync).mockResolvedValue(true); });

jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), push: mockPush }),
  useLocalSearchParams: () => ({ id: mockId, ...(mockNoticeAt === null ? {} : { noticeAt: mockNoticeAt }) }),
  useFocusEffect: (callback: () => void) => { mockFocus = callback; jest.requireActual("react").useEffect(callback, [callback]); } }));
jest.mock("@mobile/features/orders/composition", () => ({ orders: {
  updateOrderShipping: (...args: unknown[]) => mockUpdateShipping(...args),
  cancelOrder: (...args: unknown[]) => mockCancel(...args),
  checkCancellation: (...args: unknown[]) => mockCheckCancellation(...args),
  ship: (...args: unknown[]) => mockShip(...args),
  deliver: (...args: unknown[]) => mockDeliver(...args),
  enableOrderCheckout: (...args: unknown[]) => mockEnableCheckout(...args),
  loadOrderAggregate: async () => (mockLoads++, mockLoadFailed) ? ({ success: false, error: { code: "NETWORK_ERROR" } }) : ({ success: true, data: mockOrder }),
  clearPendingOrderConfirmation: async () => ({ success: true, data: undefined }),
  registerPayment: (...args: unknown[]) => mockRegisterPayment(...args),
  voidPayment: (...args: unknown[]) => mockVoidPayment(...args),
  rejectPayment: (...args: unknown[]) => mockRejectPayment(...args),
} }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: {
  status: "ready", user: { id: mockUserId }, company: { id: "00000000-0000-4000-8000-000000000001", country: mockCountry },
} }) }));
jest.mock("@mobile/features/notifications/presentation/notices-provider", () => ({
  useNotices: () => ({ watchArrivals: (listener: (destination: unknown) => void) => { mockArrival = listener; return mockStopArrivals; } }),
}));
jest.mock("@mobile/features/orders/presentation/dispatch-print-review", () => ({ useDispatchPrint: () => ({ open: jest.fn(), active: false, show: jest.fn() }) }));
jest.mock("@mobile/features/orders/presentation/order-result", () => ({ useOrderResult: () => ({ notice: mockNotice, clear: mockClear }) }));
jest.mock("@mobile/features/orders/presentation/order-day-field", () => ({ OrderDayField: ({ value, onChange }: { value: string; onChange: (day: string) => void }) => {
  const { Text } = jest.requireActual("react-native");
  return <><Text>{`day:${value}`}</Text><Text onPress={() => onChange("2026-10-20")}>pick</Text><Text onPress={() => onChange("")}>clear</Text></>;
} }));
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
  expect(screen.getByText("Saldo")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Detalles internos" }));
  expect(screen.getByText("Stock pendiente")).toBeTruthy();
  expect(screen.queryByText(/Completada el/)).toBeNull();
});

test("catalog order detail shows «Desde el catálogo» and no seller", async () => {
  mockOrder = { ...mockOrder, source: "catalog", sellerId: null };
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Desde el catálogo");
  fireEvent.press(screen.getByRole("button", { name: "Detalles internos" }));
  expect(screen.getByText("Stock descontado")).toBeTruthy();
  expect(screen.queryByText(/Vendedor:/)).toBeNull();
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
  await screen.findByText("1 comprobante por revisar");
  expect(screen.queryByLabelText(/Importe recibido/)).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "1 comprobante por revisar" }));
  fireEvent.press(screen.getByRole("button", { name: "Revisar comprobante" }));
  const inputs = screen.getAllByLabelText(/Importe recibido/);
  fireEvent.changeText(inputs[0], "4.50");
  fireEvent.press(screen.getAllByRole("button", { name: "Confirmar pago" })[0]);
  await waitFor(() => expect(mockRegisterPayment).toHaveBeenCalledWith(mockId, {
    paymentId: reportId, source: "buyer_report", amount: { amount: 4.5, currency: "PEN" },
    method: "digital_wallet", walletProvider: "yape", deductStockIfPartial: false,
  }));
  expect(screen.getByText("No hay stock suficiente para confirmar el pago.")).toBeTruthy();
});

test("never labels a rejected payment as confirmed", async () => {
  const rejectedId = "00000000-0000-4000-8000-000000000097";
  mockOrder = { ...initialOrder, status: "active", paymentStatus: "pending", completedAt: null,
    paidAmount: { amount: 0, currency: "PEN" }, balanceDue: { amount: 12, currency: "PEN" },
    deliveryStatus: "pending", stockDeducted: false,
    payments: [{ id: rejectedId, orderId: mockId, status: "rejected", currency: "PEN", amount: null, method: null,
      data: { report: { receiptImageId: "00000000-0000-4000-8000-000000000098", reportedAt: "2026-09-29T11:30:00.000Z" },
        rejectedAt: "2026-09-29T12:00:00.000Z", rejectedBy: "seller", reason: "No coincide" } }] };
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Total");
  expect(screen.getByText(/Rechazado/)).toBeTruthy();
  expect(screen.queryByText(/confirmado/i)).toBeNull();
  expect(screen.queryByRole("button", { name: "Anular pago" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Revisar comprobante" })).toBeNull();
});

test("seller can void a confirmed payment from mobile", async () => {
  mockVoidPayment.mockResolvedValue({ success: true, data: { ...initialOrder, payments: [] } });
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Venta completada");
  fireEvent.press(screen.getByRole("button", { name: "Anular pago" }));
  await waitFor(() => expect(mockVoidPayment).toHaveBeenCalledWith(mockId, initialOrder.payments[0].id));
});

test("manual payment opens on demand, validates input and updates the summary after confirmation", async () => {
  mockOrder = { ...initialOrder, status: "active", completedAt: null, paymentStatus: "pending", payments: [],
    paidAmount: { amount: 0, currency: "PEN" }, balanceDue: { amount: 12, currency: "PEN" } };
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Total");
  expect(screen.queryByRole("radio", { name: /Pago completo/ })).toBeNull();
  expect(screen.queryByText("Stock descontado")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Registrar pago" }));
  expect(screen.getByRole("radio", { name: /Pago completo \(S\/\s*12\.00\)/ })).toHaveProp("accessibilityState", expect.objectContaining({ checked: true }));
  fireEvent.press(screen.getByRole("radio", { name: /Otro monto/ }));
  fireEvent.changeText(screen.getByLabelText(/Monto/), "0");
  expect(screen.getAllByRole("button", { name: /^Registrar/ }).at(-1)).toBeDisabled();
  expect(mockRegisterPayment).not.toHaveBeenCalled();
  mockRegisterPayment.mockResolvedValue({ success: true, data: { order: initialOrder } });
  fireEvent.press(screen.getByRole("radio", { name: /Pago completo/ }));
  fireEvent.press(screen.getByRole("button", { name: /^Registrar S/ }));
  await screen.findByLabelText("Pagado");
  expect(screen.queryByRole("radio", { name: /Pago completo/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Registrar pago" })).toBeNull();
  expect(screen.getByText(/confirmado/i)).toBeTruthy();
  expect(mockRegisterPayment).toHaveBeenCalledWith(mockId, expect.objectContaining({
    source: "manual", amount: { amount: 12, currency: "PEN" },
  }));
});

test("closing the payment form does not register a payment and cancelled orders cannot open it", async () => {
  mockOrder = { ...initialOrder, status: "active", paymentStatus: "pending", balanceDue: { amount: 12, currency: "PEN" } };
  const screen = render(<OrderDetailScreen />);
  fireEvent.press(await screen.findByRole("button", { name: /^(Registrar pago|Cobrar saldo)/ }));
  fireEvent.press(screen.getByRole("radio", { name: /Otro monto/ }));
  fireEvent.changeText(screen.getByLabelText(/Monto/), "4");
  fireEvent.press(screen.getAllByRole("button", { name: "Cerrar" }).at(-1)!);
  expect(screen.queryByRole("radio", { name: /Otro monto/ })).toBeNull();
  expect(mockRegisterPayment).not.toHaveBeenCalled();
  screen.unmount();
  mockOrder = { ...mockOrder, cancelled: true, status: "cancelled" };
  const cancelled = render(<OrderDetailScreen />);
  await cancelled.findByText("Orden cancelada");
  expect(cancelled.queryByRole("button", { name: "Registrar pago" })).toBeNull();
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
    expect(detail.getByText('Saldo')).toBeTruthy();
    fireEvent.press(detail.getByRole('button', { name: 'Detalhes internos' }));
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
  fireEvent.press(screen.getByText("Asignar datos"));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/orders/delivery", params: { id: mockId } });
  screen.unmount(); mockOrder = initialOrder;
  const completed = render(<OrderDetailScreen />);
  await completed.findByText("Venta completada");
  expect(completed.queryByText("Entrega por definir")).toBeNull();
  expect(completed.queryByText("Asignar datos")).toBeNull();
 });
 test("saved pickup detail shows historic destination, author and absorbed delivery cost", async () => {
  mockOrder = { ...initialOrder, status: "active", completedAt: null, deliveryStatus: "pending", deliveryCost: { amount: 3, currency: "PEN" },
    delivery: { method: "store", recipient: { name: "Recipient", phone: "555", identity: { kind: "absent" } }, pickupPoint: { name: "Historic store", address: "Historic address", instructions: "Historic instructions" }, settingsVersion: 1, recordedBy: { kind: "seller", userId: "second-seller" } } };
  const screen = render(<OrderDetailScreen />);
  await screen.findByRole("button", { name: /^Envío: / });
  fireEvent.press(screen.getByRole("button", { name: /^Envío: / }));
  fireEvent.press(screen.getByRole("button", { name: "Detalles internos" }));
  expect(screen.getByText("Historic instructions")).toBeTruthy();
  expect(screen.getByText(/Registrada por vendedor: second-seller/)).toBeTruthy();
  expect(screen.getByText(/Costo de entrega:/)).toBeTruthy();
  expect(screen.getByText(/Cargo al cliente:/)).toBeTruthy();
  expect(screen.getByText("Editar datos")).toBeTruthy();
 });
 test.each(["shipped", "delivered"] as const)("%s details hide assignment", async deliveryStatus => {
   mockOrder = { ...initialOrder, status: "active", deliveryStatus };
   const screen = render(<OrderDetailScreen />); await screen.findByText("Orden activa");
   expect(screen.queryByText("Asignar datos")).toBeNull();
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
    delivery: { method: "home", recipient: { name: "Recipient", phone: "555", identity: { kind: "absent" } }, destination: { address: "Historic destination", country: "PE" as const, districtCode: "150101", province: "Lima", department: "Lima", district: "Historic district", instructions: "Historic instructions" }, pricing: { quotationId: "00000000-0000-4000-8000-000000000020", rateId: "00000000-0000-4000-8000-000000000021", optionId: "00000000-0000-4000-8000-000000000022", settingsVersion: 1 }, recordedBy: { kind: "seller", userId: "second-seller" } } };
  const screen = render(<OrderDetailScreen />);
  await screen.findByRole("button", { name: /^Envío: / });
  fireEvent.press(screen.getByRole("button", { name: /^Envío: / }));
  fireEvent.press(screen.getByRole("button", { name: "Detalles internos" }));
  expect(screen.getByText("Historic district")).toBeTruthy();
  expect(screen.getByText("Historic instructions")).toBeTruthy();
  expect(screen.getByText(/Registrada por vendedor: second-seller/)).toBeTruthy();
  expect(screen.getByText(/Costo de entrega:/)).toBeTruthy();
  expect(screen.getByText(/Cargo al cliente:/)).toBeTruthy();
});

const linkUrl = `https://fantasio.yoyos.lat/checkout/${mockId}`;

test("the order link shows when the screen opens, without a get-link step or a disclosure", async () => {
  mockOrder = { ...initialOrder, status: "active", deliveryStatus: "pending", completedAt: null, deliveredAt: null };
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Pendiente de confirmación");
  expect(await screen.findByText(linkUrl)).toBeTruthy();
  expect(screen.getByText(linkUrl).props.selectable).toBe(true);
  expect(mockEnableCheckout).toHaveBeenCalledTimes(1);
  expect(mockEnableCheckout).toHaveBeenCalledWith(mockId);
  expect(screen.getByText("Enlace del pedido")).toBeTruthy();
  expect(screen.getByText("Comparte este enlace con el comprador para que confirme y pague.")).toBeTruthy();
  expect(screen.queryByText("Obtener enlace")).toBeNull();
  expect(screen.queryByText("Ver enlace")).toBeNull();
  expect(screen.queryByText("Confirmación del comprador")).toBeNull();
  expect(screen.getByLabelText("Pagado")).toBeTruthy();
});

test("copy announces politely, share and open use the link, and a refused copy fails silently", async () => {
  const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" });
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  const screen = render(<OrderDetailScreen />);
  await screen.findByText(linkUrl);
  jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(false);
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Copiar enlace" })));
  expect(screen.queryByText("Enlace copiado")).toBeNull();
  jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error("denied"));
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Copiar enlace" })));
  expect(screen.queryByText("Enlace copiado")).toBeNull();
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Copiar enlace" })));
  expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith(linkUrl);
  expect(screen.getByText("Enlace copiado").props.accessibilityLiveRegion).toBe("polite");
  fireEvent.press(screen.getByRole("button", { name: "Compartir enlace" }));
  fireEvent.press(screen.getByRole("button", { name: "Abrir enlace" }));
  expect(share).toHaveBeenCalledWith({ message: linkUrl });
  expect(open).toHaveBeenCalledWith(linkUrl);
  share.mockRestore(); open.mockRestore();
});

test("the link actions are at least 44 points tall", async () => {
  const screen = render(<OrderDetailScreen />);
  await screen.findByText(linkUrl);
  for (const name of ["Copiar enlace", "Compartir enlace", "Abrir enlace"]) {
    const style = StyleSheet.flatten(screen.getByRole("button", { name }).props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  }
});

test("a confirmed order says so and still shows its link", async () => {
  mockOrder = { ...initialOrder, number: 10000, checkoutEnabledAt: "2026-10-05T00:00:00.000Z", checkoutConfirmedAt: "2026-10-05T01:00:00.000Z", buyer: { name: "Ana", phone: "+51987654321", contactId: null } };
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Confirmado por el comprador");
  expect(await screen.findByText(linkUrl)).toBeTruthy();
});

test("without a subdomain the screen explains and leads to Apariencia de la tienda", async () => {
  mockEnableCheckout.mockResolvedValue({ success: false, error: { code: "SUBDOMAIN_REQUIRED", message: "Choose the catalog link" } });
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Elige el link de tu tienda para compartir este pedido.");
  expect(screen.queryByText(linkUrl)).toBeNull();
  expect(screen.queryByRole("button", { name: "Copiar enlace" })).toBeNull();
  expect(screen.queryByText("No se pudo obtener el enlace. Inténtalo de nuevo.")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Ir a Apariencia de la tienda" }));
  expect(mockPush).toHaveBeenCalledWith("/settings/appearance?focus=catalog");
});

test("other failures keep the retryable error and show no link", async () => {
  mockEnableCheckout.mockResolvedValueOnce({ success: false, error: { code: "SERVICE_UNAVAILABLE" } });
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("No se pudo obtener el enlace. Inténtalo de nuevo.");
  expect(screen.queryByText(linkUrl)).toBeNull();
  expect(screen.queryByRole("button", { name: "Copiar enlace" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByText(linkUrl)).toBeTruthy();
  expect(mockEnableCheckout).toHaveBeenCalledTimes(2);
});

test("a rejected request shows the same error", async () => {
  mockEnableCheckout.mockRejectedValueOnce(new Error("boom"));
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("No se pudo obtener el enlace. Inténtalo de nuevo.");
});

test("a cancelled order offers no link action and never asks for the link", async () => {
  mockOrder = { ...initialOrder, cancelled: true, status: "cancelled", checkoutEnabledAt: "2026-10-05T00:00:00.000Z" };
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Pedido cancelado");
  expect(mockEnableCheckout).not.toHaveBeenCalled();
  expect(screen.queryByText(linkUrl)).toBeNull();
  for (const name of ["Copiar enlace", "Compartir enlace", "Abrir enlace", "Ir a Apariencia de la tienda"]) expect(screen.queryByRole("button", { name })).toBeNull();
});

test("returning to the screen asks for the link again so a new subdomain shows", async () => {
  mockEnableCheckout.mockResolvedValueOnce({ success: false, error: { code: "SUBDOMAIN_REQUIRED", message: "x" } });
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Elige el link de tu tienda para compartir este pedido.");
  await act(async () => { mockFocus(); });
  expect(await screen.findByText(linkUrl)).toBeTruthy();
});


test.each([null, "store"] as const)("seller delivers a shipped order with %s delivery and keeps payments", async method => {
  mockOrder = { ...initialOrder, status: "active", deliveryStatus: "shipped", deliveredAt: null, completedAt: null,
    delivery: method === "store" ? { method, recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } },
      pickupPoint: { name: "Tienda", address: "Lima", instructions: null }, settingsVersion: 1, recordedBy: { kind: "seller", userId: "seller" } } : null };
  mockDeliver.mockResolvedValue({ success: true, data: { ...mockOrder, status: "completed", deliveryStatus: "delivered", completedAt: initialOrder.completedAt, deliveredAt: initialOrder.deliveredAt } });
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Orden activa");
  fireEvent.press(screen.getByRole("button", { name: "Marcar como entregado" }));
  await screen.findByText("Pedido marcado como entregado.");
  expect(screen.getByText("Venta completada")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Detalles internos" }));
  expect(screen.getByText(/Completada el/)).toBeTruthy();
  expect(screen.getByLabelText("Pagado")).toBeTruthy();
  expect(mockDeliver).toHaveBeenCalledWith(mockId);
  expect(mockShip).not.toHaveBeenCalled();
  expect(mockRegisterPayment).not.toHaveBeenCalled();
  expect(mockVoidPayment).not.toHaveBeenCalled();
});

test("seller ships then delivers and sees an updated state after each operation", async () => {
  mockOrder = { ...initialOrder, status: "active", deliveryStatus: "pending", deliveredAt: null, completedAt: null };
  mockShip.mockResolvedValue({ success: true, data: { ...mockOrder, deliveryStatus: "shipped" } });
  mockDeliver.mockResolvedValue({ success: true, data: initialOrder });
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Orden activa");
  fireEvent.press(screen.getByRole("button", { name: "Marcar como despachado" }));
  await screen.findByText("Pedido marcado como enviado.");
  expect(screen.getByLabelText("Pagado")).toBeTruthy();
  expect(screen.getByText("Despachado")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Marcar como despachado" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Marcar como entregado" }));
  await screen.findByText("Pedido marcado como entregado.");
  expect(screen.getByText("Venta completada")).toBeTruthy();
  expect(mockShip).toHaveBeenCalledWith(mockId);
  expect(mockRegisterPayment).not.toHaveBeenCalled();
  expect(mockVoidPayment).not.toHaveBeenCalled();
});

test.each([
  { paymentStatus: "pending", paidAmount: { amount: 0, currency: "PEN" }, stockDeducted: true, cancelled: false, deliveryStatus: "pending", reason: "Se requiere al menos un pago para despachar." },
  { paymentStatus: "paid", stockDeducted: false, cancelled: false, deliveryStatus: "pending", delivery: { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } }, pickupPoint: { name: "Store", address: "Lima", instructions: null }, settingsVersion: 1, recordedBy: { kind: "seller", userId: "seller" } }, reason: "Se requiere descontar el stock antes de entregar." },
  { paymentStatus: "paid", stockDeducted: true, cancelled: true, deliveryStatus: "pending", reason: "El pedido está cancelado; no se puede enviar ni entregar." },
  { paymentStatus: "paid", stockDeducted: true, cancelled: false, deliveryStatus: "delivered", reason: "Solo se puede enviar desde pendiente y entregar desde pendiente o enviado." },
] as const)("fulfillment is blocked and explained: $reason", async ({ reason, ...state }) => {
  mockOrder = { ...initialOrder, ...state };
  const screen = render(<OrderDetailScreen />);
  if (state.cancelled) {
    await screen.findByText(/Pedido cancelado. Los pagos se conservan/);
    expect(screen.queryByRole("button", { name: "Marcar como despachado" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Marcar como entregado" })).toBeNull();
    return;
  }
  if (state.deliveryStatus === "delivered") {
    await screen.findByText("Entregado");
    expect(screen.queryByText(reason)).toBeNull();
  } else {
    await screen.findByText(reason);
    expect(screen.getAllByText(reason)).toHaveLength(1);
  }
  for (const name of ["Marcar enviado", "Marcar entregado"]) {
    expect(screen.queryByRole("button", { name })).toBeNull();
  }
  expect(mockShip).not.toHaveBeenCalled();
  expect(mockDeliver).not.toHaveBeenCalled();
});

test("fulfillment errors remain visible and requests can be retried without changing payments", async () => {
  mockOrder = { ...initialOrder, status: "active", deliveryStatus: "pending", deliveredAt: null, completedAt: null };
  let resolve: (result: unknown) => void = () => {};
  mockShip.mockImplementationOnce(() => new Promise(result => { resolve = result; }));
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Orden activa");
  fireEvent.press(screen.getByRole("button", { name: "Marcar como despachado" }));
  expect(screen.getByRole("button", { name: "Marcar como despachado" })).toBeDisabled();
  await act(async () => resolve({ success: false, error: { code: "PAYMENT_REQUIRED" } }));
  await screen.findByText("Se requiere al menos un pago para despachar.");
  expect(screen.getByText("Orden activa")).toBeTruthy();
  mockShip.mockRejectedValueOnce(new Error("Network failure"));
  fireEvent.press(screen.getByRole("button", { name: "Marcar como despachado" }));
  await screen.findByText("No se pudo actualizar el pedido. Inténtalo de nuevo.");
  mockShip.mockResolvedValue({ success: true, data: { ...mockOrder, deliveryStatus: "shipped" } });
  fireEvent.press(screen.getByRole("button", { name: "Marcar como despachado" }));
  await screen.findByText("Pedido marcado como enviado.");
  expect(mockRegisterPayment).not.toHaveBeenCalled();
  expect(mockVoidPayment).not.toHaveBeenCalled();
});

test('rated agency delivery shows its courier and catalog agency', async () => {
  await i18n.changeLanguage('es');
  mockOrder = { ...initialOrder, delivery: { method: 'agency',
    recipient: { name: 'Ana', phone: '999', identity: { kind: 'document', documentType: 'national_id', document: '12345678' } },
    destination: { country: 'PE', districtCode: '150122', district: 'Miraflores', province: 'Lima', department: 'Lima' },
    pricing: { quotationId: mockId, rateId: mockId, optionId: mockId, settingsVersion: 3 },
    courier: { id: mockId, name: 'Shalom' },
    agency: { id: mockId, name: 'Sucursal Miraflores', address: 'Av. Test 123', location: { country: 'PE', districtCode: '150122', district: 'Miraflores', province: 'Lima', department: 'Lima' } },
    recordedBy: { kind: 'buyer' } } };
  const screen = render(<OrderDetailScreen />);
  fireEvent.press(await screen.findByRole('button', { name: /Agencia/ }));
  expect(screen.getByText('Shalom')).toBeTruthy();
  expect(screen.getByText('Sucursal Miraflores')).toBeTruthy();
  expect(screen.getByText('Av. Test 123')).toBeTruthy();
  expect(screen.getByText('Miraflores, Lima')).toBeTruthy();
});

function pendingCancellationOrder() {
  mockOrder = { ...initialOrder, status: "active", deliveryStatus: "pending", deliveredAt: null, completedAt: null };
  return mockOrder;
}
function acceptCancellation(screen: ReturnType<typeof render>) {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  fireEvent.press(screen.getByRole("button", { name: "Cancelar pedido" }));
  const buttons = alert.mock.calls.at(-1)?.[2];
  act(() => buttons?.[1]?.onPress?.());
  alert.mockRestore();
}

test("native confirmation preserves the order on dismissal and only accepts an explicit confirmation", async () => {
  pendingCancellationOrder();
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Orden activa");
  fireEvent.press(screen.getByRole("button", { name: "Cancelar pedido" }));
  const [title, description, buttons, options] = alert.mock.calls[0];
  expect(title).toBe("¿Cancelar este pedido?");
  expect(description).toContain("no realiza un reembolso");
  expect(options?.cancelable).toBe(true);
  act(() => buttons?.[0]?.onPress?.());
  expect(mockCancel).not.toHaveBeenCalled();
  expect(screen.getByText("Orden activa")).toBeTruthy();
  alert.mockRestore();
});

test("confirmation survives detail refresh failure and keeps recorded payments visible", async () => {
  const original = pendingCancellationOrder();
  mockCancel.mockResolvedValue({ success: true, data: { kind: "cancelled", order: {
    id: mockId, status: "cancelled", cancelled: true, deliveryStatus: "pending", stockDeducted: true, deliveredAt: null, completedAt: null,
  } } });
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Orden activa");
  mockLoadFailed = true;
  acceptCancellation(screen);
  await screen.findByText("No pudimos actualizar el detalle. El estado confirmado se conserva.");
  expect(screen.getByText(/Pedido cancelado. Los pagos se conservan/)).toBeTruthy();
  expect(screen.queryByText("Entrega pendiente")).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Marcar como despachado" })).toBeNull();
  expect(screen.getAllByText(/Adelanto|confirmado/i).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Anular pago" })).toBeNull();
  expect(mockCancel).toHaveBeenCalledTimes(1);
  mockOrder = { ...original, status: "cancelled", cancelled: true };
  mockLoadFailed = false;
  mockCheckCancellation.mockResolvedValue({ success: true, data: { kind: "cancelled", order: mockOrder } });
  fireEvent.press(screen.getByRole("button", { name: "Consultar estado" }));
  await waitFor(() => expect(screen.queryByText("No pudimos actualizar el detalle. El estado confirmado se conserva.")).toBeNull());
  expect(mockCancel).toHaveBeenCalledTimes(1);
  expect(mockCheckCancellation).toHaveBeenCalledWith(mockId);
});

test.each(["NETWORK_ERROR", "RATE_LIMITED"])("%s uncertainty blocks writes and manual consultation resolves the dispatched conflict", async code => {
  pendingCancellationOrder();
  mockCancel.mockResolvedValue({ success: true, data: { kind: "uncertain", orderId: mockId, cause: { code, message: "Unable to verify" } } });
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Orden activa");
  acceptCancellation(screen);
  await screen.findByText(/No pudimos confirmar si se canceló/);
  for (const name of ["Cancelar pedido", "Anular pago", "Marcar como despachado", "Asignar datos"]) {
    expect(screen.getByRole("button", { name })).toBeDisabled();
    fireEvent.press(screen.getByRole("button", { name }));
  }
  expect(mockVoidPayment).not.toHaveBeenCalled(); expect(mockShip).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
  mockOrder = { ...mockOrder, deliveryStatus: "shipped" };
  mockCheckCancellation.mockResolvedValue({ success: true, data: { kind: "dispatched", order: { id: mockId, cancelled: false, status: "active", deliveryStatus: "shipped" } } });
  fireEvent.press(screen.getByRole("button", { name: "Consultar estado" }));
  await screen.findByText("El pedido ya fue enviado o entregado y no se puede cancelar.");
  expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull();
  expect(mockCancel).toHaveBeenCalledTimes(1);
});

test("repeated acceptance writes once and a response from the previous session is discarded", async () => {
  pendingCancellationOrder();
  let resolve!: (value: unknown) => void;
  mockCancel.mockReturnValue(new Promise(done => { resolve = done; }));
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Orden activa");
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  fireEvent.press(screen.getByRole("button", { name: "Cancelar pedido" }));
  const accept = alert.mock.calls[0][2]?.[1]?.onPress;
  act(() => { accept?.(); accept?.(); });
  expect(mockCancel).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Marcar como despachado" })).toBeDisabled();
  mockUserId = "another-seller";
  screen.rerender(<OrderDetailScreen />);
  await screen.findByText("Orden activa");
  await act(async () => resolve({ success: true, data: { kind: "cancelled", order: { id: mockId, status: "cancelled", cancelled: true, deliveryStatus: "pending", stockDeducted: true, deliveredAt: null, completedAt: null } } }));
  expect(screen.queryByText(/Pedido cancelado. Los pagos se conservan/)).toBeNull();
  expect(screen.getByText("Orden activa")).toBeTruthy();
  alert.mockRestore();
});


test.each([0, 4, 12])("mobile cancellation retains received amount %s after refreshing the detail", async received => {
  pendingCancellationOrder();
  mockOrder = { ...mockOrder, paidAmount: { amount: received, currency: "PEN" },
    balanceDue: { amount: 12 - received, currency: "PEN" }, paymentStatus: received === 12 ? "paid" : "pending", payments: received ? initialOrder.payments : [] };
  mockCancel.mockImplementation(async () => {
    mockOrder = { ...mockOrder, status: "cancelled", cancelled: true };
    return { success: true, data: { kind: "cancelled", order: mockOrder } };
  });
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Orden activa");
  acceptCancellation(screen);
  await screen.findByText("Orden cancelada");
  expect(screen.getAllByText(new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(received)).length).toBeGreaterThan(0);
  expect(screen.queryByText("Entrega pendiente")).toBeNull();
  expect(mockCancel).toHaveBeenCalledTimes(1);
});

test("Portuguese cancellation explains preservation and offers a safe exit", async () => {
  await i18n.changeLanguage("pt-BR");
  try {
    pendingCancellationOrder();
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const screen = render(<OrderDetailScreen />);
    await screen.findByText("Pedido ativo");
    fireEvent.press(screen.getByRole("button", { name: "Cancelar pedido" }));
    expect(alert.mock.calls[0][1]).toContain("não realiza um reembolso");
    expect(alert.mock.calls[0][2]?.[0].text).toBe("Manter pedido");
    expect(mockCancel).not.toHaveBeenCalled();
    screen.unmount(); alert.mockRestore();
  } finally { await i18n.changeLanguage("es"); }
});

// @ts-expect-error An in-flight cancellation requires an order identity.
const missingCancellationId: import("@mobile/features/orders/presentation/order-detail-screen").CancellationUiState = { kind: "submitting" };
void missingCancellationId;


test("a known cancellation failure restores the permitted interaction and translates the error", async () => {
  await i18n.changeLanguage("pt-BR");
  try {
    pendingCancellationOrder();
    mockCancel.mockResolvedValue({ success: false, error: { code: "UNAUTHENTICATED", message: "Expired" } });
    const screen = render(<OrderDetailScreen />);
    await screen.findByText("Pedido ativo");
    acceptCancellation(screen);
    await screen.findByText("Entre na sua conta para continuar.");
    expect(screen.getByRole("button", { name: "Cancelar pedido" })).not.toBeDisabled();
    expect(mockCheckCancellation).not.toHaveBeenCalled();
    expect(screen.queryByText(/Os pagamentos são mantidos/)).toBeNull();
    screen.unmount();
  } finally { await i18n.changeLanguage("es"); }
});

test("pending order reschedules and clears the dispatch date; shipped order has no editor", async () => {
  const pending = { ...initialOrder, status: "active" as const, completedAt: null, deliveredAt: null, deliveryStatus: "pending" as const, scheduledDispatchDate: "2026-10-15" };
  mockOrder = pending;
  mockUpdateShipping.mockImplementation(async (_id: string, input: { scheduledDispatchDate: string | null }) => ({ success: true, data: { ...pending, scheduledDispatchDate: input.scheduledDispatchDate } }));
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("day:2026-10-15");
  fireEvent.press(screen.getByText("pick"));
  await screen.findByText("day:2026-10-20");
  expect(mockUpdateShipping).toHaveBeenLastCalledWith(mockId, { scheduledDispatchDate: "2026-10-20" });
  fireEvent.press(screen.getByText("clear"));
  await screen.findByText("day:");
  expect(mockUpdateShipping).toHaveBeenLastCalledWith(mockId, { scheduledDispatchDate: null });
  screen.unmount();
  mockOrder = { ...pending, deliveryStatus: "shipped", shippedAt: "2026-10-16T15:00:00.000Z" };
  const shipped = render(<OrderDetailScreen />);
  await shipped.findByText(/Despachado el/);
  expect(shipped.queryByText("pick")).toBeNull();
  expect(shipped.getByText(/2026-10-15/)).toBeTruthy();
});

describe("WhatsApp orders", () => {
  const withBuyer = (buyer: { contactId: null; name: string | null; phone: string | null }) => { mockOrder = { ...initialOrder, source: "whatsapp", buyer }; };

  test("shows the WhatsApp icon with the accessible label \"WhatsApp\" for chat orders", async () => {
    withBuyer({ contactId: null, name: "Ana", phone: "999" });
    const screen = render(<OrderDetailScreen />);
    await screen.findByLabelText("WhatsApp");
    mockOrder = initialOrder;
  });

  test("shows the buyer as name or phone and hides a missing phone", async () => {
    withBuyer({ contactId: null, name: null, phone: "999111222" });
    const screen = render(<OrderDetailScreen />);
    await screen.findByText("999111222");
    expect(screen.getAllByText("999111222")).toHaveLength(1);
    screen.unmount();
    withBuyer({ contactId: null, name: "Ana", phone: null });
    const named = render(<OrderDetailScreen />);
    await named.findByText("Ana");
    expect(named.queryByText("—")).toBeNull();
  });

  test("shows only the icon when the buyer has no name or phone", async () => {
    withBuyer({ contactId: null, name: null, phone: null });
    const screen = render(<OrderDetailScreen />);
    await screen.findByLabelText("WhatsApp");
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByText("Público general")).toBeNull();
  });
});

describe("item accessibility label", () => {
  const withItem = (variantAttributes: Record<string, string>, sku: string | null) => {
    mockOrder = { ...initialOrder, items: [{ ...initialOrder.items[0], variantAttributes, sku, quantity: 1, unitPrice: { amount: 25, currency: "PEN" }, subtotal: { amount: 25, currency: "PEN" }, mentionedPrice: null }] };
  };

  test("has no empty slot when the item has neither variant attributes nor SKU", async () => {
    withItem({}, null);
    const screen = render(<OrderDetailScreen />);
    await screen.findByText("Camisa");
    expect(screen.getByLabelText(/^Camisa, 1 × S\/\s?25\.00, S\/\s?25\.00$/)).toBeTruthy();
  });

  test("speaks the variant and the SKU when both are present", async () => {
    withItem({ Talla: "M" }, "CAM-M");
    const screen = render(<OrderDetailScreen />);
    await screen.findByText("Camisa");
    expect(screen.getByLabelText(/^Camisa, Talla: M, SKU CAM-M, 1 × /)).toBeTruthy();
  });
});

describe("mentioned price", () => {
  const withMentioned = (amount: number, units: number, quantity = 3) => {
    const item = initialOrder.items[0];
    mockOrder = { ...initialOrder, items: [{ ...item, quantity, unitPrice: { amount: 25, currency: "PEN" }, subtotal: { amount: 25 * quantity, currency: "PEN" },
      mentionedPrice: { amount: { amount, currency: "PEN" }, units } }] };
  };

  test("shows the mentioned price note under the unit price and in the item's accessibility label", async () => {
    withMentioned(50, 3);
    const screen = render(<OrderDetailScreen />);
    await screen.findByText("El cliente mencionó S/ 50.00 por 3");
    expect(screen.getByLabelText(/Camisa.*3 × S\/\s?25\.00.*El cliente mencionó S\/\s?50\.00 por 3/)).toBeTruthy();
  });

  test("says «por unidad» for one unit and translates the note to Portuguese", async () => {
    withMentioned(20, 1, 1);
    const screen = render(<OrderDetailScreen />);
    await screen.findByText("El cliente mencionó S/ 20.00 por unidad");
    screen.unmount();
    await i18n.changeLanguage("pt-BR");
    try {
      const portuguese = render(<OrderDetailScreen />);
      await portuguese.findByText(/^O cliente mencionou \D*20,00 por unidade$/);
      portuguese.unmount();
    } finally {
      await i18n.changeLanguage("es");
    }
  });

  test("shows no note when the mentioned price equals the catalog price for the same units", async () => {
    withMentioned(75, 3);
    const screen = render(<OrderDetailScreen />);
    await screen.findByText("Camisa");
    expect(screen.queryByText(/El cliente mencionó/)).toBeNull();
  });
});

describe("notices arriving while the order is open", () => {
  const notice = { v: 1, companyId: "00000000-0000-4000-8000-000000000001", messageId: "7c9e6679-7425-40de-944b-e07fc1f90ae7", target: "order" };
  afterEach(() => { jest.useRealTimers(); });

  test("reloads the focused order detail once for a burst of notices", async () => {
    const screen = render(<OrderDetailScreen />);
    await screen.findByText("Camisa");
    jest.useFakeTimers();
    const loadsBefore = mockLoads;
    act(() => { mockArrival(notice); mockArrival(notice); mockArrival(notice); });
    act(() => { jest.advanceTimersByTime(1999); });
    expect(mockLoads).toBe(loadsBefore);
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(mockLoads).toBe(loadsBefore + 1);
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(mockLoads).toBe(loadsBefore + 1);
  });

  test("shows the refreshed order without replacing the screen by the loading state", async () => {
    const screen = render(<OrderDetailScreen />);
    await screen.findByText("Camisa");
    jest.useFakeTimers();
    mockOrder = { ...initialOrder, items: [{ ...initialOrder.items[0], productName: "Gorra" }] };
    act(() => { mockArrival(notice); });
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(screen.queryByText("Cargando venta")).toBeNull();
    expect(await screen.findByText("Gorra")).toBeTruthy();
  });

  test("reloads the order when a notice is tapped while that same order is already open", async () => {
    const screen = render(<OrderDetailScreen />);
    await screen.findByText("Camisa");
    const loadsBefore = mockLoads;
    mockOrder = { ...initialOrder, items: [{ ...initialOrder.items[0], productName: "Gorra" }] };
    mockNoticeAt = "1000";
    screen.rerender(<OrderDetailScreen />);
    expect(await screen.findByText("Gorra")).toBeTruthy();
    expect(mockLoads).toBe(loadsBefore + 1);
    mockNoticeAt = "1000";
    screen.rerender(<OrderDetailScreen />);
    expect(mockLoads).toBe(loadsBefore + 1);
  });

  test("stops listening and cancels a pending reload when the screen loses focus", async () => {
    const screen = render(<OrderDetailScreen />);
    await screen.findByText("Camisa");
    jest.useFakeTimers();
    const loadsBefore = mockLoads;
    act(() => { mockArrival(notice); });
    screen.unmount();
    expect(mockStopArrivals).toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(mockLoads).toBe(loadsBefore);
  });
});

const reportId = "00000000-0000-4000-8000-000000000099";
const receiptId = "00000000-0000-4000-8000-000000000098";
const report = { receiptImageId: receiptId, reportedAt: "2026-09-29T11:30:00.000Z" };
const reportedOrder = (overrides: Partial<OrderAggregateResponse> = {}): OrderAggregateResponse => ({ ...initialOrder, status: "active", paymentStatus: "pending",
  completedAt: null, paidAmount: { amount: 0, currency: "PEN" }, balanceDue: { amount: 12, currency: "PEN" }, deliveryStatus: "pending", stockDeducted: false,
  payments: [{ id: reportId, orderId: mockId, status: "reported", currency: "PEN", amount: null, method: null, data: report }], ...overrides });

test("labels a rejected payment as Pago rechazado with its reason and Ver captura", async () => {
  mockOrder = reportedOrder({ payments: [{ id: reportId, orderId: mockId, status: "rejected", currency: "PEN", amount: null, method: null,
    data: { report, rejectedAt: "2026-09-29T12:00:00.000Z", rejectedBy: "seller", reason: "El monto no coincide" } }] });
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Total");
  expect(screen.getByText(/Rechazado/)).toBeTruthy();
  expect(screen.getByText("El monto no coincide")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Ver captura/ })).toBeTruthy();
  expect(screen.queryByText(/confirmado/i)).toBeNull();
  expect(screen.queryByText("Pago por revisar")).toBeNull();
});

test("rejects a report from the review sheet with an optional reason", async () => {
  const rejected = reportedOrder({ payments: [{ id: reportId, orderId: mockId, status: "rejected", currency: "PEN", amount: null, method: null,
    data: { report, rejectedAt: "2026-09-29T12:00:00.000Z", rejectedBy: "seller", reason: "El monto no coincide" } }] });
  mockRejectPayment.mockResolvedValueOnce({ kind: "already_reviewed" }).mockResolvedValueOnce({ kind: "rejected", order: rejected });
  mockOrder = reportedOrder();
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("1 comprobante por revisar");
  fireEvent.press(screen.getByRole("button", { name: "1 comprobante por revisar" }));
  fireEvent.press(screen.getByRole("button", { name: "Revisar comprobante" }));
  fireEvent.press(screen.getByRole("button", { name: "Rechazar" }));
  expect(screen.getByText("¿Rechazar este comprobante?")).toBeTruthy();
  expect(screen.getByText("El saldo seguirá pendiente y el comprador podrá enviar otro comprobante.")).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText("Motivo (opcional, lo verá el comprador)"), "  El monto no coincide ");
  fireEvent.press(screen.getByRole("button", { name: "Rechazar comprobante" }));
  await screen.findByText("Este pago ya fue revisado.");
  expect(mockRejectPayment).toHaveBeenLastCalledWith(mockId, reportId, "El monto no coincide");
  await waitFor(() => expect(screen.getByRole("button", { name: "Rechazar comprobante" })).toBeEnabled());
  mockOrder = rejected;
  fireEvent.press(screen.getByRole("button", { name: "Rechazar comprobante" }));
  await waitFor(() => expect(mockRejectPayment).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText("¿Rechazar este comprobante?")).toBeNull(), { timeout: 5000 });
  expect(screen.getByText(/Rechazado/)).toBeTruthy();
  expect(screen.getByText("El monto no coincide")).toBeTruthy();
});

test("rejecting without a reason sends null and Volver returns to the review step", async () => {
  mockRejectPayment.mockResolvedValue({ kind: "unknown" });
  mockOrder = reportedOrder();
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("1 comprobante por revisar");
  fireEvent.press(screen.getByRole("button", { name: "1 comprobante por revisar" }));
  fireEvent.press(screen.getByRole("button", { name: "Revisar comprobante" }));
  fireEvent.press(screen.getByRole("button", { name: "Rechazar" }));
  fireEvent.press(screen.getByRole("button", { name: "Volver" }));
  expect(screen.getByRole("button", { name: "Confirmar pago" })).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Rechazar" }));
  fireEvent.press(screen.getByRole("button", { name: "Rechazar comprobante" }));
  await screen.findByText("No sabemos si se guardó. Revisa el pedido antes de repetir.");
  expect(mockRejectPayment).toHaveBeenCalledWith(mockId, reportId, null);
});

test("shows the partial stock box only when the amount is below the balance", async () => {
  mockOrder = reportedOrder();
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("1 comprobante por revisar");
  fireEvent.press(screen.getByRole("button", { name: "1 comprobante por revisar" }));
  fireEvent.press(screen.getByRole("button", { name: "Revisar comprobante" }));
  expect(screen.queryByLabelText("Descontar stock con abono parcial")).toBeNull();
  fireEvent.changeText(screen.getByLabelText(/Importe recibido/), "4.50");
  expect(screen.getByLabelText("Descontar stock con abono parcial")).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText(/Importe recibido/), "12");
  expect(screen.queryByLabelText("Descontar stock con abono parcial")).toBeNull();
});

test("hides the partial stock box when stock was already deducted", async () => {
  mockOrder = reportedOrder({ stockDeducted: true });
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("1 comprobante por revisar");
  fireEvent.press(screen.getByRole("button", { name: "1 comprobante por revisar" }));
  fireEvent.press(screen.getByRole("button", { name: "Revisar comprobante" }));
  fireEvent.changeText(screen.getByLabelText(/Importe recibido/), "4.50");
  expect(screen.queryByLabelText("Descontar stock con abono parcial")).toBeNull();
});

test("shows Pago por revisar while a report is pending", async () => {
  mockOrder = reportedOrder();
  const pending = render(<OrderDetailScreen />);
  await pending.findByText("Total");
  expect(pending.getByText("Pago por revisar")).toBeTruthy();
  pending.unmount();
  mockOrder = reportedOrder({ cancelled: true, status: "cancelled" });
  const cancelled = render(<OrderDetailScreen />);
  await cancelled.findByText("Total");
  expect(cancelled.queryByText("Pago por revisar")).toBeNull();
});

test.each([
  ["PAYMENT_CONFLICT", "Este pago ya fue revisado."],
  ["INVALID_TRANSITION", "Este pago ya fue revisado."],
  ["NETWORK_ERROR", "No sabemos si se guardó. Revisa el pedido antes de repetir."],
])("confirming from the review sheet answers %s with its message and reloads the order", async (code, message) => {
  const decided = reportedOrder({ payments: [{ id: reportId, orderId: mockId, status: "rejected", currency: "PEN", amount: null, method: null,
    data: { report, rejectedAt: "2026-09-29T12:00:00.000Z", rejectedBy: "seller", reason: "El monto no coincide" } }] });
  // Somebody else decided the report meanwhile: only a reload of the order can show it.
  mockRegisterPayment.mockImplementation(async () => { mockOrder = decided; return { success: false, error: { code } }; });
  mockOrder = reportedOrder();
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("1 comprobante por revisar");
  fireEvent.press(screen.getByRole("button", { name: "1 comprobante por revisar" }));
  fireEvent.press(screen.getByRole("button", { name: "Revisar comprobante" }));
  fireEvent.press(screen.getByRole("button", { name: "Confirmar pago" }));
  await screen.findByText(message);
  await screen.findByText(/Rechazado/);
  expect(mockRegisterPayment).toHaveBeenCalledTimes(1);
});

test("while the link loads the card says so instead of looking empty", async () => {
  let release: (value: unknown) => void = () => undefined;
  mockEnableCheckout.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const screen = render(<OrderDetailScreen />);
  expect(await screen.findByText("Cargando enlace…")).toBeTruthy();
  expect(screen.getByText("Enlace del pedido")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Copiar enlace" })).toBeNull();
  await act(async () => release({ success: true, data: { url: linkUrl } }));
  expect(await screen.findByText(linkUrl)).toBeTruthy();
  expect(screen.queryByText("Cargando enlace…")).toBeNull();
});

test("a completed order the buyer never confirmed shows no pending state, like the history", async () => {
  mockOrder = { ...initialOrder, checkoutEnabledAt: "2026-10-05T00:00:00.000Z" };
  const screen = render(<OrderDetailScreen />);
  await screen.findByText(linkUrl);
  expect(screen.queryByText("Pendiente de confirmación")).toBeNull();
  expect(screen.queryByText("Confirmado por el comprador")).toBeNull();
});

test("the copy confirmation is also announced for VoiceOver", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
  const screen = render(<OrderDetailScreen />);
  await screen.findByText(linkUrl);
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Copiar enlace" })));
  expect(announce).toHaveBeenCalledWith("Enlace copiado");
  announce.mockRestore();
});
