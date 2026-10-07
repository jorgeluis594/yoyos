import { Alert } from "react-native";
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
const mockShip = jest.fn();
const mockDeliver = jest.fn();
const mockCancel = jest.fn();
const mockCheckCancellation = jest.fn();
let mockUserId = "seller";
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));
const initialOrder: OrderAggregateResponse = { number: 1001, id: mockId, companyId: "00000000-0000-4000-8000-000000000001", sellerId: "seller",
  buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null, checkoutDeliveryRequest: null, createdAt: "2026-09-29T11:00:00.000Z", deliveredAt: "2026-09-29T12:00:00.000Z", completedAt: "2026-09-29T12:00:00.000Z",
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
beforeEach(() => { mockUserId = "seller"; mockCancel.mockReset(); mockCheckCancellation.mockReset(); mockOrder = initialOrder; mockNotice = null; mockCountry = "PE"; mockPush.mockReset(); mockLoadFailed = false; mockEnableCheckout.mockReset(); mockShip.mockReset(); mockDeliver.mockReset(); mockRegisterPayment.mockReset(); mockVoidPayment.mockReset(); jest.mocked(Clipboard.setStringAsync).mockResolvedValue(true); });

jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), push: mockPush }),
  useLocalSearchParams: () => ({ id: mockId }),
  useFocusEffect: (callback: () => void) => { mockFocus = callback; jest.requireActual("react").useEffect(callback, [callback]); } }));
jest.mock("@mobile/features/orders/composition", () => ({ orders: {
  cancelOrder: (...args: unknown[]) => mockCancel(...args),
  checkCancellation: (...args: unknown[]) => mockCheckCancellation(...args),
  ship: (...args: unknown[]) => mockShip(...args),
  deliver: (...args: unknown[]) => mockDeliver(...args),
  enableOrderCheckout: (...args: unknown[]) => mockEnableCheckout(...args),
  loadOrderAggregate: async () => mockLoadFailed ? ({ success: false, error: { code: "NETWORK_ERROR" } }) : ({ success: true, data: mockOrder }),
  clearPendingOrderConfirmation: async () => ({ success: true, data: undefined }),
  registerPayment: (...args: unknown[]) => mockRegisterPayment(...args),
  voidPayment: (...args: unknown[]) => mockVoidPayment(...args),
} }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: {
  status: "ready", user: { id: mockUserId }, company: { id: "00000000-0000-4000-8000-000000000001", country: mockCountry },
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
  expect(screen.getByText("Saldo pendiente")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Detalles internos" }));
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
  await screen.findByText("1 comprobante por revisar");
  expect(screen.queryByLabelText(/Importe recibido/)).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "1 comprobante por revisar" }));
  fireEvent.press(screen.getByRole("button", { name: "Revisar comprobante" }));
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
  fireEvent.press(screen.getByRole("button", { name: "Ver pagos" }));
  fireEvent.press(screen.getByRole("button", { name: "Anular pago" }));
  await waitFor(() => expect(mockVoidPayment).toHaveBeenCalledWith(mockId, initialOrder.payments[0].id));
});

