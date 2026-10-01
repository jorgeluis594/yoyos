import { productPrintWork } from "@mobile/features/products/presentation/product-print-work";
import type { PrintWork } from "@mobile/features/printing/presentation/print-provider";
import i18n from '@mobile/i18n';

const mockPrint = jest.fn();
jest.mock("@mobile/features/products/composition", () => ({ productPrinting: { printProductLabel: (...args: unknown[]) => mockPrint(...args) } }));

const execution = { isSessionCurrent: () => true, onStage: () => {} };
const work = (): PrintWork => productPrintWork({ kind: "created-product", productId: "00000000-0000-4000-8000-000000000001" as never }, 1 as never);

test.each([
  ["UNAUTHENTICATED", "Inicia sesión para consultar el producto e imprimir.", undefined],
  ["COMPANY_REQUIRED", "Selecciona una empresa para consultar el producto e imprimir.", undefined],
  ["NETWORK_ERROR", "No se pudo consultar el producto para imprimir.", undefined],
  ["LABEL_CONTENT_OVERFLOW", "El contenido no cabe completo en esta etiqueta.", undefined],
  ["RENDER_FAILED", "No se pudo preparar la etiqueta.", "not-sent"],
  ["UNSUPPORTED_FORMAT", "No se pudo preparar la etiqueta.", "not-sent"],
])("explains %s without blaming the printer", async (code, message, nativeOutcome) => {
  mockPrint.mockResolvedValueOnce({ success: false, error: { cause: { code, message: "failure", ...(nativeOutcome ? { outcome: nativeOutcome } : {}) }, retry: { kind: "load-created-product" } } });
  expect(await work()(execution)).toEqual({ status: "failed", message, outcome: "not-sent" });
});

test('print failures are translated to Portuguese', async () => {
  await i18n.changeLanguage('pt-BR');
  try {
    mockPrint.mockResolvedValueOnce({ success: false, error: { cause: { code: 'PAPER_EMPTY' }, retry: null } });
    expect(await work()(execution)).toMatchObject({ status: 'failed', message: 'A impressora está sem etiquetas.' });
  } finally {
    await i18n.changeLanguage('es');
  }
});
