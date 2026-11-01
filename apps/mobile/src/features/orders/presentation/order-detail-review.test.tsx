import { AccessibilityInfo, Alert, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import { act, configure, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import type { OrderReviewResponse } from "@shared/contracts/order-review";
import OrderDetailScreen from "@mobile/features/orders/presentation/order-detail-screen";
import { emptyReview, fixtureId, reviewChange, reviewLine } from "@mobile/features/orders/testing/order-review-fixtures";

// A cold run (empty transform cache) loads the screen's modules lazily during the first renders, which outlasts the 1 s wait and 5 s test defaults.
configure({ asyncUtilTimeout: 8000 });
jest.setTimeout(30000);

const mockOrderId = "00000000-0000-4000-8000-000000000003";
const orderId = mockOrderId;
const linkUrl = "https://tienda.yoyos.test/checkout/abc";
const mockEnableCheckout = jest.fn();
const mockLoadReview = jest.fn();
const mockConfirm = jest.fn();
const mockUndo = jest.fn();
const mockRecord = jest.fn();
const mockEditItems = jest.fn();
const mockClear = jest.fn();
let mockOrder: OrderAggregateResponse;
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));
let mockUuid = 0;
jest.mock("expo-crypto", () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(1000 + ++mockUuid).padStart(12, "0")}` }));
jest.mock("expo-router/react-navigation", () => ({ usePreventRemove: jest.fn() }));
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }), useNavigation: () => ({ dispatch: jest.fn() }),
  useLocalSearchParams: () => ({ id: mockOrderId }),
  useFocusEffect: (callback: () => void) => { jest.requireActual("react").useEffect(callback, [callback]); } }));
jest.mock("@mobile/features/orders/composition", () => ({ orders: {
  editOrderItems: (...args: unknown[]) => mockEditItems(...args),
  enableOrderCheckout: (...args: unknown[]) => mockEnableCheckout(...args),
  loadOrderAggregate: async () => ({ success: true, data: mockOrder }),
  loadOrderReview: (...args: unknown[]) => mockLoadReview(...args),
  confirmOrderReview: (...args: unknown[]) => mockConfirm(...args),
  undoMessage: (...args: unknown[]) => mockUndo(...args),
  recordLinkAction: (...args: unknown[]) => mockRecord(...args),
} }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: {
  status: "ready", user: { id: "seller" }, company: { id: "00000000-0000-4000-8000-000000000001", country: "PE" },
} }) }));
jest.mock("@mobile/features/notifications/presentation/notices-provider", () => ({ useNotices: () => ({ watchArrivals: () => jest.fn() }) }));
jest.mock("@mobile/features/orders/presentation/dispatch-print-review", () => ({ useDispatchPrint: () => ({ open: jest.fn(), active: false, show: jest.fn() }) }));
jest.mock("@mobile/features/orders/presentation/order-result", () => ({ useOrderResult: () => ({ notice: null, clear: mockClear }) }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));

const pen = (amount: number) => ({ amount, currency: "PEN" as const });
const polera = { id: fixtureId(5), variantId: fixtureId(105), productName: "Polera gris", variantAttributes: { Talla: "M" }, sku: null, quantity: 1, unitPrice: pen(59), subtotal: pen(59), mentionedPrice: null };
const gorra = { id: fixtureId(6), variantId: fixtureId(106), productName: "Gorra trucker", variantAttributes: { Color: "Negro" }, sku: null, quantity: 2, unitPrice: pen(30), subtotal: pen(60), mentionedPrice: null };
const baseOrder: OrderAggregateResponse = { revisions: { items: "A".repeat(43) }, number: 1001, id: orderId, companyId: "00000000-0000-4000-8000-000000000001", sellerId: "seller",
  buyer: null, source: "manual", checkoutEnabledAt: null, checkoutConfirmedAt: null, scheduledDispatchDate: null, shippedAt: null, createdAt: "2026-10-31T11:00:00.000Z", deliveredAt: null, completedAt: null,
  cancelledAt: null, stockDeductedAt: null, status: "active", paymentStatus: "pending", paidAmount: pen(0), balanceDue: pen(119), overpaidAmount: pen(0), cancelled: false, delivery: null,
  deliveryStatus: "pending", stockDeducted: false, stockDue: null, itemsTotal: pen(119), deliveryCost: pen(0), deliveryCharge: pen(0), total: pen(119), payments: [], items: [polera, gorra] };

const polo = reviewLine(7, { itemId: polera.id, variantId: polera.variantId, productName: "Polera gris", variantAttributes: { Talla: "M" }, quantity: 1 });
const doubtChange = reviewChange(1, { messageId: fixtureId(301), kind: "variant_changed", before: { ...polo, variantAttributes: { Talla: "L" } }, after: polo,
  decision: { kind: "doubtful", reason: { kind: "variant_changed", attribute: "Talla", from: "L", to: "M" } } });
const pointFor = { pendingId: fixtureId(40), since: "2026-10-31T15:00:00.000Z", kind: "variant_missing" as const, product: "Polo básico", quantity: 2, missing: ["talla"], doubt: null,
  acknowledged: false, question: "¿En qué talla quieres el Polo básico: S, M o L?" };
const loadedFor = (overrides: Partial<OrderReviewResponse["loaded"]> = {}) => ({ changesThrough: 4, changeIds: [doubtChange.id], points: [], itemsRevision: "A".repeat(43), ...overrides });
const doubtfulReview = (overrides: Partial<OrderReviewResponse> = {}) => emptyReview({
  status: { openForMessages: true, toReview: true, doubtfulCount: 1, pointCount: 0, entry: "link", hasPreviousReview: false },
  doubtful: [{ change: doubtChange, quote: "la quiero en M" }], products: [{ itemId: gorra.id, changedSinceLastReview: false }], loaded: loadedFor(), ...overrides });
const confirmed = (overrides: Record<string, unknown> = {}) => ({ success: true, data: { version: 1, review: { id: fixtureId(900), origin: "link", correctedItems: 0, confirmedAt: "2026-10-31T16:00:00.000Z" },
  order: mockOrder, changedMeanwhile: [], total: pen(119), stockDue: null, ...overrides } });
const sentConfirmation = () => mockConfirm.mock.calls[0][1] as { id: string; origin: string; linkAction: unknown; loaded: unknown; corrections: unknown[] };

beforeEach(() => {
  mockOrder = baseOrder;
  mockEnableCheckout.mockReset(); mockEnableCheckout.mockResolvedValue({ success: true, data: { url: linkUrl } });
  mockLoadReview.mockReset(); mockLoadReview.mockResolvedValue({ success: true, data: emptyReview() });
  mockConfirm.mockReset(); mockUndo.mockReset(); mockRecord.mockReset(); mockRecord.mockResolvedValue({ success: true, data: undefined }); mockEditItems.mockReset();
  jest.mocked(Clipboard.setStringAsync).mockClear();
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
});
afterEach(() => { jest.restoreAllMocks(); });

const noPendings = { back: [], end: [] };
const showReview = (review: OrderReviewResponse) => { mockLoadReview.mockResolvedValue({ success: true, data: review }); };
const openScreen = async (copyLabel = "Copiar enlace") => { const screen = render(<OrderDetailScreen />); await screen.findByRole("button", { name: copyLabel }); return screen; };

test("the link card hides the URL and shows the count of doubtful changes and points", async () => {
  showReview(doubtfulReview({ status: { openForMessages: true, toReview: true, doubtfulCount: 1, pointCount: 1, entry: "link", hasPreviousReview: false }, points: [pointFor] }));
  const screen = await openScreen();
  expect(screen.queryByText(linkUrl)).toBeNull();
  expect(screen.getByText("Revisa el pedido antes de enviar el enlace.")).toBeTruthy();
  expect(screen.getByText("1 cambio con duda · 1 por resolver")).toBeTruthy();
  // The point and the mark show in the detail itself.
  expect(screen.getByText("Falta la variante: Polo básico ×2 — falta la talla. Pregúntale al cliente o agrégalo desde la web.")).toBeTruthy();
  expect(screen.getByText("¿En qué talla quieres el Polo básico: S, M o L?")).toBeTruthy();
  expect(screen.getByText("Con duda", { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByLabelText(/Polera gris, Talla: M.*con duda: un mensaje cambió la talla de L a M/)).toBeTruthy();
  // Revisar pedido is not a second entry on orders open for messages.
  expect(screen.queryByRole("button", { name: "Revisar pedido" })).toBeNull();
});

test("Copiar enlace on an order with something to review opens the review and copies after confirming", async () => {
  showReview(doubtfulReview());
  mockConfirm.mockResolvedValue(confirmed());
  const screen = await openScreen();
  fireEvent.press(screen.getByRole("button", { name: "Copiar enlace" }));
  await screen.findByText("Revisa el pedido #1001");
  expect(screen.getByText("Antes de enviar el enlace")).toBeTruthy();
  expect(screen.getByText("Cambios con duda")).toBeTruthy();
  expect(screen.getByText("El cliente escribió: “la quiero en M”")).toBeTruthy();
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole("button", { name: "Confirmar revisión" }));
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(linkUrl));
  expect(mockConfirm).toHaveBeenCalledTimes(1);
  expect(mockConfirm.mock.calls[0][0]).toBe(orderId);
  expect(sentConfirmation()).toMatchObject({ origin: "link", linkAction: null, loaded: doubtfulReview().loaded, corrections: [] });
  await waitFor(() => expect(mockRecord).toHaveBeenCalledWith(orderId, { id: expect.any(String), action: "copy" }));
  await waitFor(() => expect(screen.queryByText("Revisa el pedido #1001")).toBeNull());
});

test("the first link action of an order with only sure changes opens a review with products and total only", async () => {
  showReview(emptyReview({ status: { openForMessages: true, toReview: true, doubtfulCount: 0, pointCount: 0, entry: "link", hasPreviousReview: false },
    products: [{ itemId: polera.id, changedSinceLastReview: false }, { itemId: gorra.id, changedSinceLastReview: false }], loaded: loadedFor({ changeIds: [] }) }));
  mockConfirm.mockResolvedValue(confirmed());
  const screen = await openScreen();
  fireEvent.press(screen.getByRole("button", { name: "Compartir enlace" }));
  await screen.findByText("Revisa el pedido #1001");
  expect(within(screen.getByTestId("order-review-modal")).getByText("Productos")).toBeTruthy();
  expect(screen.queryByText("Cambios con duda")).toBeNull();
  expect(screen.queryByText("Por resolver")).toBeNull();
  expect(within(screen.getByTestId("order-review-modal")).getByText("Total")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Quitar/ })).toBeNull();
});

test("Deshacer mensaje is disabled while the review has corrections and enabled after Descartar correcciones", async () => {
  showReview(doubtfulReview({ messageRows: [{ messageId: doubtChange.messageId, at: "2026-10-31T20:42:00.000Z", changes: [doubtChange], pendings: noPendings, undo: { kind: "available" } }] }));
  const screen = await openScreen();
  fireEvent.press(screen.getByRole("button", { name: "Copiar enlace" }));
  await screen.findByText("Revisa el pedido #1001");
  const modal = within(screen.getByTestId("order-review-modal"));
  expect(modal.getByRole("button", { name: "Deshacer mensaje" }).props.accessibilityState.disabled).toBe(false);
  fireEvent.changeText(modal.getByLabelText("Cantidad de Polera gris"), "3");
  const undo = modal.getByRole("button", { name: "Deshacer mensaje" });
  expect(undo.props.accessibilityState.disabled).toBe(true);
  expect(modal.getByText("Confirma o descarta tus correcciones antes de deshacer un mensaje.")).toBeTruthy();
  fireEvent.press(modal.getByRole("button", { name: "Descartar correcciones" }));
  expect(modal.getByLabelText("Cantidad de Polera gris").props.value).toBe("1");
  expect(modal.getByRole("button", { name: "Deshacer mensaje" }).props.accessibilityState.disabled).toBe(false);
  expect(modal.queryByRole("button", { name: "Descartar correcciones" })).toBeNull();
});

test("the review does not offer Deshacer mensaje for a doubtful change whose message is not among the loaded rows", async () => {
  showReview(doubtfulReview({ messageRows: [], moreRows: 3 }));
  const screen = await openScreen();
  fireEvent.press(screen.getByRole("button", { name: "Copiar enlace" }));
  await screen.findByText("Revisa el pedido #1001");
  const modal = within(screen.getByTestId("order-review-modal"));
  expect(modal.getByLabelText("Cantidad de Polera gris")).toBeTruthy();
  expect(modal.queryByRole("button", { name: "Deshacer mensaje" })).toBeNull();
});

test("a confirmation answered REVIEW_OUTDATED reloads the review keeping corrections on untouched items", async () => {
  const second = reviewChange(2, { messageId: fixtureId(302), kind: "quantity_changed", before: reviewLine(8, { itemId: gorra.id, productName: "Gorra trucker", variantAttributes: { Color: "Negro" }, quantity: 1 }),
    after: reviewLine(8, { itemId: gorra.id, productName: "Gorra trucker", variantAttributes: { Color: "Negro" }, quantity: 2 }), decision: { kind: "doubtful", reason: { kind: "quantity_set", quantity: 2 } } });
  showReview(doubtfulReview({ doubtful: [{ change: doubtChange, quote: null }, { change: second, quote: null }], status: { openForMessages: true, toReview: true, doubtfulCount: 2, pointCount: 0, entry: "link", hasPreviousReview: false },
    loaded: loadedFor({ changeIds: [doubtChange.id, second.id] }) }));
  const screen = await openScreen();
  fireEvent.press(screen.getByRole("button", { name: "Copiar enlace" }));
  await screen.findByText("Revisa el pedido #1001");
  const modal = within(screen.getByTestId("order-review-modal"));
  fireEvent.changeText(modal.getByLabelText("Cantidad de Polera gris"), "3");
  fireEvent.changeText(modal.getByLabelText("Cantidad de Gorra trucker"), "5");
  const refreshed = doubtfulReview({ doubtful: [{ change: doubtChange, quote: null }, { change: second, quote: null }], status: { openForMessages: true, toReview: true, doubtfulCount: 2, pointCount: 0, entry: "link", hasPreviousReview: false },
    loaded: loadedFor({ changesThrough: 9, changeIds: [doubtChange.id, second.id] }) });
  mockConfirm.mockResolvedValueOnce({ success: false, error: { code: "REVIEW_OUTDATED", message: "outdated", affectedItemIds: [gorra.id], newPoints: 0 } });
  mockLoadReview.mockResolvedValue({ success: true, data: refreshed });
  fireEvent.press(modal.getByRole("button", { name: "Confirmar revisión" }));
  await modal.findByText("Llegó un mensaje mientras revisabas. Revisa lo marcado y confirma de nuevo.");
  expect(modal.getByLabelText("Cantidad de Polera gris").props.value).toBe("3");
  expect(modal.getByLabelText("Cantidad de Gorra trucker").props.value).toBe("2");
  expect(modal.getByText("Cambió mientras revisabas")).toBeTruthy();
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  mockConfirm.mockResolvedValueOnce(confirmed());
  fireEvent.press(modal.getByRole("button", { name: "Confirmar revisión" }));
  await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(2));
  expect(mockConfirm.mock.calls[1][1]).toMatchObject({ loaded: refreshed.loaded, corrections: [{ itemId: polera.id, quantity: 3 }] });
});

test("a confirmation after a sure message elsewhere copies the link and keeps the mientras revisabas line", async () => {
  showReview(doubtfulReview());
  const added = reviewChange(5, { kind: "added", before: null, after: reviewLine(9, { productName: "Gorra trucker", variantAttributes: { Color: "Rojo" }, quantity: 1 }) });
  mockConfirm.mockResolvedValue(confirmed({ changedMeanwhile: [added], total: pen(120) }));
  const screen = await openScreen();
  fireEvent.press(screen.getByRole("button", { name: "Copiar enlace" }));
  await screen.findByText("Revisa el pedido #1001");
  fireEvent.press(screen.getByRole("button", { name: "Confirmar revisión" }));
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(linkUrl));
  const line = await screen.findByText("Mientras revisabas, un mensaje agregó Gorra trucker · Rojo · ×1. Total: S/ 120.00.");
  expect(line.props.accessibilityLiveRegion).toBe("polite");
});

test("a review confirmation without connection keeps corrections and does not copy", async () => {
  showReview(doubtfulReview());
  mockConfirm.mockResolvedValue({ success: false, error: { code: "NETWORK_ERROR", message: "down" } });
  const screen = await openScreen();
  fireEvent.press(screen.getByRole("button", { name: "Copiar enlace" }));
  await screen.findByText("Revisa el pedido #1001");
  const modal = within(screen.getByTestId("order-review-modal"));
  fireEvent.changeText(modal.getByLabelText("Cantidad de Polera gris"), "3");
  fireEvent.press(modal.getByRole("button", { name: "Confirmar revisión" }));
  await modal.findByText("No se pudieron guardar los cambios. Revisa tu conexión e inténtalo de nuevo.");
  expect(modal.getByLabelText("Cantidad de Polera gris").props.value).toBe("3");
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  expect(mockRecord).not.toHaveBeenCalled();
  // Every repeat carried the same id.
  expect(new Set(mockConfirm.mock.calls.map((call) => (call[1] as { id: string }).id)).size).toBe(1);
});

test("a review confirmation in doubt repeats with the same id and runs the link action once saved", async () => {
  showReview(doubtfulReview());
  mockConfirm.mockResolvedValueOnce({ success: false, error: { code: "NETWORK_ERROR", message: "lost" } }).mockResolvedValueOnce(confirmed());
  const screen = await openScreen();
  fireEvent.press(screen.getByRole("button", { name: "Copiar enlace" }));
  await screen.findByText("Revisa el pedido #1001");
  fireEvent.press(screen.getByRole("button", { name: "Confirmar revisión" }));
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1));
  expect(mockConfirm).toHaveBeenCalledTimes(2);
  expect(mockConfirm.mock.calls[0][1]).toEqual(mockConfirm.mock.calls[1][1]);
  await waitFor(() => expect(mockRecord).toHaveBeenCalledTimes(1));
});

test("a dismissed share is not recorded as a link action", async () => {
  showReview(emptyReview({ status: { openForMessages: true, toReview: false, doubtfulCount: 0, pointCount: 0, entry: "link", hasPreviousReview: true } }));
  const share = jest.spyOn(Share, "share").mockResolvedValueOnce({ action: Share.dismissedAction }).mockResolvedValueOnce({ action: Share.sharedAction });
  const screen = await openScreen();
  expect(screen.getByText(linkUrl)).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Compartir enlace" }));
  await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
  expect(mockRecord).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole("button", { name: "Compartir enlace" }));
  await waitFor(() => expect(mockRecord).toHaveBeenCalledWith(orderId, { id: expect.any(String), action: "share" }));
});

test("Cambios por mensajes shows the refusal reason instead of Deshacer", async () => {
  const removed = reviewChange(3, { kind: "removed", before: reviewLine(3, { productName: "Gorra trucker", variantAttributes: { Color: "Negro" }, quantity: 2 }), after: null });
  showReview(emptyReview({ messageRows: [
    { messageId: fixtureId(310), at: "2026-10-31T20:42:00.000Z", changes: [removed], pendings: noPendings, undo: { kind: "refused", reason: "later_change" } },
    { messageId: fixtureId(311), at: "2026-10-31T20:50:00.000Z", changes: [removed], pendings: noPendings, undo: { kind: "refused", reason: "not_sold" } },
    { messageId: fixtureId(312), at: "2026-10-31T20:55:00.000Z", changes: [removed], pendings: noPendings, undo: { kind: "undone" } }] }));
  const screen = await openScreen();
  expect(screen.getByText("Cambios por mensajes")).toBeTruthy();
  expect(screen.getByText("Un cambio posterior tocó este producto.")).toBeTruthy();
  expect(screen.getByText("Gorra trucker · Negro ya no se vende.")).toBeTruthy();
  expect(screen.getByText("Deshecho")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Deshacer/ })).toBeNull();
});

test("Cambios por mensajes shows five rows and Ver más loads all of them", async () => {
  const row = (n: number) => ({ messageId: fixtureId(320 + n), at: "2026-10-31T20:42:00.000Z", changes: [reviewChange(n, { kind: "added", before: null, after: reviewLine(n, { productName: `Producto ${n}`, variantAttributes: {} }) })],
    pendings: noPendings, undo: { kind: "refused" as const, reason: "later_change" as const } });
  showReview(emptyReview({ messageRows: [1, 2, 3, 4, 5].map(row), moreRows: 2 }));
  const screen = await openScreen();
  expect(screen.getAllByText(/Producto \d/)).toHaveLength(5);
  mockLoadReview.mockResolvedValue({ success: true, data: emptyReview({ messageRows: [1, 2, 3, 4, 5, 6, 7].map(row) }) });
  fireEvent.press(screen.getByRole("button", { name: "Ver más" }));
  await screen.findByText(/Producto 7/);
  expect(mockLoadReview).toHaveBeenLastCalledWith(orderId, { allRows: true });
  expect(screen.queryByRole("button", { name: "Ver más" })).toBeNull();
});

test("Deshacer on a row asks its confirmation listing changes and pendings and marks the row Deshecho", async () => {
  const added = reviewChange(3, { messageId: fixtureId(330), kind: "added", before: null, after: reviewLine(3, { productName: "Gorra trucker", variantAttributes: { Color: "Negro" }, quantity: 2 }) });
  const row = { messageId: fixtureId(330), at: "2026-10-31T20:42:00.000Z", changes: [added] };
  const withPendings = { back: [{ kind: "variant_missing" as const, product: "Polo básico" }], end: [{ kind: "not_clear" as const, product: null }] };
  showReview(emptyReview({ messageRows: [{ ...row, pendings: withPendings, undo: { kind: "available" } }] }));
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const screen = await openScreen();
  fireEvent.press(screen.getByRole("button", { name: /^Deshacer mensaje de las .*Agregó Gorra trucker · Negro · ×2/ }));
  expect(alert).toHaveBeenCalledTimes(1);
  expect(alert.mock.calls[0][0]).toBe("¿Deshacer lo que hizo este mensaje?");
  expect(alert.mock.calls[0][1]).toContain("Quitar Gorra trucker · Negro · ×2");
  expect(alert.mock.calls[0][1]).toContain("Volverá: Falta la variante · Polo básico");
  expect(alert.mock.calls[0][1]).toContain("Terminará: Producto no claro");
  const buttons = alert.mock.calls[0][2] ?? [];
  expect(buttons.map((button) => button.text)).toEqual(["Conservar", "Deshacer cambios"]);
  expect(mockUndo).not.toHaveBeenCalled();
  mockUndo.mockResolvedValue({ success: true, data: { order: mockOrder, review: emptyReview({ messageRows: [{ ...row, pendings: noPendings, undo: { kind: "undone" } }] }) } });
  await act(async () => { buttons[1].onPress?.(); });
  expect(mockUndo).toHaveBeenCalledWith(orderId, fixtureId(330));
  await screen.findByText("Deshecho");
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("Cambios deshechos.");
});

test("a paid order with a doubtful item offers Revisar pedido with corrections and copies the link directly", async () => {
  mockOrder = { ...baseOrder, paymentStatus: "paid", paidAmount: pen(119), balanceDue: pen(0) };
  showReview(doubtfulReview({ status: { openForMessages: false, toReview: true, doubtfulCount: 1, pointCount: 0, entry: "detail", hasPreviousReview: false } }));
  mockConfirm.mockResolvedValue(confirmed({ review: { id: fixtureId(901), origin: "detail", correctedItems: 1, confirmedAt: "2026-10-31T16:00:00.000Z" } }));
  const screen = await openScreen();
  // The card is today's: the URL shows and the action runs directly.
  expect(screen.getByText(linkUrl)).toBeTruthy();
  expect(screen.getByText("1 cambio con duda")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Copiar enlace" }));
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(linkUrl));
  expect(screen.queryByText("Revisa el pedido #1001")).toBeNull();
  jest.mocked(Clipboard.setStringAsync).mockClear();
  fireEvent.press(screen.getByRole("button", { name: "Revisar pedido" }));
  await screen.findByText("Revisa el pedido #1001");
  expect(screen.queryByText("Antes de enviar el enlace")).toBeNull();
  const modal = within(screen.getByTestId("order-review-modal"));
  fireEvent.changeText(modal.getByLabelText("Cantidad de Polera gris"), "3");
  fireEvent.press(modal.getByRole("button", { name: "Confirmar revisión" }));
  await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
  expect(sentConfirmation()).toMatchObject({ origin: "detail", corrections: [{ itemId: polera.id, quantity: 3 }] });
  await waitFor(() => expect(screen.queryByText("Revisa el pedido #1001")).toBeNull());
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
});

test("a shipped order opens a read-only review with the lock text", async () => {
  mockOrder = { ...baseOrder, deliveryStatus: "shipped", shippedAt: "2026-10-31T15:00:00.000Z" };
  showReview(doubtfulReview({ status: { openForMessages: false, toReview: true, doubtfulCount: 1, pointCount: 0, entry: "detail", hasPreviousReview: false },
    messageRows: [{ messageId: doubtChange.messageId, at: "2026-10-31T20:42:00.000Z", changes: [doubtChange], pendings: noPendings, undo: { kind: "refused", reason: "order_moved_on" } }] }));
  mockConfirm.mockResolvedValue(confirmed());
  const screen = await openScreen();
  fireEvent.press(screen.getByRole("button", { name: "Revisar pedido" }));
  await screen.findByText("Revisa el pedido #1001");
  const modal = within(screen.getByTestId("order-review-modal"));
  expect(modal.getByText("El pedido ya se envió; los productos ya no se pueden cambiar.")).toBeTruthy();
  expect(modal.queryByLabelText("Cantidad de Polera gris")).toBeNull();
  expect(modal.queryByRole("button", { name: /^Quitar/ })).toBeNull();
  expect(modal.queryByRole("button", { name: "Deshacer mensaje" })).toBeNull();
  fireEvent.press(modal.getByRole("button", { name: "Confirmar revisión" }));
  await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
  expect(sentConfirmation()).toMatchObject({ origin: "detail", corrections: [] });
});

test("a cancelled order shows no marks and no review", async () => {
  mockOrder = { ...baseOrder, status: "cancelled", cancelled: true, cancelledAt: "2026-10-31T15:00:00.000Z" };
  showReview(doubtfulReview({ status: { openForMessages: false, toReview: true, doubtfulCount: 1, pointCount: 1, entry: "none", hasPreviousReview: false }, points: [pointFor] }));
  const screen = render(<OrderDetailScreen />);
  await screen.findByText("Pedido cancelado. Los pagos se conservan; no se realizó un reembolso. No se puede reabrir.");
  expect(screen.queryByText("Con duda", { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByText("Por resolver")).toBeNull();
  expect(screen.queryByRole("button", { name: "Revisar pedido" })).toBeNull();
});

test("an order without a chat shows no review, marks or Cambios por mensajes", async () => {
  const screen = await openScreen();
  expect(screen.getByText(linkUrl)).toBeTruthy();
  expect(screen.queryByText("Con duda", { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByText("Cambios por mensajes")).toBeNull();
  expect(screen.queryByRole("button", { name: "Revisar pedido" })).toBeNull();
});

test("link actions, Revisar pedido and Deshacer are disabled with their reason while editing", async () => {
  mockOrder = { ...baseOrder, paymentStatus: "paid", paidAmount: pen(119), balanceDue: pen(0) };
  showReview(doubtfulReview({ status: { openForMessages: false, toReview: true, doubtfulCount: 1, pointCount: 0, entry: "detail", hasPreviousReview: false },
    messageRows: [{ messageId: doubtChange.messageId, at: "2026-10-31T20:42:00.000Z", changes: [doubtChange], pendings: noPendings, undo: { kind: "available" } }] }));
  const screen = await openScreen();
  fireEvent.press(screen.getByRole("button", { name: "Editar productos" }));
  for (const name of ["Copiar enlace", "Compartir enlace", "Abrir enlace", "Revisar pedido"])
    expect(screen.getByRole("button", { name }).props.accessibilityState.disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Revisar pedido" }).props.accessibilityHint).toBe("Guarda o descarta los cambios primero.");
  const undo = screen.getByRole("button", { name: /^Deshacer mensaje de las/ });
  expect(undo.props.accessibilityState.disabled).toBe(true);
  expect(undo.props.accessibilityHint).toBe("Guarda o descarta los cambios primero.");
});
