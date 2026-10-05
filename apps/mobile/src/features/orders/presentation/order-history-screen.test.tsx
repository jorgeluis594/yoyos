import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { orders } from "@mobile/features/orders/composition";
import { err, ok } from "@shared/functional";
import OrderHistoryScreen from "@mobile/features/orders/presentation/order-history-screen";
import i18n from "@mobile/i18n";

const mockPush = jest.fn();
const mockLoadOrders = jest.fn();
const mockReadPending = jest.fn();
const mockSearchContacts = jest.fn();
let mockCountry = "PE";
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }),
  useFocusEffect: (callback: () => void) => jest.requireActual("react").useEffect(callback, [callback]) }));
jest.mock("@mobile/features/orders/composition", () => ({ orders: {
  loadMixedOrders: (...args: unknown[]) => mockLoadOrders(...args),
  readPendingOrderConfirmation: (...args: unknown[]) => mockReadPending(...args),
  searchOrderContacts: (...args: unknown[]) => mockSearchContacts(...args),
} }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: {
  status: "ready", company: { id: "00000000-0000-4000-8000-000000000001", name: "Mi tienda", country: mockCountry },
} }) }));
jest.mock("@mobile/features/orders/presentation/order-result", () => ({ useOrderResult: () => ({ show: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));

beforeEach(() => { jest.clearAllMocks(); mockCountry = "PE"; mockReadPending.mockResolvedValue(ok(null));
  mockSearchContacts.mockResolvedValue(ok([])); mockLoadOrders.mockResolvedValue(ok({ items: [], page: 1, pageSize: 20, total: 0 })); });

test("history distinguishes empty sales from filtered results and sends full Lima days", async () => {
  const screen = render(<OrderHistoryScreen />);
  await screen.findByText("Aún no hay ventas");
  fireEvent.press(screen.getByRole("button", { name: "Desde: Elegir día" }));
  fireEvent(screen.getByTestId("order-desde-picker"), "onValueChange", {}, new Date(2026, 8, 28, 12));
  fireEvent.press(screen.getByRole("button", { name: "Hasta: Elegir día" }));
  fireEvent(screen.getByTestId("order-hasta-picker"), "onValueChange", {}, new Date(2026, 8, 28, 12));
  fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
  await screen.findByText("Sin resultados");
  await waitFor(() => expect(mockLoadOrders).toHaveBeenLastCalledWith({ page: 1, customer: { kind: "all" },
    fromDay: "2026-09-28", throughDay: "2026-09-28" }));
  fireEvent.press(screen.getByRole("button", { name: "Nueva venta" }));
  expect(mockPush).toHaveBeenCalledWith("/orders/new");
});

test("a Chile company can open order history", async () => {
  mockCountry = "CL";
  const screen = render(<OrderHistoryScreen />);
  await screen.findByText("Aún no hay ventas");
  expect(mockLoadOrders).toHaveBeenCalledWith({ page: 1, customer: { kind: "all" } });
});

test("history translates empty state and filters to Portuguese", async () => {
  await i18n.changeLanguage('pt-BR');
  try {
    const screen = render(<OrderHistoryScreen />);
    await screen.findByText('Ainda não há vendas');
    expect(screen.getByRole('button', { name: 'Nova venda' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Público geral' })).toBeTruthy();
  } finally {
    cleanup();
    await i18n.changeLanguage('es');
  }
});

test("history moves between pages and opens the selected detail", async () => {
  const summary = (number: number) => ({ number: 1000 + number, id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null, createdAt: "2026-09-28T12:00:00.000Z", completedAt: null,
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
  await screen.findByText("No se pudieron cargar las ventas");
  fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
  await screen.findByText("Aún no hay ventas");
});

test.each(["success", "error"])("history ignores a replaced request's %s before and after the latest load", async (outcome) => {
  type ListResult = Awaited<ReturnType<typeof orders.loadMixedOrders>>;
  const requests: ((result: ListResult) => void)[] = [];
  mockLoadOrders.mockImplementation(() => new Promise<ListResult>((resolve) => requests.push(resolve)));
  mockReadPending.mockResolvedValueOnce(err({ code: "PENDING_STORAGE_UNAVAILABLE", message: "Unavailable" }));
  const screen = render(<OrderHistoryScreen />);
  fireEvent.press(screen.getByRole("button", { name: "Público general" }));
  fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
  const stale: ListResult = outcome === "error" ? err({ code: "NETWORK_ERROR", message: "Offline" }) : ok({
    items: [{ number: 1001, id: "old", sellerId: "seller", buyer: { contactId: "contact", name: "Venta anterior", phone: "999999999" }, checkoutEnabledAt: null, checkoutConfirmedAt: null,
      createdAt: "2026-09-28T12:00:00.000Z", completedAt: null, status: "active", paymentStatus: "pending",
      deliveryStatus: "pending", stockDeducted: false, total: { amount: 10, currency: "PEN" } }], page: 1, pageSize: 20, total: 80,
  });
  await act(async () => { requests[0](stale); });
  expect(screen.getByText("Cargando ventas")).toBeTruthy();
  expect(screen.queryByText("No se pudo leer la venta pendiente")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Aplicar filtros" }));
  await act(async () => { requests[2](ok({
    items: [{ number: 1002, id: "latest", sellerId: "seller", buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null, createdAt: "2026-09-29T12:00:00.000Z",
      completedAt: null, status: "active", paymentStatus: "pending", deliveryStatus: "pending", stockDeducted: false,
      total: { amount: 20, currency: "PEN" } }],
    page: 1, pageSize: 20, total: 1,
  })); });
  await act(async () => { requests[1](stale); });
  expect(screen.getByText("1 venta")).toBeTruthy();
  expect(screen.queryByText("Venta anterior")).toBeNull();
  expect(screen.queryByText("No se pudieron cargar las ventas")).toBeNull();
  expect(screen.queryByRole("button", { name: "Siguiente" })).toBeNull();
  fireEvent.press(screen.getByText(/20[.,]00/));
  expect(mockPush).toHaveBeenCalledWith("/orders/latest");
});
