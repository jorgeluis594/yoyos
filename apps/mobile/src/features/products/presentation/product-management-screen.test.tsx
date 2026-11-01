import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, Alert, type AlertButton } from "react-native";
import * as ImagePicker from "expo-image-picker";
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
const mockUpload = jest.fn();
const productId = "00000000-0000-4000-8000-000000000001";
const product = {
  id: productId, name: "Camisa", currency: "PEN", photos: [], structureVersion: 1, hidden: false, options: [],
  variants: [{ id: "variant-1", qrCode: "qr-1", combination: [], sku: "CAM-1", salePrice: { amount: 20, currency: "PEN" }, stock: 1, status: "active", hasOrders: false }],
};

let mockOnline = true;
const mockReplace = jest.fn();
const mockPush = jest.fn();
const renderScreen = () => render(<ProductEditorProvider><ProductManagementScreen /></ProductEditorProvider>);
jest.mock("expo-network", () => ({ getNetworkStateAsync: async () => ({ isConnected: mockOnline, isInternetReachable: mockOnline }) }));
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ productId }), useRouter: () => ({ replace: mockReplace, push: mockPush, canGoBack: () => false, back: jest.fn() }) }));
jest.mock("expo-image-picker", () => ({ requestCameraPermissionsAsync: jest.fn(), launchCameraAsync: jest.fn(), launchImageLibraryAsync: jest.fn() }));
jest.mock("@mobile/shared/infrastructure/jpeg-fitting", () => ({ fitJpeg: async (uri: string) => ({ success: true, data: uri }) }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: { status: "ready" } }) }));
jest.mock("@mobile/features/products/composition", () => ({
  products: { loadProduct: (...args: unknown[]) => mockLoadProduct(...args), saveProduct: (...args: unknown[]) => mockSaveProduct(...args), uploadImage: (...args: unknown[]) => mockUpload(...args) },
  productPrinting: { printProductLabel: (...args: unknown[]) => mockPrintProductLabel(...args) },
}));
jest.mock("@mobile/features/printing/presentation/print-provider", () => ({ usePrint: () => ({ startAttempt: mockStartAttempt }) }));
jest.mock("@mobile/features/products/presentation/use-product-navigation-guard", () => ({ useProductNavigationGuard: (dirty: boolean) => { mockGuard(dirty); return jest.fn(); } }));
let mockDiscardVersion = 0;
jest.mock("@mobile/features/products/presentation/draft-guard", () => ({ useProductDraft: () => ({ discardVersion: mockDiscardVersion }) }));

beforeEach(() => { jest.clearAllMocks(); mockOnline = true; mockDiscardVersion = 0; });

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
      id: productId, name: savedName, description: null, hidden: false, photos: [], currency: "PEN", qrCode: "00000000-0000-4000-8000-000000000006",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", structureVersion: 1,
      options: [{ id: colorId, name: "Color", values: [{ id: redId, name: "Rojo" }, { id: blueId, name: "Azul" }] }],
      variants: [
        { id: firstId, combination: [{ optionId: colorId, valueId: redId }], sku: null, salePrice: { amount: 20, currency: "PEN" }, purchasePrice: null, qrCode: "00000000-0000-4000-8000-000000000004", status: "active", stock: 1, hasOrders: false },
        { id: secondId, combination: [{ optionId: colorId, valueId: blueId }], sku: "AZUL-1", salePrice: { amount: 22, currency: "PEN" }, purchasePrice: null, qrCode: secondQr, status: "active", stock: 2, hasOrders: false },
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
    expect(renderProductLabel).toHaveBeenCalledWith({ productName: "Camisa", combination: "Azul", sku: "AZUL-1", qrCode: secondQr }, expect.anything());
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

test("an edit saved offline says it was not sent, keeps the form and never calls core", async () => {
  mockOnline = false;
  mockLoadProduct.mockResolvedValue(ok(product));
  const alert = jest.spyOn(Alert, "alert");
  try {
    renderScreen();
    fireEvent.changeText(await screen.findByLabelText("Nombre *"), "Camisa editada");
    fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("No se pudo guardar. Revisa tu conexión e inténtalo otra vez.")).toBeTruthy();
    expect(screen.queryByText("Puede que se hayan guardado los cambios. Recarga el producto para revisarlos.")).toBeNull();
    expect(mockSaveProduct).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nombre *").props.value).toBe("Camisa editada");
    expect(alert).not.toHaveBeenCalled();
  } finally { alert.mockRestore(); }
});

