import { render } from "@testing-library/react-native";
import OrderDetailScreen from "@mobile/features/orders/presentation/order-detail-screen";
import i18n from "@mobile/i18n";

const mockId = "00000000-0000-4000-8000-000000000003";
let mockNotice: { id: string; shownTotal: { amount: number; currency: string } } | null = null;
let mockCountry = "PE";
const mockClear = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn() }),
  useLocalSearchParams: () => ({ id: mockId }),
  useFocusEffect: (callback: () => void) => jest.requireActual("react").useEffect(callback, [callback]) }));
jest.mock("@mobile/features/orders/composition", () => ({ orders: {
  loadOrder: async () => ({ success: true, data: { id: mockId, companyId: "00000000-0000-4000-8000-000000000001",
    sellerId: "seller", customer: { kind: "general_public" }, paymentMethod: "digital_wallet",
    completedAt: "2026-09-29T12:00:00.000Z", currency: "PEN", total: 12,
    items: [{ id: "00000000-0000-4000-8000-000000000005", variantId: "00000000-0000-4000-8000-000000000002",
      productName: "Camisa", variantAttributes: { Talla: "M" }, sku: null, quantity: 1, unitPrice: 12, subtotal: 12 }] } }),
  clearPendingOrderConfirmation: async () => ({ success: true, data: undefined }),
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

test('order detail translates amounts and labels to Portuguese', async () => {
  await i18n.changeLanguage('pt-BR');
  mockNotice = { id: mockId, shownTotal: { amount: 10, currency: 'PEN' } };
  try {
    const detail = render(<OrderDetailScreen />);
    await detail.findByText('Confira o valor cobrado');
    expect(detail.getByText(/Diferença:/)).toBeTruthy();
    expect(detail.getByText('Público geral')).toBeTruthy();
    detail.unmount();
  } finally {
    await i18n.changeLanguage('es');
  }
});
