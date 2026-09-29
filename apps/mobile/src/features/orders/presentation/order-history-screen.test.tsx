import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import OrderHistoryScreen from "@mobile/features/orders/presentation/order-history-screen";

const mockPush = jest.fn();
const mockLoadOrders = jest.fn();
const mockReadPending = jest.fn();
const mockSearchContacts = jest.fn();
let mockCountry = "PE";
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }),
  useFocusEffect: (callback: () => void) => jest.requireActual("react").useEffect(callback, [callback]) }));
jest.mock("@mobile/composition/orders", () => ({ orders: {
  loadOrders: (...args: unknown[]) => mockLoadOrders(...args),
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

test("direct orders route explains Peru availability", () => {
  mockCountry = "CL";
  const screen = render(<OrderHistoryScreen />);
  expect(screen.getByText("Ventas aún no disponibles")).toBeTruthy();
  expect(mockLoadOrders).not.toHaveBeenCalled();
});

test("history moves between pages and opens the selected detail", async () => {
  const summary = (number: number) => ({ id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    customer: { kind: "general_public" }, completedAt: "2026-09-28T12:00:00.000Z", currency: "PEN", total: number });
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
