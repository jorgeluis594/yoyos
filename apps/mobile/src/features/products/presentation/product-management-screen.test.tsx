import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { err, ok } from "@shared/functional";
import { createProductApi } from "@mobile/features/products/infrastructure/product-api";
import { createProductOperations } from "@mobile/features/products/application/product-operations";
import { createProductPrintingOperations, type ProductPrintingDependencies } from "@mobile/features/products/application/product-printing";
import type { ProductLabel } from "@mobile/features/products/domain/product-label";
import ProductManagementScreen from "@mobile/features/products/presentation/product-management-screen";
import { ProductEditorProvider } from "@mobile/features/products/presentation/product-editor-state";
import i18n from '@mobile/i18n';
import type { AdapterId, PrinterId } from "@mobile/features/printing/domain/printing";
import type { PrintWork } from "@mobile/features/printing/presentation/print-provider";

const mockLoadProduct = jest.fn();
const mockGuard = jest.fn();
const mockSaveProduct = jest.fn();
const mockStartAttempt = jest.fn();
const mockPrintProductLabel = jest.fn();
const productId = "00000000-0000-4000-8000-000000000001";
const product = {
  id: productId, name: "Camisa", currency: "PEN", structureVersion: 1, options: [],
  variants: [{ id: "variant-1", qrCode: "qr-1", combination: [], sku: "CAM-1", salePrice: { amount: 20, currency: "PEN" }, stock: 1, status: "active", hasOrders: false }],
};

const mockReplace = jest.fn();
const mockPush = jest.fn();
const renderScreen = () => render(<ProductEditorProvider><ProductManagementScreen /></ProductEditorProvider>);
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ productId }), useRouter: () => ({ replace: mockReplace, push: mockPush, canGoBack: () => false, back: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: { status: "ready" } }) }));
jest.mock("@mobile/features/products/composition", () => ({
  products: { loadProduct: (...args: unknown[]) => mockLoadProduct(...args), saveProduct: (...args: unknown[]) => mockSaveProduct(...args), uploadImage: jest.fn() },
  productPrinting: { printProductLabel: (...args: unknown[]) => mockPrintProductLabel(...args) },
}));
jest.mock("@mobile/features/printing/presentation/print-provider", () => ({ usePrint: () => ({ startAttempt: mockStartAttempt }) }));
jest.mock("@mobile/features/products/presentation/use-product-navigation-guard", () => ({ useProductNavigationGuard: (dirty: boolean) => { mockGuard(dirty); return jest.fn(); } }));
jest.mock("@mobile/features/products/presentation/draft-guard", () => ({ useProductDraft: () => ({ discardVersion: 0 }) }));
jest.mock("@mobile/features/products/presentation/product-photo", () => ({ ProductPhoto: () => null }));

beforeEach(() => { jest.clearAllMocks(); });

