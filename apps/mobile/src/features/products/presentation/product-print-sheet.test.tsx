import "@mobile/i18n";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ProductPrintSheet } from "@mobile/features/products/presentation/product-print-sheet";
import type { OptionId, OptionValueId, Product, VariantId, VariantQrCode } from "@mobile/features/products/domain/product";

jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@mobile/features/products/composition", () => ({ productPrinting: {} }));
jest.mock("@mobile/features/printing/presentation/print-provider", () => ({ usePrint: () => ({ showPrinterPicker: jest.fn(), printerName: "Brother" }) }));

const talla = "talla" as OptionId;
const sizes = { S: "s" as OptionValueId, L: "l" as OptionValueId };
const variant = (id: string, size: keyof typeof sizes, status: "active" | "inactive") => ({
  id: id as VariantId, qrCode: `${id}-qr` as VariantQrCode, combination: [{ optionId: talla, valueId: sizes[size] }], sku: `POLO-${size}`,
  salePrice: { amount: 20, currency: "PEN" as const }, stock: 1, status, hasOrders: false,
});
const product: Product = { id: "p" as Product["id"], name: "Polo", currency: "PEN", structureVersion: 1,
  options: [{ id: talla, name: "Talla", values: [{ id: sizes.S, name: "S" }, { id: sizes.L, name: "L" }] }],
  variants: [variant("v1", "S", "active"), variant("v2", "L", "inactive")] };

test("opened from a variant preselects it and lists inactive ones marked", () => {
  const onPrint = jest.fn();
  render(<ProductPrintSheet visible product={product} initialVariantId={"v2" as VariantId} unsavedChanges={false} onClose={jest.fn()} onPrint={onPrint} />);
  expect(screen.getByRole("radio", { name: "L · Desactivada" }).props.accessibilityState.checked).toBe(true);
  expect(screen.getByRole("radio", { name: "S" }).props.accessibilityState.checked).toBe(false);
  expect(screen.getByText("Desactivada")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Imprimir" }));
  expect(onPrint).toHaveBeenCalledWith("v2", 1);
});

test("without a preselected variant nothing is chosen until the seller picks one", () => {
  render(<ProductPrintSheet visible product={product} unsavedChanges={false} onClose={jest.fn()} onPrint={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Imprimir" }).props.accessibilityState.disabled).toBe(true);
});
