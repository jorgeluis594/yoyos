import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import CreateProductScreen from "@mobile/features/products/presentation/create-product-screen";
import i18n from '@mobile/i18n';

const mockReplace = jest.fn();
const mockCreate = jest.fn();
const mockStartAttempt = jest.fn();
const productId = "00000000-0000-4000-8000-000000000001";

jest.mock("expo-router", () => ({ useRouter: () => ({ replace: mockReplace, canGoBack: () => false, back: jest.fn() }) }));
jest.mock("expo-crypto", () => ({ randomUUID: () => productId }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({
  useAccess: () => ({ state: { status: "ready", company: { country: "PE" } } }),
}));
jest.mock("@mobile/features/products/composition", () => ({
  products: { createProduct: (...args: unknown[]) => mockCreate(...args), uploadImage: jest.fn() },
}));
jest.mock("@mobile/features/printing/presentation/print-provider", () => ({ usePrint: () => ({ startAttempt: mockStartAttempt }) }));
jest.mock("@mobile/features/products/presentation/use-product-navigation-guard", () => ({ useProductNavigationGuard: () => jest.fn() }));
jest.mock("@mobile/features/products/presentation/draft-guard", () => ({ useProductDraft: () => ({ discardVersion: 0 }) }));
jest.mock("@mobile/features/products/presentation/product-photo", () => ({ ProductPhoto: () => null }));

const fillForm = () => {
  fireEvent.changeText(screen.getByLabelText("Nombre *"), "Camisa");
  fireEvent.changeText(screen.getByLabelText(/Precio de venta/), "20");
};

beforeEach(() => { jest.clearAllMocks(); });

test("save waits for confirmed creation, then opens the persisted product without printing", async () => {
  let confirm!: (value: ReturnType<typeof ok<string>>) => void;
  mockCreate.mockReturnValue(new Promise((resolve) => { confirm = resolve; }));
  render(<CreateProductScreen />);
  fillForm();
  expect(screen.queryByRole("button", { name: "Imprimir etiqueta" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
  expect(mockReplace).not.toHaveBeenCalled();
  await act(async () => confirm(ok(productId)));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: "/products/[productId]", params: { productId } });
  expect(mockStartAttempt).not.toHaveBeenCalled();
});

test("failed creation keeps the draft and never shows print or navigates", async () => {
  mockCreate.mockResolvedValue(err({ code: "NETWORK_ERROR", message: "offline" }));
  render(<CreateProductScreen />);
  fillForm();
  fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
  await screen.findByText("No se pudo guardar. Revisa tu conexión e inténtalo otra vez.");
  expect(screen.getByLabelText("Nombre *").props.value).toBe("Camisa");
  expect(screen.queryByRole("button", { name: "Imprimir etiqueta" })).toBeNull();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(mockStartAttempt).not.toHaveBeenCalled();
});

test('new product form and validation are translated to Portuguese', async () => {
  await i18n.changeLanguage('pt-BR');
  try {
    const form = render(<CreateProductScreen />);
    expect(screen.getByText('Novo produto')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Informe o nome do produto.')).toBeTruthy();
    form.unmount();
  } finally {
    await i18n.changeLanguage('es');
  }
});

test("stock stepper adjusts the initial stock sent on creation", async () => {
  mockCreate.mockResolvedValue(ok(productId));
  render(<CreateProductScreen />);
  fillForm();
  const decrease = screen.getByRole("button", { name: "Restar uno al stock" });
  expect(decrease.props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByRole("button", { name: "Sumar uno al stock" }));
  fireEvent.press(screen.getByRole("button", { name: "Sumar uno al stock" }));
  fireEvent.press(decrease);
  expect(screen.getByLabelText("Stock inicial").props.value).toBe("1");
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Guardar" })));
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ initialStock: 1 }));
});

test("close returns to the catalog", () => {
  render(<CreateProductScreen />);
  fireEvent.press(screen.getByRole("button", { name: "Cerrar" }));
  expect(mockReplace).toHaveBeenCalledWith("/products");
});
