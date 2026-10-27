import { act, fireEvent, render } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import NewOrderScreen from "@mobile/features/orders/presentation/new-order-screen";
import "@mobile/i18n";

const mockId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mockLoadReview = jest.fn();
const mockReviewOrder = jest.fn();
const mockCompleteOrder = jest.fn();
let mockPending: unknown = ok([]);

jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), replace: jest.fn() }), useNavigation: () => ({ dispatch: jest.fn() }) }));
jest.mock("expo-router/react-navigation", () => ({ usePreventRemove: jest.fn() }));
jest.mock("expo-crypto", () => ({ randomUUID: () => mockId(3) }));
jest.mock("expo-network", () => ({ useNetworkState: () => ({ isConnected: true, isInternetReachable: true }), getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }) }));
jest.mock("@mobile/features/orders/composition", () => ({ orders: {
  discardPendingOrderConfirmation: jest.fn(),
  loadPendingOrderReview: (...args: unknown[]) => mockLoadReview(...args),
  reviewPendingOrder: (...args: unknown[]) => mockReviewOrder(...args),
  completeOrder: (...args: unknown[]) => mockCompleteOrder(...args),
  searchOrderCatalog: async () => ({ success: true, data: [{ id: mockId(4), name: "Polo", currency: "PEN",
    variants: [{ id: mockId(2), attributes: { Talla: "L", Color: "Azul" }, sku: "POLO-L-AZ", price: 42.9, stock: 3 }] }] }),
} }));
jest.mock("@mobile/features/delivery-settings/composition", () => ({ deliverySettings: {
  get: async () => ({ success: true, data: { version: 1, home: { enabled: false }, store: { enabled: false, pickupPoint: null }, agency: { enabled: false }, couriers: [] } }),
  createQuotation: jest.fn(),
} }));
jest.mock("@expo/ui/community/menu", () => ({ MenuView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@expo/ui/community/datetime-picker", () => ({ DateTimePicker: () => null }));
jest.mock("@expo/ui", () => { const { View } = jest.requireActual("react-native"); function Picker() { return null; } Picker.Item = function PickerItem() { return null; }; return { Host: View, Picker }; });
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: { status: "ready", company: { id: mockId(1), name: "Mi tienda", country: "PE" }, user: { id: "seller" } } }) }));
jest.mock("@mobile/features/orders/presentation/order-draft-guard", () => ({ useOrderDraft: () => ({ dirty: false, setDirty: jest.fn(), discardVersion: 0 }) }));
jest.mock("@mobile/features/orders/presentation/pending-order-sync-provider", () => ({ usePendingOrders: () => ({ pending: mockPending, refresh: jest.fn(async () => {}), trigger: jest.fn() }) }));
jest.mock("@mobile/features/orders/presentation/order-result", () => ({ useOrderResult: () => ({ show: jest.fn() }) }));
jest.mock("react-native-screens/experimental", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));

beforeEach(() => { jest.clearAllMocks(); mockPending = ok([]); });

test("a sale rejected with VARIANT_NOT_FOUND marks 'L / Azul ya no está disponible.'", async () => {
  const variantId = mockId(6);
  const pending = { version: 2, companyId: mockId(1), id: mockId(3), shownTotal: { amount: 42.9, currency: "PEN" },
    request: { id: mockId(3), items: [{ variantId, quantity: 1 }] }, itemLabels: { [variantId]: "L / Azul" },
    rejection: { code: "VARIANT_NOT_FOUND", message: "Variant not found", variantId } };
  const draft = { kind: "empty", id: pending.id, items: [] };
  mockPending = ok([pending]);
  mockLoadReview.mockResolvedValue(ok({ kind: "review", pending, draft, unavailableVariantIds: [variantId], unavailableLabels: { [variantId]: "L / Azul" } }));
  const screen = render(<NewOrderScreen />);
  expect(await screen.findByText("L / Azul ya no está disponible.")).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Revisar venta" })); });
  fireEvent.press(screen.getByRole("button", { name: "Editar productos" }));
  expect(screen.getByText("L / Azul ya no está disponible.")).toBeTruthy();
  expect(screen.queryByText(/El producto guardado 1/)).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: /Quitar producto no disponible/ }));
  expect(screen.queryByText("L / Azul ya no está disponible.")).toBeNull();
});

test("a sale refused when it is saved marks the item that was deactivated while it was being built", async () => {
  mockCompleteOrder.mockResolvedValue(err({ code: "VARIANT_NOT_FOUND", message: "Variant not found", issues: [{ field: "items", reason: "VARIANT_NOT_FOUND", variantId: mockId(2) }] }));
  const screen = render(<NewOrderScreen />);
  await screen.findByText("Polo");
  fireEvent.press(screen.getByRole("button", { name: /Polo/ }));
  fireEvent.press(screen.getByRole("button", { name: "Agregar" }));
  fireEvent.press(screen.getByRole("button", { name: "Continuar" }));
  await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar pedido" })); });
  fireEvent.press(screen.getByRole("button", { name: "Editar productos" }));
  expect(screen.getByText("L / Azul ya no está disponible.")).toBeTruthy();
  expect(screen.queryByText("Revisa esta variante.")).toBeNull();
});