test("an edit sent whose answer is lost is in doubt, keeps the form and offers to reload", async () => {
  mockLoadProduct.mockResolvedValue(ok(product));
  mockSaveProduct.mockResolvedValue(err({ code: "NETWORK_ERROR", message: "lost" }));
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

describe("photos", () => {
  const first = { id: "00000000-0000-4000-8000-0000000000a1", url: "https://cdn.example/a.jpg" };
  const withPhoto = { ...product, photos: [first] };
  let alert: jest.SpyInstance;
  let release: (answer: unknown) => void;
  const addPhoto = async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: "file:///b.jpg", width: 100, height: 100 }] } as never);
    fireEvent.press(screen.getByLabelText("Agregar fotos, Cámara o galería"));
    await act(async () => { (alert.mock.calls.at(-1)?.[2] as AlertButton[]).find((button) => button.text === "Elegir de galería")?.onPress?.(); });
  };
  const uploaded = { success: true, data: { id: "00000000-0000-4000-8000-0000000000b2", url: "https://cdn.example/b.jpg" } };
  beforeEach(() => {
    alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
    jest.spyOn(AccessibilityInfo, "setAccessibilityFocus").mockImplementation(() => {});
    mockUpload.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    mockLoadProduct.mockResolvedValue(ok(withPhoto));
  });
  afterEach(() => { alert.mockRestore(); jest.restoreAllMocks(); jest.useRealTimers(); });

  test("saving without touching photos omits photoIds", async () => {
    mockSaveProduct.mockResolvedValue(ok({ product: withPhoto, catalogEmptied: false }));
    renderScreen();
    fireEvent.changeText(await screen.findByLabelText("Nombre *"), "Camisa nueva");
    await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar" })); });
    expect(mockSaveProduct).toHaveBeenCalledWith(expect.objectContaining({ photos: { kind: "untouched" } }));
  });

  test("while an upload runs, the add tile stays, Guardar explains and sends nothing, and X stays enabled", async () => {
    renderScreen();
    await screen.findByText("Editar producto");
    await addPhoto();
    expect(screen.getByLabelText("Agregar fotos, Cámara o galería")).toBeTruthy();
    expect(mockGuard).toHaveBeenLastCalledWith(true);
    await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar" })); });
    expect(screen.getByText("Espera a que terminen de subir las fotos.")).toBeTruthy();
    expect(mockSaveProduct).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cerrar" }).props.accessibilityState.disabled).toBe(false);
  });

  test("Guardar with a failed photo shows the message at the top and focuses that thumbnail", async () => {
    jest.useFakeTimers();
    jest.spyOn(jest.requireActual("react-native"), "findNodeHandle").mockReturnValue(7);
    renderScreen();
    await screen.findByText("Editar producto");
    await addPhoto();
    await act(async () => { release({ success: false, error: { code: "NETWORK_ERROR", message: "x" } }); });
    await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar" })); });
    expect(screen.getByText("Reintenta o quita las fotos que no se subieron.")).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(7);
    expect(mockSaveProduct).not.toHaveBeenCalled();
  });

  test("a save rejected with PHOTO_NOT_FOUND at index 1 marks the second sent photo with its reason", async () => {
    mockSaveProduct.mockResolvedValue(err({ code: "VALIDATION_ERROR", message: "x", issues: [{ scope: "photo", field: "photoIds", index: 1, reason: "PHOTO_NOT_FOUND" }] }));
    renderScreen();
    await screen.findByText("Editar producto");
    await addPhoto();
    await act(async () => { release(uploaded); });
    await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar" })); });
    expect(mockSaveProduct).toHaveBeenCalledWith(expect.objectContaining({ photos: { kind: "set", photoIds: [first.id, uploaded.data.id] } }));
    expect(screen.getByLabelText("Foto 2 de 2, No pudimos usar esta foto. Quítala o súbela de nuevo.")).toBeTruthy();
    expect(screen.getByLabelText("Nombre *").props.value).toBe("Camisa");
  });

  test("Cancelar or X with an upload in progress asks ¿Descartar cambios? and Descartar leaves the product as saved", async () => {
    const view = renderScreen();
    await screen.findByText("Editar producto");
    expect(mockGuard).toHaveBeenLastCalledWith(false);
    await addPhoto();
    expect(mockGuard).toHaveBeenLastCalledWith(true);
    mockDiscardVersion = 1;
    view.rerender(<ProductEditorProvider><ProductManagementScreen /></ProductEditorProvider>);
    await act(async () => { release(uploaded); });
    expect(screen.getByLabelText("Foto 1 de 1, principal")).toBeTruthy();
    expect(screen.queryByLabelText(/Foto 2 de/)).toBeNull();
    expect(mockGuard).toHaveBeenLastCalledWith(false);
  });

  test("a save rejected with TOO_MANY_PHOTOS shows the form-level message and keeps the form", async () => {
    jest.useFakeTimers();
    jest.spyOn(jest.requireActual("react-native"), "findNodeHandle").mockReturnValue(9);
    mockSaveProduct.mockResolvedValue(err({ code: "VALIDATION_ERROR", message: "x", issues: [{ scope: "product", field: "photoIds", reason: "TOO_MANY_PHOTOS", maximum: 8 }] }));
    renderScreen();
    fireEvent.changeText(await screen.findByLabelText("Nombre *"), "Camisa nueva");
    await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar" })); });
    expect(screen.getByText("Un producto puede tener hasta 8 fotos. Quita alguna y guarda de nuevo.")).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(9);
    expect(screen.getByLabelText("Nombre *").props.value).toBe("Camisa nueva");
  });

  test("a product created before the change shows its photo as 1 de 8 fotos and Principal", async () => {
    renderScreen();
    expect(await screen.findByText("1 de 8 fotos")).toBeTruthy();
    expect(screen.getByText("Principal")).toBeTruthy();
  });
});