test("printing with draft changes opens the print sheet and uses the saved product", async () => {
  mockLoadProduct.mockResolvedValue(ok(product));
  mockPrintProductLabel.mockResolvedValue(ok({ status: "completed", receipt: { confirmation: "sdk" } }));
  const alert = jest.spyOn(Alert, "alert");
  try {
    renderScreen();
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
  const colorId = "00000000-0000-4000-8000-000000000010";
  const redId = "00000000-0000-4000-8000-000000000011";
  const blueId = "00000000-0000-4000-8000-000000000012";
  let savedName = "Camisa";
  const request = jest.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === "PUT") savedName = JSON.parse(init.body as string).name;
    return ok({ product: {
      id: productId, name: savedName, description: null, imageId: null, currency: "PEN", qrCode: "00000000-0000-4000-8000-000000000006",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", structureVersion: 1,
      options: [{ id: colorId, name: "Color", values: [{ id: redId, name: "Rojo" }, { id: blueId, name: "Azul" }] }],
      variants: [
        { id: firstId, combination: [{ optionId: colorId, valueId: redId }], sku: null, salePrice: { amount: 20, currency: "PEN" }, purchasePrice: null, qrCode: "00000000-0000-4000-8000-000000000004", status: "active", stock: 1, hasOrders: false },
        { id: secondId, combination: [{ optionId: colorId, valueId: blueId }], sku: "AZUL-1", salePrice: { amount: 22, currency: "PEN" }, purchasePrice: null, qrCode: secondQr, status: "active", stock: 2, hasOrders: false },
      ],
    }, image: null });
  });
  const products = createProductOperations(createProductApi(request, () => 0));
  const renderProductLabel = jest.fn(async (_label: ProductLabel) => ok({ uri: "file:///label.png", widthPx: 696, heightPx: 271 }));
  const printDocument = jest.fn(async ({ render }: Parameters<ProductPrintingDependencies["printDocument"]>[0]) => {
    await render({ widthPx: 696, heightPx: 271, dpiX: 300, dpiY: 300 });
    return ok({ status: "completed" as const, printer: { id: "printer" as PrinterId, adapterId: "brother" as AdapterId, displayName: "Brother", model: "QL-810W" }, receipt: { confirmation: "sdk" as const } });
  });
  const printing = createProductPrintingOperations({ loadProduct: products.loadProduct, renderProductLabel, printDocument });
  mockLoadProduct.mockImplementation(products.loadProduct);
  mockSaveProduct.mockImplementation(products.saveProduct);
  mockPrintProductLabel.mockImplementation(printing.printProductLabel);
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  try {
    renderScreen();
    fireEvent.changeText(await screen.findByLabelText("Nombre *"), "Camisa editada");
    fireEvent.press(screen.getByRole("button", { name: "Imprimir etiqueta" }));
    expect(screen.getByText("La etiqueta usará los datos guardados, sin incluir los cambios de este formulario.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Imprimir" }).props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByRole("radio", { name: "Azul" }));
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
    expect(request.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    // The save answers the full detail, so there is no read after it.
    expect(request.mock.calls.map(([path]) => path)).toEqual(Array(2).fill(`/api/products/${productId}`));
  } finally { alert.mockRestore(); }
});

test("a failed edit reports the error and does not present a saved result", async () => {
  mockLoadProduct.mockResolvedValue(ok(product));
  mockSaveProduct.mockResolvedValue(err({ code: "NETWORK_ERROR", message: "offline" }));
  const alert = jest.spyOn(Alert, "alert");
  try {
    renderScreen();
    fireEvent.changeText(await screen.findByLabelText("Nombre *"), "Camisa editada");
    fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Puede que se hayan guardado los cambios. Recarga el producto para revisarlos.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recargar producto" })).toBeTruthy();
    expect(screen.getByLabelText("Nombre *").props.value).toBe("Camisa editada");
    expect(screen.getByRole("button", { name: "Imprimir etiqueta" }).props.accessibilityState.disabled).toBe(true);
    expect(alert).not.toHaveBeenCalled();
  } finally { alert.mockRestore(); }
});

test("invalid copies are reported before starting a print attempt", async () => {
  mockLoadProduct.mockResolvedValue(ok(product));
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  try {
    renderScreen();
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
    const form = renderScreen();
    await screen.findByText('Editar produto');
    expect(screen.getByRole('button', { name: 'Imprimir etiqueta' })).toBeTruthy();
    form.unmount();
  } finally {
    await i18n.changeLanguage('es');
  }
});

test("a product that fails to load can still be closed without the tab bar", async () => {
  mockLoadProduct.mockResolvedValue(err({ code: "NETWORK_ERROR", message: "offline" }));
  renderScreen();
  fireEvent.press(await screen.findByRole("button", { name: "Cerrar" }));
  expect(mockReplace).toHaveBeenCalledWith("/products");
});

