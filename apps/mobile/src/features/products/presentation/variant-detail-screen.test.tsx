import "@mobile/i18n";
import { useEffect, type ReactNode } from "react";
import { Alert } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { err, ok } from "@shared/functional";
import VariantDetailScreen from "@mobile/features/products/presentation/variant-detail-screen";
import { ProductDraftProvider } from "@mobile/features/products/presentation/draft-guard";
import { ProductEditorProvider, useProductEditor } from "@mobile/features/products/presentation/product-editor-state";
import type { OptionId, OptionValueId, Product, ProductId, ProductVariant, VariantId, VariantQrCode } from "@mobile/features/products/domain/product";

const mockRouter = { back: jest.fn(), replace: jest.fn(), push: jest.fn(), dismissTo: jest.fn() };
const mockServices = {
  loadProduct: jest.fn(), updateVariant: jest.fn(), changeStatus: jest.fn(), deleteVariant: jest.fn(), changeCombination: jest.fn(),
};
let mockParams = { productId: "p1", variantId: "v-la" };
let mockOnline = true;

jest.mock("expo-router", () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams, useNavigation: () => ({ dispatch: jest.fn() }) }));
jest.mock("expo-router/react-navigation", () => ({ usePreventRemove: jest.fn() }));
jest.mock("expo-network", () => ({ getNetworkStateAsync: async () => ({ isConnected: mockOnline, isInternetReachable: mockOnline }) }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-0000000000aa" }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@mobile/features/printing/presentation/print-provider", () => ({ usePrint: () => ({ startAttempt: jest.fn(), showPrinterPicker: jest.fn(), printerName: null }) }));
jest.mock("@mobile/features/products/composition", () => ({
  products: { loadProduct: (...args: unknown[]) => mockServices.loadProduct(...args) },
  variants: {
    updateVariant: (...args: unknown[]) => mockServices.updateVariant(...args),
    changeStatus: (...args: unknown[]) => mockServices.changeStatus(...args),
    deleteVariant: (...args: unknown[]) => mockServices.deleteVariant(...args),
    changeCombination: (...args: unknown[]) => mockServices.changeCombination(...args),
  },
  productPrinting: {},
}));

const talla = "talla" as OptionId, color = "color" as OptionId;
const sizes = { M: "m" as OptionValueId, L: "l" as OptionValueId };
const colors = { Negro: "negro" as OptionValueId, Azul: "azul" as OptionValueId };
const variant = (id: string, size: keyof typeof sizes, hue: keyof typeof colors, patch: Partial<ProductVariant> = {}): ProductVariant => ({
  id: id as VariantId, qrCode: "00000000-0000-4000-8000-000000000009" as VariantQrCode, sku: `POLO-${hue}-${size}`,
  combination: [{ optionId: talla, valueId: sizes[size] }, { optionId: color, valueId: colors[hue] }],
  salePrice: { amount: 42.9, currency: "PEN" }, purchasePrice: { amount: 21, currency: "PEN" }, stock: 0, status: "active", hasOrders: false, ...patch,
});
const productWith = (variants: ProductVariant[]): Product => ({
  id: "p1" as ProductId, name: "Polo básico", currency: "PEN", structureVersion: 1,
  options: [{ id: talla, name: "Talla", values: [{ id: sizes.M, name: "M" }, { id: sizes.L, name: "L" }] }, { id: color, name: "Color", values: [{ id: colors.Negro, name: "Negro" }, { id: colors.Azul, name: "Azul" }] }],
  variants,
});
const siblings = () => [variant("v-ln", "L", "Negro"), variant("v-mn", "M", "Negro"), variant("v-ma", "M", "Azul")];
const withLA = (patch: Partial<ProductVariant> = {}) => productWith([variant("v-la", "L", "Azul", patch), ...siblings()]);

function Preload({ product, children }: { product: Product; children: ReactNode }) {
  const editor = useProductEditor();
  useEffect(() => { editor.publish(product); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return editor.detail ? <>{children}</> : null;
}
const open = (product: Product) => render(<ProductDraftProvider><ProductEditorProvider><Preload product={product}><VariantDetailScreen /></Preload></ProductEditorProvider></ProductDraftProvider>);
const confirmAlert = (alert: jest.SpyInstance, label: string) => {
  const buttons = alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  return act(async () => { buttons.find((button) => button.text === label)!.onPress!(); });
};

beforeEach(() => { jest.clearAllMocks(); mockParams = { productId: "p1", variantId: "v-la" }; mockOnline = true; });

test("Desactivar confirms with a native alert and shows the deactivated notice", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  try {
    const product = withLA({ stock: 6 });
    mockServices.changeStatus.mockResolvedValue(ok(productWith([{ ...product.variants[0], status: "inactive" }, ...siblings()])));
    open(product);
    expect(screen.getByText("L / Azul")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Desactivar variante" }));
    expect(alert.mock.calls[0][0]).toBe("¿Desactivar L / Azul?");
    expect(alert.mock.calls[0][1]).toContain("Todavía tiene 6 unidades en stock.");
    expect(alert.mock.calls[0][1]).not.toContain("última variante");
    await confirmAlert(alert, "Desactivar");
    expect(mockServices.changeStatus).toHaveBeenCalledWith("p1", "v-la", "inactive");
    expect(await screen.findByText("Variante desactivada. No aparece en tu tienda ni al crear pedidos.")).toBeTruthy();
    expect(screen.getByText("Variante desactivada")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Activar variante" })).toBeTruthy();
  } finally { alert.mockRestore(); }
});

test("delete reasons follow orders, stock, only variant", () => {
  const reasons = ["Tiene pedidos, por eso no se puede eliminar.", "Tiene 6 unidades en stock, por eso no se puede eliminar.", "Es la única variante del producto, por eso no se puede eliminar."];
  const first = open(withLA({ hasOrders: true, stock: 6 }));
  expect(screen.getByText(reasons[0])).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Eliminar variante" })).toBeNull();
  first.unmount();
  const second = open(withLA({ stock: 6 }));
  expect(screen.getByText(reasons[1])).toBeTruthy();
  second.unmount();
  const third = open(productWith([variant("v-la", "L", "Azul")]));
  expect(screen.getByText(reasons[2])).toBeTruthy();
  third.unmount();
  open(withLA());
  expect(screen.getByRole("button", { name: "Eliminar variante" })).toBeTruthy();
});

test("offline deactivation keeps the variant and shows the retry text", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  try {
    mockOnline = false;
    open(withLA());
    fireEvent.press(screen.getByRole("button", { name: "Desactivar variante" }));
    await confirmAlert(alert, "Desactivar");
    expect(mockServices.changeStatus).not.toHaveBeenCalled();
    expect(await screen.findByText("No se pudo desactivar la variante. Revisa tu conexión e inténtalo otra vez.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Desactivar variante" }).props.accessibilityState.disabled).toBe(false);
  } finally { alert.mockRestore(); }
});

test("a lost answer is never shown as success and offers Recargar variante", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  try {
    mockServices.changeStatus.mockResolvedValue(err({ code: "NETWORK_ERROR", message: "lost" }));
    open(withLA());
    fireEvent.press(screen.getByRole("button", { name: "Desactivar variante" }));
    await confirmAlert(alert, "Desactivar");
    expect(await screen.findByText("No se pudo confirmar el cambio. Recarga la variante para ver su estado.")).toBeTruthy();
    expect(screen.queryByText("Variante desactivada")).toBeNull();
    mockServices.loadProduct.mockResolvedValue(ok(productWith([{ ...withLA().variants[0], status: "inactive" }, ...siblings()])));
    fireEvent.press(screen.getByRole("button", { name: "Recargar variante" }));
    expect(await screen.findByRole("button", { name: "Activar variante" })).toBeTruthy();
  } finally { alert.mockRestore(); }
});

test("a deleted variant shows 'Esta variante ya no existe.' with Volver al producto", async () => {
  mockParams = { productId: "p1", variantId: "gone" };
  mockServices.loadProduct.mockResolvedValue(ok(withLA()));
  render(<ProductDraftProvider><ProductEditorProvider><VariantDetailScreen /></ProductEditorProvider></ProductDraftProvider>);
  expect(await screen.findByText("Esta variante ya no existe.")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Volver al producto" }));
  expect(mockRouter.dismissTo).toHaveBeenCalledWith({ pathname: "/products/[productId]", params: { productId: "p1" } });
});

test("a product of another company offers only Volver a productos", async () => {
  mockServices.loadProduct.mockResolvedValue(err({ code: "PRODUCT_NOT_FOUND", message: "x" }));
  render(<ProductDraftProvider><ProductEditorProvider><VariantDetailScreen /></ProductEditorProvider></ProductDraftProvider>);
  expect(await screen.findByText("Esta variante ya no existe.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Volver al producto" })).toBeNull();
  expect(screen.getByRole("button", { name: "Volver a productos" })).toBeTruthy();
});

test("Guardar sends the three fields and a taken SKU is marked on its field", async () => {
  open(withLA());
  mockServices.updateVariant.mockResolvedValue(err({ code: "DUPLICATE_SKU", message: "x" }));
  fireEvent.changeText(screen.getByLabelText("SKU"), "POLO-X");
  fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
  expect(await screen.findByText("Este SKU ya lo usa otra variante.")).toBeTruthy();
  expect(mockServices.updateVariant).toHaveBeenCalledWith("p1", "v-la", { sku: "POLO-X", salePrice: 42.9, purchasePrice: 21 });
  expect(screen.getByLabelText("SKU").props.value).toBe("POLO-X");
  fireEvent.changeText(screen.getByLabelText(/Precio de venta/), "0");
  fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
  expect(await screen.findByText("Escribe un precio mayor que 0.")).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText(/Precio de venta/), "10.999");
  fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
  expect(await screen.findByText("Usa como máximo 2 decimales.")).toBeTruthy();
});

