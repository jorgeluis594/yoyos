import { productPrintWork } from "@mobile/features/products/presentation/product-print-work";
import type { PrintWork } from "@mobile/features/printing/presentation/print-provider";

const mockPrint = jest.fn();
jest.mock("@mobile/features/products/composition", () => ({ productPrinting: { printProductLabel: (...args: unknown[]) => mockPrint(...args) } }));

const execution = { isSessionCurrent: () => true, onStage: () => {} };
const work = (): PrintWork => productPrintWork({ kind: "created-product", productId: "00000000-0000-4000-8000-000000000001" as never }, 1 as never);

test.each([
  ["UNAUTHENTICATED", "Inicia sesión para consultar el producto e imprimir."],
  ["COMPANY_REQUIRED", "Selecciona una empresa para consultar el producto e imprimir."],
  ["NETWORK_ERROR", "No se pudo consultar el producto para imprimir."],
  ["LABEL_CONTENT_OVERFLOW", "El contenido no cabe completo en esta etiqueta."],
])("explains %s without blaming the printer", async (code, message) => {
  mockPrint.mockResolvedValueOnce({ success: false, error: { cause: { code, message: "failure" }, retry: { kind: "load-created-product" } } });
  expect(await work()(execution)).toEqual({ status: "failed", message, outcome: "not-sent" });
});
