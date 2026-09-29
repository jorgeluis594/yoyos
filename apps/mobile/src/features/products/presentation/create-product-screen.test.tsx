import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import CreateProductScreen from "@mobile/features/products/presentation/create-product-screen";
import type { PrintWork } from "@mobile/features/printing/presentation/print-provider";

const mockReplace = jest.fn();
const mockCreate = jest.fn();
const mockStartAttempt = jest.fn();
const mockPrintProductLabel = jest.fn();
const mockRetryProductLabel = jest.fn();
const productId = "00000000-0000-4000-8000-000000000001";

jest.mock("expo-router", () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock("expo-crypto", () => ({ randomUUID: () => productId }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({
  useAccess: () => ({ state: { status: "ready", company: { country: "PE" } } }),
}));
jest.mock("@mobile/features/products/composition", () => ({
  products: { createProduct: (...args: unknown[]) => mockCreate(...args), uploadImage: jest.fn() },
  productPrinting: {
    printProductLabel: (...args: unknown[]) => mockPrintProductLabel(...args),
    retryProductLabel: (...args: unknown[]) => mockRetryProductLabel(...args),
  },
}));
jest.mock("@mobile/features/printing/presentation/print-provider", () => ({ usePrint: () => ({ startAttempt: mockStartAttempt }) }));
jest.mock("@mobile/features/printing/composition", () => ({ makeCopyCount: (value: number) => Number.isSafeInteger(value) && value > 0 ? { success: true, data: value } : { success: false, error: { code: "INVALID_COPIES" } } }));
jest.mock("@mobile/features/products/presentation/use-product-navigation-guard", () => ({ useProductNavigationGuard: () => jest.fn() }));
jest.mock("@mobile/features/products/presentation/draft-guard", () => ({ useProductDraft: () => ({ discardVersion: 0 }) }));
jest.mock("@mobile/features/products/presentation/product-photo", () => ({ ProductPhoto: () => null }));

const execution = { isSessionCurrent: () => true, onStage: jest.fn() };
const fillForm = () => {
  fireEvent.changeText(screen.getByLabelText("Nombre *"), "Camisa");
  fireEvent.changeText(screen.getByLabelText(/Precio de venta/), "20");
};

beforeEach(() => { jest.clearAllMocks(); });

test("save and print waits for confirmed creation and retries without creating again", async () => {
  let confirm!: (value: ReturnType<typeof ok<string>>) => void;
  mockCreate.mockReturnValue(new Promise((resolve) => { confirm = resolve; }));
  mockPrintProductLabel.mockResolvedValueOnce({ success: false, error: { cause: { code: "NETWORK_ERROR" }, retry: { kind: "load-created-product" } } });
  mockRetryProductLabel.mockResolvedValueOnce(ok({ status: "completed" }));
  render(<CreateProductScreen />);
  fillForm();
  fireEvent.press(screen.getByRole("button", { name: "Guardar e imprimir" }));
  expect(mockStartAttempt).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  await act(async () => confirm(ok(productId)));
  expect(mockStartAttempt).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledWith({ pathname: "/products/[productId]", params: { productId } });
  const work = mockStartAttempt.mock.calls[0][0] as PrintWork;
  expect(await work(execution)).toMatchObject({ status: "failed", outcome: "not-sent" });
  expect(mockPrintProductLabel).toHaveBeenCalledWith({ kind: "created-product", productId }, 1, execution);
  expect(await work(execution)).toEqual({ status: "completed" });
  expect(mockRetryProductLabel).toHaveBeenCalledTimes(1);
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

test("save only and failed creation never start printing", async () => {
  mockCreate.mockResolvedValueOnce(ok(productId)).mockResolvedValueOnce(err({ code: "NETWORK_ERROR", message: "offline" }));
  const first = render(<CreateProductScreen />);
  fillForm();
  fireEvent.press(screen.getByRole("button", { name: "Solo guardar" }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
  expect(mockStartAttempt).not.toHaveBeenCalled();
  first.unmount();
  render(<CreateProductScreen />);
  fillForm();
  fireEvent.press(screen.getByRole("button", { name: "Guardar e imprimir" }));
  await screen.findByText("No se pudo guardar. Revisa tu conexión e inténtalo otra vez.");
  expect(mockReplace).toHaveBeenCalledTimes(1);
  expect(mockStartAttempt).not.toHaveBeenCalled();
});