test("changing the combination to a new value sends it once and the title follows the answer", async () => {
  const product = withLA();
  const changed = productWith([{ ...product.variants[0], combination: [{ optionId: talla, valueId: "xl" as OptionValueId }, { optionId: color, valueId: colors.Azul }] }, ...siblings()]);
  changed.options[0].values.push({ id: "xl" as OptionValueId, name: "XL" });
  mockServices.changeCombination.mockResolvedValue(ok(changed));
  open(product);
  fireEvent.press(screen.getByRole("button", { name: "Cambiar combinación" }));
  expect(screen.getByText("Los pedidos anteriores conservan «L / Azul».")).toBeTruthy();
  fireEvent.press(screen.getByRole("radio", { name: "Talla: M" }));
  fireEvent.press(screen.getByRole("button", { name: "Guardar combinación" }));
  expect(await screen.findByText("Ya existe la variante M / Azul. Elige otra combinación.")).toBeTruthy();
  fireEvent.press(screen.getByRole("radio", { name: "Talla: Otro valor…" }));
  fireEvent.changeText(screen.getByLabelText("Nuevo valor de Talla"), "XL");
  fireEvent.press(screen.getByRole("button", { name: "Guardar combinación" }));
  await waitFor(() => expect(mockServices.changeCombination).toHaveBeenCalledTimes(1));
  expect(mockServices.changeCombination).toHaveBeenCalledWith("p1", "v-la", { values: [
    { optionId: talla, newValue: { id: "00000000-0000-4000-8000-0000000000aa", name: "XL" } }, { optionId: color, valueId: colors.Azul }] });
  expect(await screen.findByText("Combinación cambiada")).toBeTruthy();
  expect(screen.getByText("XL / Azul")).toBeTruthy();
});
