import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { err, ok } from "@shared/functional";
import { createProductApi } from "@mobile/features/products/infrastructure/product-api";
import { createProductOperations } from "@mobile/features/products/application/product-operations";
import { createProductPrintingOperations, type ProductPrintingDependencies } from "@mobile/features/products/application/product-printing";
import type { ProductLabel } from "@mobile/features/products/domain/product-label";
import ProductManagementScreen from "@mobile/features/products/presentation/product-management-screen";
import i18n from '@mobile/i18n';
import type { AdapterId, PrinterId } from "@mobile/features/printing/domain/printing";
import type { PrintWork } from "@mobile/features/printing/presentation/print-provider";

const mockLoadProduct = jest.fn();
const mockUpdateProduct = jest.fn();
const mockStartAttempt = jest.fn();
const mockPrintProductLabel = jest.fn();
const productId = "00000000-0000-4000-8000-000000000001";
const product = {
  id: productId, name: "Camisa", currency: "PEN",
  variants: [{ id: "variant-1", qrCode: "qr-1", attributes: {}, sku: "CAM-1", salePrice: { amount: 20, currency: "PEN" }, stock: 1 }],
};

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ productId }), useRouter: () => ({ replace: mockReplace }) }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: { status: "ready" } }) }));
jest.mock("@mobile/features/products/composition", () => ({
  products: { loadProduct: (...args: unknown[]) => mockLoadProduct(...args), updateProduct: (...args: unknown[]) => mockUpdateProduct(...args), uploadImage: jest.fn() },
  productPrinting: { printProductLabel: (...args: unknown[]) => mockPrintProductLabel(...args) },
}));
jest.mock("@mobile/features/printing/presentation/print-provider", () => ({ usePrint: () => ({ startAttempt: mockStartAttempt }) }));
jest.mock("@mobile/features/products/presentation/use-product-navigation-guard", () => ({ useProductNavigationGuard: () => jest.fn() }));
jest.mock("@mobile/features/products/presentation/draft-guard", () => ({ useProductDraft: () => ({ discardVersion: 0 }) }));
jest.mock("@mobile/features/products/presentation/product-photo", () => ({ ProductPhoto: () => null }));

beforeEach(() => { jest.clearAllMocks(); });

test("printing with draft changes opens the print sheet and uses the saved product", async () => {
  mockLoadProduct.mockResolvedValue(ok(product));
  mockPrintProductLabel.mockResolvedValue(ok({ status: "completed", receipt: { confirmation: "sdk" } }));
  const alert = jest.spyOn(Alert, "alert");
  try {
    render(<ProductManagementScreen />);
    fireEvent.changeText(await screen.findByLabelText("Nombre *"), "Camisa editada");
    fireEvent.press(screen.getByRole("button", { name: "Imprimir etiqueta" }));
    expect(screen.getByText("La etiqueta usará los datos guardados, sin incluir los cambios de este formulario.")).toBeTruthy();
    expect(mockStartAttempt).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: "Imprimir" }));
    expect(alert).not.toHaveBeenCalled();
    expect(mockStartAttempt).toHaveBeenCalledTimes(1);
    const work = mockStartAttempt.mock.calls[0][0] as PrintWork;
    const execution = { isSessionCurrent: () => true, onStage: jest.fn() };
    expect(await work(execution)).toEqual({ status: "completed" });
    expect(mockPrintProductLabel).toHaveBeenCalledWith({ kind: "saved-product", product, variantId: "variant-1" }, 1, execution);
  } finally { alert.mockRestore(); }
});

