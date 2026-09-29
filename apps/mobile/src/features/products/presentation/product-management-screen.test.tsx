import { fireEvent, render, screen } from "@testing-library/react-native";
import { Alert } from "react-native";
import { ok } from "@shared/functional";
import ProductManagementScreen from "@mobile/features/products/presentation/product-management-screen";
import type { PrintWork } from "@mobile/features/printing/presentation/print-provider";

const mockLoadProduct = jest.fn();
const mockStartAttempt = jest.fn();
const mockPrintProductLabel = jest.fn();
const product = {
  id: "product-1", name: "Camisa", currency: "PEN",
  variants: [{ id: "variant-1", qrCode: "qr-1", attributes: {}, sku: "CAM-1", salePrice: { amount: 20, currency: "PEN" }, stock: 1 }],
};

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ productId: "product-1" }), useRouter: () => ({ replace: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: jest.requireActual("react-native").View }));
jest.mock("@mobile/features/users/presentation/access-provider", () => ({ useAccess: () => ({ state: { status: "ready" } }) }));
jest.mock("@mobile/features/products/composition", () => ({
  products: { loadProduct: (...args: unknown[]) => mockLoadProduct(...args), uploadImage: jest.fn() },
  productPrinting: { printProductLabel: (...args: unknown[]) => mockPrintProductLabel(...args) },
}));
jest.mock("@mobile/features/printing/presentation/print-provider", () => ({ usePrint: () => ({ startAttempt: mockStartAttempt }) }));
jest.mock("@mobile/features/products/presentation/use-product-navigation-guard", () => ({ useProductNavigationGuard: () => jest.fn() }));
jest.mock("@mobile/features/products/presentation/draft-guard", () => ({ useProductDraft: () => ({ discardVersion: 0 }) }));
jest.mock("@mobile/features/products/presentation/product-photo", () => ({ ProductPhoto: () => null }));

test("printing with draft changes uses saved product in one press", async () => {
  mockLoadProduct.mockResolvedValue(ok(product));
  mockPrintProductLabel.mockResolvedValue(ok({ status: "completed", receipt: { confirmation: "sdk" } }));
  const alert = jest.spyOn(Alert, "alert");
  try {
    render(<ProductManagementScreen />);
    fireEvent.changeText(await screen.findByLabelText("Nombre *"), "Camisa editada");
    expect(screen.getByText("La etiqueta usará los datos guardados, sin incluir los cambios de este formulario.")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Imprimir etiqueta" }));
    expect(alert).not.toHaveBeenCalled();
    expect(mockStartAttempt).toHaveBeenCalledTimes(1);
    const work = mockStartAttempt.mock.calls[0][0] as PrintWork;
    const execution = { isSessionCurrent: () => true, onStage: jest.fn() };
    expect(await work(execution)).toEqual({ status: "completed" });
    expect(mockPrintProductLabel).toHaveBeenCalledWith({ kind: "saved-product", product, variantId: "variant-1" }, 1, execution);
  } finally { alert.mockRestore(); }
});
