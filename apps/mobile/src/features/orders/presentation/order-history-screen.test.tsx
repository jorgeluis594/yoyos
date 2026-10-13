import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { orders } from "@mobile/features/orders/composition";
import { err, ok } from "@shared/functional";
import OrderHistoryScreen from "@mobile/features/orders/presentation/order-history-screen";
import i18n from "@mobile/i18n";

const mockPush = jest.fn();
const mockLoadOrders = jest.fn();
const mockReadPending = jest.fn();
let mockCountry = "PE";
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }),
  useFocusEffect: (callback: () => void) => jest.requireActual("react").useEffect(callback, [callback]) }));
jest.mock("@mobile/features/orders/composition", () => ({ orders: {
  loadMixedOrders: (...args: unknown[]) => mockLoadOrders(...args),
  readPendingOrderConfirmation: (...args: unknown[]) => mockReadPending(...args),
} }));
const mockOpenDispatchPrint = jest.fn();
jest.mock("@mobile/features/orders/presentation/dispatch-print-review", () => ({ useDispatchPrint: () => ({ open: mockOpenDispatchPrint, active: false, show: jest.fn() }) }));
const mockSettings = jest.fn();
jest.mock("@mobile/features/delivery-settings/composition", () => ({ deliverySettings: { get: (...args: unknown[]) => mockSettings(...args) } }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: {
  status: "ready", company: { id: "00000000-0000-4000-8000-000000000001", name: "Mi tienda", country: mockCountry },
} }) }));
jest.mock("@mobile/features/orders/presentation/order-result", () => ({ useOrderResult: () => ({ show: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));

beforeEach(() => { jest.clearAllMocks(); mockCountry = "PE"; mockReadPending.mockResolvedValue(ok(null));
  mockSettings.mockResolvedValue(ok({ couriers: [{ id: "00000000-0000-4000-8000-0000000000c1", courierId: "00000000-0000-4000-8000-0000000000c2", name: "Olva", enabled: false }] })); mockLoadOrders.mockResolvedValue(ok({ items: [], page: 1, pageSize: 20, total: 0 })); });

test("history distinguishes empty sales from filtered results and sends full Lima days", async () => {
  const screen = render(<OrderHistoryScreen />);
  await screen.findByText("Aún no hay pedidos");
  fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
  fireEvent.press(screen.getByRole("button", { name: "Desde: Elegir día" }));
  fireEvent(screen.getByTestId("order-desde-picker"), "onValueChange", {}, new Date(2026, 8, 28, 12));
  fireEvent.press(screen.getByRole("button", { name: "Hasta: Elegir día" }));
  fireEvent(screen.getByTestId("order-hasta-picker"), "onValueChange", {}, new Date(2026, 8, 28, 12));
  fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
  await screen.findByText("Sin resultados");
  await waitFor(() => expect(mockLoadOrders).toHaveBeenLastCalledWith({ page: 1, customer: { kind: "all" },
    fromDay: "2026-09-28", throughDay: "2026-09-28" }));
  fireEvent.press(screen.getByRole("button", { name: "Nuevo pedido" }));
  expect(mockPush).toHaveBeenCalledWith("/orders/new");
});

test("a Chile company can open order history", async () => {
  mockCountry = "CL";
  const screen = render(<OrderHistoryScreen />);
  await screen.findByText("Aún no hay pedidos");
  expect(mockLoadOrders).toHaveBeenCalledWith({ page: 1, customer: { kind: "all" } });
});

test("history translates empty state and filters to Portuguese", async () => {
  await i18n.changeLanguage('pt-BR');
  try {
    const screen = render(<OrderHistoryScreen />);
    await screen.findByText('Ainda não há pedidos');
    expect(screen.getByRole('button', { name: 'Novo pedido' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Filtros' }));
    expect(screen.getByRole('button', { name: 'Público geral' })).toBeTruthy();
  } finally {
    cleanup();
    await i18n.changeLanguage('es');
  }
});

test("history moves between pages and opens the selected detail", async () => {
  const summary = (number: number) => ({ number: 1000 + number, id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null, scheduledDispatchDate: null, shippedAt: null, createdAt: "2026-09-28T12:00:00.000Z", deliveredAt: null, completedAt: null,
    status: "active", paymentStatus: "pending", deliveryStatus: "pending", stockDeducted: false,
    total: { amount: number, currency: "PEN" } });
  mockLoadOrders.mockImplementation(async ({ page }: { page: number }) => ok({
    items: page === 1 ? Array.from({ length: 20 }, (_, index) => summary(index + 1)) : [summary(21)],
    page, pageSize: 20, total: 21,
  }));
  const screen = render(<OrderHistoryScreen />);
  await screen.findByRole("button", { name: "Siguiente" });
  fireEvent.press(screen.getByRole("button", { name: "Siguiente" }));
  await waitFor(() => expect(mockLoadOrders).toHaveBeenLastCalledWith({ page: 2, customer: { kind: "all" } }));
  await screen.findByRole("button", { name: "Anterior" });
  fireEvent.press(screen.getByText(/21[.,]00/));
  expect(mockPush).toHaveBeenCalledWith("/orders/00000000-0000-4000-8000-000000000021");
});

test("history offers retry after a load error", async () => {
  mockLoadOrders.mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "Offline" }))
    .mockResolvedValueOnce(ok({ items: [], page: 1, pageSize: 20, total: 0 }));
  const screen = render(<OrderHistoryScreen />);
  await screen.findByText("No se pudieron cargar los pedidos");
  fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
  await screen.findByText("Aún no hay pedidos");
});

test.each(["success", "error"])("history ignores a replaced request's %s before and after the latest load", async (outcome) => {
  type ListResult = Awaited<ReturnType<typeof orders.loadMixedOrders>>;
  const requests: ((result: ListResult) => void)[] = [];
  mockLoadOrders.mockImplementation(() => new Promise<ListResult>((resolve) => requests.push(resolve)));
  mockReadPending.mockResolvedValueOnce(err({ code: "PENDING_STORAGE_UNAVAILABLE", message: "Unavailable" }));
  const screen = render(<OrderHistoryScreen />);
  fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
  fireEvent.press(screen.getByRole("button", { name: "Público general" }));
  fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
  const stale: ListResult = outcome === "error" ? err({ code: "NETWORK_ERROR", message: "Offline" }) : ok({
    items: [{ number: 1001, id: "old", sellerId: "seller", source: "manual", buyer: { contactId: "contact", name: "Venta anterior", phone: "999999999" }, checkoutEnabledAt: null, checkoutConfirmedAt: null, scheduledDispatchDate: null, shippedAt: null,
      createdAt: "2026-09-28T12:00:00.000Z", deliveredAt: null, completedAt: null, status: "active", paymentStatus: "pending",
      deliveryStatus: "pending", stockDeducted: false, total: { amount: 10, currency: "PEN" } }], page: 1, pageSize: 20, total: 80,
  });
  await act(async () => { requests[0](stale); });
  expect(screen.getByText("Cargando pedidos")).toBeTruthy();
  expect(screen.queryByText("No se pudo leer la venta pendiente")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
  fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
  await act(async () => { requests[2](ok({
    items: [{ number: 1002, id: "latest", sellerId: "seller", source: "manual", buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null, scheduledDispatchDate: null, shippedAt: null, createdAt: "2026-09-29T12:00:00.000Z",
      deliveredAt: null, completedAt: null, status: "active", paymentStatus: "pending", deliveryStatus: "pending", stockDeducted: false,
      total: { amount: 20, currency: "PEN" } }],
    page: 1, pageSize: 20, total: 1,
  })); });
  await act(async () => { requests[1](stale); });
  expect(screen.getByText("1 pedido")).toBeTruthy();
  expect(screen.queryByText("Venta anterior")).toBeNull();
  expect(screen.queryByText("No se pudieron cargar los pedidos")).toBeNull();
  expect(screen.queryByRole("button", { name: "Siguiente" })).toBeNull();
  fireEvent.press(screen.getByText(/20[.,]00/));
  expect(mockPush).toHaveBeenCalledWith("/orders/latest");
});

test("history distinguishes checkout states and preserves numbers beyond 9999", async () => {
  const date = "2026-10-05T00:00:00.000Z";
  const states = [
    { number: 1001, checkoutEnabledAt: null, checkoutConfirmedAt: null, scheduledDispatchDate: null, shippedAt: null, status: "active" },
    { number: 9999, checkoutEnabledAt: date, checkoutConfirmedAt: null, scheduledDispatchDate: null, shippedAt: null, status: "active" },
    { number: 10000, checkoutEnabledAt: date, checkoutConfirmedAt: date, status: "active" },
    { number: 10001, checkoutEnabledAt: date, checkoutConfirmedAt: date, status: "cancelled" },
  ];
  mockLoadOrders.mockResolvedValue(ok({ page: 1, pageSize: 20, total: 4, items: states.map((state) => ({
    ...state, id: String(state.number), buyer: null, createdAt: date, completedAt: null,
    paymentStatus: "pending", deliveryStatus: "pending", stockDeducted: false, total: { amount: 10, currency: "PEN" },
  })) }));
  const screen = render(<OrderHistoryScreen />);
  await screen.findByText(/#10000 ·/);
  expect(screen.getByText("Confirmado por el comprador")).toBeTruthy();
  expect(screen.getByText("Pendiente de confirmación")).toBeTruthy();
  expect(screen.getByText("Pedido cancelado")).toBeTruthy();
  expect(screen.getByText(/#1001 ·/)).toBeTruthy();
});


test("search and task filters query all orders and remain selected after clearing advanced filters", async () => {
  const screen = render(<OrderHistoryScreen />);
  await screen.findByText("Aún no hay pedidos");
  fireEvent.changeText(screen.getByLabelText("Buscar cliente o pedido"), "#1005");
  await waitFor(() => expect(mockLoadOrders).toHaveBeenLastCalledWith({ page: 1, customer: { kind: "all" }, search: "#1005" }));
  fireEvent.press(screen.getByRole("button", { name: "Por cobrar" }));
  await waitFor(() => expect(mockLoadOrders).toHaveBeenLastCalledWith({ page: 1, customer: { kind: "all" }, search: "#1005", view: "unpaid" }));
  expect(screen.getByRole("button", { name: "Por cobrar" }).props.accessibilityState.selected).toBe(true);
  fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
  fireEvent.press(screen.getByRole("button", { name: "Público general" }));
  fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
  await waitFor(() => expect(mockLoadOrders).toHaveBeenLastCalledWith({ page: 1, customer: { kind: "general_public" }, search: "#1005", view: "unpaid" }));
  fireEvent.press(screen.getByRole("button", { name: "Limpiar filtros" }));
  await waitFor(() => expect(mockLoadOrders).toHaveBeenLastCalledWith({ page: 1, customer: { kind: "all" }, search: "#1005", view: "unpaid" }));
  fireEvent.press(screen.getByRole("button", { name: "Borrar búsqueda" }));
  await waitFor(() => expect(mockLoadOrders).toHaveBeenLastCalledWith({ page: 1, customer: { kind: "all" }, search: "", view: "unpaid" }));
});

const dispatchOrder = (number: number) => ({ number: 1000 + number, id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`, buyer: null, source: "manual",
  checkoutEnabledAt: null, checkoutConfirmedAt: null, scheduledDispatchDate: number === 1 ? "2026-10-20" : null, courier: number <= 2 ? { id: "00000000-0000-4000-8000-0000000000c1", name: "Olva" } : null, shippedAt: null, createdAt: "2026-09-28T12:00:00.000Z",
  deliveredAt: null, completedAt: null, status: "active", paymentStatus: "pending", deliveryStatus: "pending", stockDeducted: false, total: { amount: number, currency: "PEN" } });
const pagedOrders = () => mockLoadOrders.mockImplementation(async ({ page }: { page: number }) => ok({
  items: page === 1 ? Array.from({ length: 20 }, (_, index) => dispatchOrder(index + 1)) : [dispatchOrder(21)], page, pageSize: 20, total: 21 }));

test("dispatch filters, including disabled couriers and Sin programar, reach the query", async () => {
  const screen = render(<OrderHistoryScreen />);
  await screen.findByText("Aún no hay pedidos");
  fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
  fireEvent.press(screen.getByRole("button", { name: "Despachado" }));
  fireEvent.press(await screen.findByRole("button", { name: "Olva" }));
  fireEvent.press(screen.getByRole("button", { name: "Sin programar" }));
  expect(screen.queryByRole("button", { name: /Programado desde/ })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
  await waitFor(() => expect(mockLoadOrders).toHaveBeenLastCalledWith({ page: 1, customer: { kind: "all" }, deliveryStatus: "shipped",
    courierId: "00000000-0000-4000-8000-0000000000c1", unscheduled: true }));
});

const pressOrder = (screen: ReturnType<typeof render>, number: number, long = false) => {
  const row = screen.getByText(new RegExp(`#${number} ·`)).parent!.parent!;
  fireEvent(row, long ? "longPress" : "press");
};

test("long press enters selection mode; taps toggle without navigating; unselecting the last exits", async () => {
  pagedOrders();
  const screen = render(<OrderHistoryScreen />);
  await screen.findByRole("button", { name: "Siguiente" });
  expect(screen.queryByText("Seleccionar todos")).toBeNull();
  expect(screen.queryByText(/seleccionados/)).toBeNull();
  pressOrder(screen, 1001);
  expect(mockPush).toHaveBeenCalledTimes(1);
  mockPush.mockClear();
  pressOrder(screen, 1001, true);
  expect(screen.getByText(/1 seleccionados/)).toBeTruthy();
  pressOrder(screen, 1002);
  expect(screen.getByText(/2 seleccionados/)).toBeTruthy();
  pressOrder(screen, 1002);
  pressOrder(screen, 1001);
  expect(screen.queryByText(/seleccionados/)).toBeNull();
  expect(mockPush).not.toHaveBeenCalled();
});

test("selection spans pages, totals the selected orders and resets with filters", async () => {
  pagedOrders();
  const screen = render(<OrderHistoryScreen />);
  await screen.findByText("Programado: 2026-10-20 · Olva");
  pressOrder(screen, 1001, true);
  pressOrder(screen, 1002);
  expect(screen.getByText(/2 seleccionados · .*3[.,]00/)).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Siguiente" }));
  await screen.findByRole("button", { name: "Anterior" });
  expect(screen.getByText(/2 seleccionados/)).toBeTruthy();
  pressOrder(screen, 1021);
  expect(screen.getByText(/3 seleccionados · .*24[.,]00/)).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Por cobrar" }));
  await waitFor(() => expect(screen.queryByText(/seleccionados/)).toBeNull());
  pressOrder(screen, 1001, true);
  fireEvent.press(screen.getByRole("button", { name: "Quitar selección" }));
  expect(screen.queryByText(/seleccionados/)).toBeNull();
  pressOrder(screen, 1001, true);
  fireEvent.press(screen.getByRole("button", { name: "Todos" }));
  await waitFor(() => expect(screen.queryByText(/seleccionados/)).toBeNull());
});

async function selectedOn(os: "android" | "ios") {
  const { Platform } = jest.requireActual("react-native");
  const original = Platform.OS;
  Platform.OS = os;
  try {
    pagedOrders();
    const screen = render(<OrderHistoryScreen />);
    await screen.findByRole("button", { name: "Siguiente" });
    pressOrder(screen, 1003, true);
    return screen;
  } finally { Platform.OS = original; }
}

test("Android prints labels for the selected orders", async () => {
  const screen = await selectedOn("android");
  fireEvent.press(screen.getByRole("button", { name: "Imprimir rótulos" }));
  expect(mockOpenDispatchPrint).toHaveBeenCalledWith([expect.objectContaining({ number: 1003 })]);
});

test("iOS offers no label printing", async () => {
  expect((await selectedOn("ios")).queryByRole("button", { name: "Imprimir rótulos" })).toBeNull();
});

describe("WhatsApp orders", () => {
  const date = "2026-10-05T00:00:00.000Z";
  const summary = (id: string, buyer: { contactId: null; name: string | null; phone: string | null } | null, source: "manual" | "whatsapp") => ({
    id, number: 1001, source, buyer, sellerId: "seller", createdAt: date, scheduledDispatchDate: null, shippedAt: null, deliveredAt: null, completedAt: null, checkoutEnabledAt: null,
    checkoutConfirmedAt: null, status: "active", paymentStatus: "pending", deliveryStatus: "pending", stockDeducted: false,
    total: { amount: 10, currency: "PEN" } });
  const load = (...items: ReturnType<typeof summary>[]) => mockLoadOrders.mockResolvedValue(ok({ page: 1, pageSize: 20, total: items.length, items }));

  test("shows the WhatsApp icon with the accessible label \"WhatsApp\" for chat orders", async () => {
    load(summary("chat", { contactId: null, name: "Ana", phone: "999" }, "whatsapp"), summary("manual", { contactId: null, name: "Luis", phone: "888" }, "manual"));
    const screen = render(<OrderHistoryScreen />);
    await screen.findByText("Ana");
    expect(screen.getAllByLabelText("WhatsApp")).toHaveLength(1);
  });

  test("shows the buyer as name or phone and hides a missing phone", async () => {
    load(summary("a", { contactId: null, name: null, phone: "999111222" }, "whatsapp"), summary("b", { contactId: null, name: "Ana", phone: null }, "whatsapp"));
    const screen = render(<OrderHistoryScreen />);
    await screen.findByText("999111222");
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByText("Público general")).toBeNull();
  });

  test("shows only the icon when the buyer has no name or phone", async () => {
    load(summary("a", { contactId: null, name: null, phone: null }, "whatsapp"));
    const screen = render(<OrderHistoryScreen />);
    await screen.findByLabelText("WhatsApp");
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByText("Público general")).toBeNull();
  });
});