test("an explicit variant prints saved data and copies while saving the draft does not print", async () => {
  const firstId = "00000000-0000-4000-8000-000000000002";
  const secondId = "00000000-0000-4000-8000-000000000003";
  const secondQr = "00000000-0000-4000-8000-000000000005";
  let savedName = "Camisa";
  const request = jest.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      savedName = JSON.parse(init.body as string).name;
      return ok({ id: productId });
    }
    return ok({ product: {
      id: productId, name: savedName, currency: "PEN", qrCode: "00000000-0000-4000-8000-000000000006",
      status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      variants: [
        { id: firstId, productId, attributes: { color: "Rojo" }, salePrice: { amount: 20, currency: "PEN" }, qrCode: "00000000-0000-4000-8000-000000000004", status: "active", stock: { variantId: firstId, quantity: 1 } },
        { id: secondId, productId, attributes: { color: "Azul" }, sku: "AZUL-1", salePrice: { amount: 22, currency: "PEN" }, qrCode: secondQr, status: "active", stock: { variantId: secondId, quantity: 2 } },
      ],
    } });
  });
  const products = createProductOperations(createProductApi(request, () => 0));
  const renderProductLabel = jest.fn(async (_label: ProductLabel) => ok({ uri: "file:///label.png", widthPx: 696, heightPx: 271 }));
  const printDocument = jest.fn(async ({ render }: Parameters<ProductPrintingDependencies["printDocument"]>[0]) => {
    await render({ widthPx: 696, heightPx: 271, dpiX: 300, dpiY: 300 });
    return ok({ status: "completed" as const, printer: { id: "printer" as PrinterId, adapterId: "brother" as AdapterId, displayName: "Brother", model: "QL-810W" }, receipt: { confirmation: "sdk" as const } });
  });
  const printing = createProductPrintingOperations({ loadProduct: products.loadProduct, renderProductLabel, printDocument });
  mockLoadProduct.mockImplementation(products.loadProduct);
  mockUpdateProduct.mockImplementation(products.updateProduct);
  mockPrintProductLabel.mockImplementation(printing.printProductLabel);
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  try {
    render(<ProductManagementScreen />);
    fireEvent.changeText(await screen.findByLabelText("Nombre *"), "Camisa editada");
    fireEvent.press(screen.getByRole("button", { name: "Imprimir etiqueta" }));
    expect(screen.getByText("La etiqueta usará los datos guardados, sin incluir los cambios de este formulario.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Imprimir" }).props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByRole("radio", { name: "color: Azul" }));
    expect(screen.getByLabelText("Copias de la etiqueta").props.value).toBe("1");
    fireEvent.changeText(screen.getByLabelText("Copias de la etiqueta"), "3");
    fireEvent.press(screen.getByRole("button", { name: "Imprimir" }));
    const work = mockStartAttempt.mock.calls[0][0] as PrintWork;
    expect(await work({ isSessionCurrent: () => true, onStage: jest.fn() })).toEqual({ status: "completed" });
    expect(renderProductLabel).toHaveBeenCalledWith({ productName: "Camisa", sku: "AZUL-1", qrCode: secondQr }, expect.anything());
    expect(printDocument.mock.calls[0][0]).toMatchObject({ copies: 3 });

    fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(savedName).toBe("Camisa editada"));
    await waitFor(() => expect(screen.queryByText("La etiqueta usará los datos guardados, sin incluir los cambios de este formulario.")).toBeNull());
    expect(printDocument).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    expect(request.mock.calls.map(([path]) => path)).toEqual(Array(3).fill(`/api/products/${productId}`));
  } finally { alert.mockRestore(); }
});

test("a failed edit reports the error and does not present a saved result", async () => {
  mockLoadProduct.mockResolvedValue(ok(product));
  mockUpdateProduct.mockResolvedValue(err({ code: "NETWORK_ERROR", message: "offline" }));
  const alert = jest.spyOn(Alert, "alert");
  try {
    render(<ProductManagementScreen />);
    fireEvent.changeText(await screen.findByLabelText("Nombre *"), "Camisa editada");
    fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("No se pudo guardar. Revisa tu conexión e inténtalo otra vez.")).toBeTruthy();
    expect(screen.getByLabelText("Nombre *").props.value).toBe("Camisa editada");
    expect(screen.getByRole("button", { name: "Imprimir etiqueta" }).props.accessibilityState.disabled).toBe(true);
    expect(alert).not.toHaveBeenCalled();
  } finally { alert.mockRestore(); }
});

test("invalid copies are reported before starting a print attempt", async () => {
  mockLoadProduct.mockResolvedValue(ok(product));
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  try {
    render(<ProductManagementScreen />);
    await screen.findByLabelText("Nombre *");
    fireEvent.press(screen.getByRole("button", { name: "Imprimir etiqueta" }));
    fireEvent.changeText(screen.getByLabelText("Copias de la etiqueta"), "0");
    fireEvent.press(screen.getByRole("button", { name: "Imprimir" }));
    expect(screen.getByText("Elige entre 1 y 99 copias.")).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
    expect(mockStartAttempt).not.toHaveBeenCalled();
  } finally { alert.mockRestore(); }
});

test('product management uses Portuguese labels', async () => {
  await i18n.changeLanguage('pt-BR');
  mockLoadProduct.mockResolvedValue(ok(product));
  try {
    const form = render(<ProductManagementScreen />);
    await screen.findByText('Editar produto');
    expect(screen.getByRole('button', { name: 'Imprimir etiqueta' })).toBeTruthy();
    form.unmount();
  } finally {
    await i18n.changeLanguage('es');
  }
});

test("a product that fails to load can still be closed without the tab bar", async () => {
  mockLoadProduct.mockResolvedValue(err({ code: "NETWORK_ERROR", message: "offline" }));
  render(<ProductManagementScreen />);
  fireEvent.press(await screen.findByRole("button", { name: "Cerrar" }));
  expect(mockReplace).toHaveBeenCalledWith("/products");
});

test("editing shows the same inventory stepper as creation, locked with an explanation", async () => {
  mockLoadProduct.mockResolvedValue(ok(product));
  render(<ProductManagementScreen />);
  expect(await screen.findByText("Editar producto")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sumar uno al stock" }).props.accessibilityState.disabled).toBe(true);
  expect(screen.getByText("El stock cambia con las ventas y ajustes.")).toBeTruthy();
  expect(screen.queryByLabelText("Copias de la etiqueta")).toBeNull();
});
