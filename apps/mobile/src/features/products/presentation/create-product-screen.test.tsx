import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import CreateProductScreen from "@mobile/features/products/presentation/create-product-screen";
import { createProductApi } from "@mobile/features/products/infrastructure/product-api";
import { createProductOperations } from "@mobile/features/products/application/product-operations";
import { createProductPrintingOperations, type ProductPrintingDependencies } from "@mobile/features/products/application/product-printing";
import type { ProductLabel } from "@mobile/features/products/domain/product-label";
import type { AdapterId, PrinterId } from "@mobile/features/printing/domain/printing";
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

test("save and print retries a failed detail request through the real mobile operations without creating twice", async () => {
  const variantQr = "00000000-0000-4000-8000-000000000003";
  const variantId = "00000000-0000-4000-8000-000000000002";
  const detail = { product: {
    id: productId, name: "Camisa", currency: "PEN", qrCode: "00000000-0000-4000-8000-000000000004",
    status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    variants: [{ id: variantId, productId, attributes: {}, salePrice: { amount: 20, currency: "PEN" }, qrCode: variantQr, status: "active", stock: { variantId, quantity: 0 } }],
  } };
  let reads = 0;
  const request = jest.fn(async (path: string) => path === "/api/products"
    ? ok({ id: productId })
    : ++reads === 1 ? err({ code: "NETWORK_ERROR" as const, message: "Offline" }) : ok(detail));
  const products = createProductOperations(createProductApi(request, () => 0));
  const renderProductLabel = jest.fn(async (_label: ProductLabel) => ok({ uri: "file:///label.png", widthPx: 696, heightPx: 271 }));
  const printDocument = jest.fn(async ({ render }: Parameters<ProductPrintingDependencies["printDocument"]>[0]) => {
    await render({ widthPx: 696, heightPx: 271, dpiX: 300, dpiY: 300 });
    return ok({ status: "completed" as const, printer: { id: "printer" as PrinterId, adapterId: "brother" as AdapterId, displayName: "Brother", model: "QL-810W" }, receipt: { confirmation: "sdk" as const } });
  });
  const printing = createProductPrintingOperations({ loadProduct: products.loadProduct, renderProductLabel, printDocument });
  mockCreate.mockImplementation(products.createProduct);
  mockPrintProductLabel.mockImplementation(printing.printProductLabel);
  mockRetryProductLabel.mockImplementation(printing.retryProductLabel);

  render(<CreateProductScreen />);
  fillForm();
  fireEvent.press(screen.getByRole("button", { name: "Guardar e imprimir" }));
  await waitFor(() => expect(mockStartAttempt).toHaveBeenCalledTimes(1));
  const work = mockStartAttempt.mock.calls[0][0] as PrintWork;
  expect(await work(execution)).toMatchObject({ status: "failed", message: "No se pudo consultar el producto para imprimir." });
  expect(await work(execution)).toEqual({ status: "completed" });
  expect(request.mock.calls.map(([path]) => path)).toEqual(["/api/products", `/api/products/${productId}`, `/api/products/${productId}`]);
  expect(renderProductLabel).toHaveBeenCalledWith({ productName: "Camisa", qrCode: variantQr }, expect.anything());
  expect(printDocument).toHaveBeenCalledTimes(1);
});