describe("hide product", () => {
  const savedWith = (hidden: boolean, catalogEmptied: boolean) => ok({ product: { ...product, hidden }, catalogEmptied });
  let alert: jest.SpyInstance;
  beforeEach(() => { alert = jest.spyOn(Alert, "alert").mockImplementation(() => {}); });
  afterEach(() => alert.mockRestore());

  test("the product form saves the hidden switch and omits it when toggled back", async () => {
    mockLoadProduct.mockResolvedValue(ok(product));
    mockSaveProduct.mockResolvedValue(savedWith(true, false));
    renderScreen();
    const toggle = await screen.findByLabelText("Ocultar producto");
    expect(toggle.props.value).toBe(false);
    fireEvent(toggle, "valueChange", true);
    await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar" })); });
    expect(mockSaveProduct).toHaveBeenLastCalledWith(expect.objectContaining({ hidden: true, current: expect.objectContaining({ hidden: false }) }));
    expect(screen.getByLabelText("Ocultar producto").props.value).toBe(true);
  });

  test("a changed switch triggers the discard guard", async () => {
    mockLoadProduct.mockResolvedValue(ok(product));
    renderScreen();
    fireEvent(await screen.findByLabelText("Ocultar producto"), "valueChange", true);
    expect(mockGuard).toHaveBeenLastCalledWith(true);
    fireEvent(screen.getByLabelText("Ocultar producto"), "valueChange", false);
    expect(mockGuard).toHaveBeenLastCalledWith(false);
  });

  test("the switch shows no hint and is disabled while saving", async () => {
    mockLoadProduct.mockResolvedValue(ok(product));
    let finish: (answer: unknown) => void = () => {};
    mockSaveProduct.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderScreen();
    expect(await screen.findByLabelText("Ocultar producto")).toBeTruthy();
    expect(screen.queryByText(/Si lo ocultas/)).toBeNull();
    expect(screen.getByLabelText("Ocultar producto").props.accessibilityHint).toBeUndefined();
    fireEvent(screen.getByLabelText("Ocultar producto"), "valueChange", true);
    await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar" })); });
    expect(screen.getByLabelText("Ocultar producto").props.disabled).toBe(true);
    await act(async () => { finish(savedWith(true, false)); });
    expect(screen.getByLabelText("Ocultar producto").props.disabled).toBe(false);
  });

  test("the saved alert adds the last-visible paragraph when the catalog was emptied", async () => {
    mockLoadProduct.mockResolvedValue(ok(product));
    mockSaveProduct.mockResolvedValue(savedWith(true, true));
    renderScreen();
    fireEvent(await screen.findByLabelText("Ocultar producto"), "valueChange", true);
    await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar" })); });
    expect(alert).toHaveBeenCalledWith("Cambios guardados", "El producto se actualizó correctamente.\n\nTu catálogo publicado se quedó sin productos visibles. Tus clientes verán la tienda vacía.");
  });

  test("the saved alert keeps one paragraph when the catalog was not emptied", async () => {
    mockLoadProduct.mockResolvedValue(ok(product));
    mockSaveProduct.mockResolvedValue(savedWith(true, false));
    renderScreen();
    fireEvent(await screen.findByLabelText("Ocultar producto"), "valueChange", true);
    await act(async () => { fireEvent.press(screen.getByRole("button", { name: "Guardar" })); });
    expect(alert).toHaveBeenCalledWith("Cambios guardados", "El producto se actualizó correctamente.");
  });
});