test("editing shows the same inventory stepper as creation, locked", async () => {
  mockLoadProduct.mockResolvedValue(ok(product));
  renderScreen();
  expect(await screen.findByText("Editar producto")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sumar uno al stock" }).props.accessibilityState.disabled).toBe(true);
  expect(screen.queryByText("El stock cambia con las ventas y ajustes.")).toBeNull();
  expect(screen.queryByLabelText("Copias de la etiqueta")).toBeNull();
});

test("an untouched product is not dirty, even when its price has no decimals", async () => {
  mockLoadProduct.mockResolvedValue(ok(product));
  renderScreen();
  await screen.findByText("Editar producto");
  expect(mockGuard).toHaveBeenLastCalledWith(false);
  fireEvent.changeText(screen.getByLabelText("Nombre *"), "Otro nombre");
  expect(mockGuard).toHaveBeenLastCalledWith(true);
});

test("a PRODUCT_CHANGED rejection keeps the form and offers to reload", async () => {
  mockLoadProduct.mockResolvedValue(ok(product));
  mockSaveProduct.mockResolvedValue(err({ code: "PRODUCT_CHANGED", message: "changed" }));
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  try {
    renderScreen();
    fireEvent.changeText(await screen.findByLabelText("Nombre *"), "Camisa editada");
    fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Este producto cambió desde que lo abriste. Recarga el producto para ver los cambios.")).toBeTruthy();
    expect(screen.getByLabelText("Nombre *").props.value).toBe("Camisa editada");
    expect(alert).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: "Recargar producto" }));
    expect(alert).toHaveBeenCalledWith("¿Descartar cambios?", "Se perderán los cambios que no guardaste.", expect.anything(), expect.anything());
    expect(mockLoadProduct).toHaveBeenCalledTimes(1);
    const discard = (alert.mock.calls[0][2] as { text: string; onPress?: () => void }[]).find((button) => button.text === "Descartar");
    await waitFor(() => discard?.onPress?.());
    await waitFor(() => expect(mockLoadProduct).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Nombre *").props.value).toBe("Camisa");
  } finally { alert.mockRestore(); }
});

test("a product with options shows its variants card instead of the price and SKU fields", async () => {
  const colorId = "00000000-0000-4000-8000-000000000010";
  const blueId = "00000000-0000-4000-8000-000000000011";
  const redId = "00000000-0000-4000-8000-000000000012";
  const withOptions = { ...product, options: [{ id: colorId, name: "Color", values: [{ id: redId, name: "Rojo" }, { id: blueId, name: "Azul" }] }],
    variants: [
      { ...product.variants[0], id: "variant-1", combination: [{ optionId: colorId, valueId: redId }], stock: 3, status: "active" },
      { ...product.variants[0], id: "variant-2", combination: [{ optionId: colorId, valueId: blueId }], stock: 2, status: "inactive", salePrice: { amount: 18, currency: "PEN" } },
    ] };
  mockLoadProduct.mockResolvedValue(ok(withOptions));
  renderScreen();
  expect(await screen.findByText("2 variantes")).toBeTruthy();
  expect(screen.getByText("3 en stock · desde S/ 20.00")).toBeTruthy();
  expect(screen.getByText("Color")).toBeTruthy();
  expect(screen.queryByLabelText("SKU (opcional)")).toBeNull();
  expect(screen.queryByLabelText(/Precio de venta/)).toBeNull();
  expect(screen.getByText("Suma del stock de las variantes activas.")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Ver variantes" }));
  expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/products/[productId]/variants" }));
});

test("a product without active variants says so", async () => {
  const colorId = "00000000-0000-4000-8000-000000000010";
  const redId = "00000000-0000-4000-8000-000000000012";
  mockLoadProduct.mockResolvedValue(ok({ ...product, options: [{ id: colorId, name: "Color", values: [{ id: redId, name: "Rojo" }] }],
    variants: [{ ...product.variants[0], combination: [{ optionId: colorId, valueId: redId }], status: "inactive" }] }));
  renderScreen();
  expect(await screen.findByText("Ninguna variante está a la venta. Activa una para volver a venderla en tu tienda y en «Nueva venta».")).toBeTruthy();
  expect(screen.getByText("Sin variantes activas")).toBeTruthy();
});