test("manual payment opens on demand, validates input and updates the summary after confirmation", async () => {
  mockOrder = { ...initialOrder, status: "active", completedAt: null, paymentStatus: "pending", payments: [],
    paidAmount: { amount: 0, currency: "PEN" }, balanceDue: { amount: 12, currency: "PEN" } };
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Saldo pendiente");
  expect(screen.queryByLabelText(/Importe recibido/)).toBeNull();
  expect(screen.queryByText("Stock descontado")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Registrar pago" }));
  expect(screen.getByLabelText(/Importe recibido/).props.value).toBe("12.00");
  fireEvent.changeText(screen.getByLabelText(/Importe recibido/), "0");
  fireEvent.press(screen.getByRole("button", { name: "Confirmar pago" }));
  await screen.findByText("Ingresa un importe positivo con hasta dos decimales.");
  expect(mockRegisterPayment).not.toHaveBeenCalled();
  mockRegisterPayment.mockResolvedValue({ success: true, data: { order: initialOrder } });
  fireEvent.changeText(screen.getByLabelText(/Importe recibido/), "12.00");
  fireEvent.press(screen.getByRole("button", { name: "Confirmar pago" }));
  await screen.findByText("Pago cubierto");
  expect(screen.queryByLabelText(/Importe recibido/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Registrar pago" })).toBeNull();
  expect(screen.getByText("Pago confirmado")).toBeTruthy();
  expect(mockRegisterPayment).toHaveBeenCalledWith(mockId, expect.objectContaining({
    source: "manual", amount: { amount: 12, currency: "PEN" },
  }));
});

test("closing the payment form does not register a payment and cancelled orders cannot open it", async () => {
  mockOrder = { ...initialOrder, status: "active", paymentStatus: "pending", balanceDue: { amount: 12, currency: "PEN" } };
  const screen = render(<OrderDetailScreen />);
  fireEvent.press(await screen.findByRole("button", { name: "Registrar pago" }));
  fireEvent.changeText(screen.getByLabelText(/Importe recibido/), "4");
  fireEvent.press(screen.getByRole("button", { name: "Cerrar" }));
  expect(screen.queryByLabelText(/Importe recibido/)).toBeNull();
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
    expect(detail.getByText('Saldo pendente')).toBeTruthy();
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
  await screen.findByRole("button", { name: "Tienda" });
  fireEvent.press(screen.getByRole("button", { name: "Tienda" }));
  fireEvent.press(screen.getByRole("button", { name: "Detalles internos" }));
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
  await screen.findByRole("button", { name: "Domicilio" });
  fireEvent.press(screen.getByRole("button", { name: "Domicilio" }));
  fireEvent.press(screen.getByRole("button", { name: "Detalles internos" }));
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
  await screen.findByRole("button", { name: "Agencia" });
  fireEvent.press(screen.getByRole("button", { name: "Agencia" }));
  expect(screen.getByText("Historic courier")).toBeTruthy();
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
  fireEvent.press(screen.getByRole("button", { name: "Confirmación del comprador" }));
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
  fireEvent.press(confirmed.getByRole("button", { name: "Confirmación del comprador" }));
  fireEvent.press(confirmed.getByText("Obtener enlace"));
  await confirmed.findByText("No se pudo obtener el enlace. Inténtalo de nuevo.");
  expect(confirmed.queryByText("Copiar enlace")).toBeNull();
  confirmed.unmount();
  mockOrder = { ...mockOrder, cancelled: true, status: "cancelled" };
  const cancelled = render(<OrderDetailScreen />);
  await cancelled.findByText("Pedido cancelado");
  expect(cancelled.queryByText("Obtener enlace")).toBeNull();
});


test.each([null, "store"] as const)("seller delivers directly from pending with %s delivery and keeps payments", async method => {
  mockOrder = { ...initialOrder, status: "active", deliveryStatus: "pending", deliveredAt: null, completedAt: null,
    delivery: method === "store" ? { method, recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } },
      pickupPoint: { name: "Tienda", address: "Lima", instructions: null }, recordedBy: { kind: "seller", userId: "seller" } } : null };
  mockDeliver.mockResolvedValue({ success: true, data: { ...mockOrder, status: "completed", deliveryStatus: "delivered", completedAt: initialOrder.completedAt, deliveredAt: initialOrder.deliveredAt } });
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Orden activa");
  fireEvent.press(screen.getByRole("button", { name: "Marcar entregado" }));
  await screen.findByText("Pedido marcado como entregado.");
  expect(screen.getByText("Venta completada")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Detalles internos" }));
  expect(screen.getByText(/Completada el/)).toBeTruthy();
  expect(screen.getByText("Pago cubierto")).toBeTruthy();
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
  fireEvent.press(screen.getByRole("button", { name: "Marcar enviado" }));
  await screen.findByText("Pedido marcado como enviado.");
  expect(screen.getByText("Pago cubierto")).toBeTruthy();
  expect(screen.getByText("Despachado")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Marcar enviado" })).toBeDisabled();
  fireEvent.press(screen.getByRole("button", { name: "Marcar entregado" }));
  await screen.findByText("Pedido marcado como entregado.");
  expect(screen.getByText("Venta completada")).toBeTruthy();
  expect(mockShip).toHaveBeenCalledWith(mockId);
  expect(mockRegisterPayment).not.toHaveBeenCalled();
  expect(mockVoidPayment).not.toHaveBeenCalled();
});

test.each([
  { paymentStatus: "pending", stockDeducted: true, cancelled: false, deliveryStatus: "pending", reason: "Se requiere el pago completo antes de enviar o entregar." },
  { paymentStatus: "paid", stockDeducted: false, cancelled: false, deliveryStatus: "pending", reason: "Se requiere descontar el stock antes de enviar o entregar." },
  { paymentStatus: "paid", stockDeducted: true, cancelled: true, deliveryStatus: "pending", reason: "El pedido está cancelado; no se puede enviar ni entregar." },
  { paymentStatus: "paid", stockDeducted: true, cancelled: false, deliveryStatus: "delivered", reason: "Solo se puede enviar desde pendiente y entregar desde pendiente o enviado." },
] as const)("fulfillment is blocked and explained: $reason", async ({ reason, ...state }) => {
  mockOrder = { ...initialOrder, ...state };
  const screen = render(<OrderDetailScreen />);
  if (state.cancelled) {
    await screen.findByText(/Pedido cancelado. Los pagos se conservan/);
    expect(screen.queryByRole("button", { name: "Marcar enviado" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Marcar entregado" })).toBeNull();
    return;
  }
  await screen.findAllByText(reason);
  for (const name of ["Marcar enviado", "Marcar entregado"]) {
    const button = screen.getByRole("button", { name });
    expect(button).toBeDisabled();
    fireEvent.press(button);
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
  fireEvent.press(screen.getByRole("button", { name: "Marcar enviado" }));
  expect(screen.getByRole("button", { name: "Marcar entregado" })).toBeDisabled();
  await act(async () => resolve({ success: false, error: { code: "PAYMENT_REQUIRED" } }));
  await screen.findByText("Se requiere el pago completo antes de enviar o entregar.");
  expect(screen.getByText("Orden activa")).toBeTruthy();
  mockShip.mockRejectedValueOnce(new Error("Network failure"));
  fireEvent.press(screen.getByRole("button", { name: "Marcar enviado" }));
  await screen.findByText("No se pudo actualizar el pedido. Inténtalo de nuevo.");
  mockShip.mockResolvedValue({ success: true, data: { ...mockOrder, deliveryStatus: "shipped" } });
  fireEvent.press(screen.getByRole("button", { name: "Marcar enviado" }));
  await screen.findByText("Pedido marcado como enviado.");
  expect(mockRegisterPayment).not.toHaveBeenCalled();
  expect(mockVoidPayment).not.toHaveBeenCalled();
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
  expect(screen.queryByRole("button", { name: "Marcar enviado" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Ver pagos" }));
  expect(screen.getByText("Pago confirmado")).toBeTruthy();
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

test("uncertainty blocks writes and manual consultation resolves the dispatched conflict", async () => {
  pendingCancellationOrder();
  mockCancel.mockResolvedValue({ success: true, data: { kind: "uncertain", orderId: mockId, cause: { code: "NETWORK_ERROR", message: "Offline" } } });
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Orden activa");
  fireEvent.press(screen.getByRole("button", { name: "Ver pagos" }));
  fireEvent.press(screen.getByRole("button", { name: "Confirmación del comprador" }));
  acceptCancellation(screen);
  await screen.findByText(/No pudimos confirmar si se canceló/);
  for (const name of ["Cancelar pedido", "Anular pago", "Marcar enviado", "Asignar entrega", "Obtener enlace"]) {
    expect(screen.getByRole("button", { name })).toBeDisabled();
    fireEvent.press(screen.getByRole("button", { name }));
  }
  expect(mockVoidPayment).not.toHaveBeenCalled(); expect(mockShip).not.toHaveBeenCalled();
  expect(mockEnableCheckout).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
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
  expect(screen.getByRole("button", { name: "Marcar enviado" })).toBeDisabled();
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
