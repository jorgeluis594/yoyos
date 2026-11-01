import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import { summarizeSales, type SummarizeSalesInput } from "@core/src/features/orders/application/summarize-sales";
import { readSalesFigures } from "@core/src/features/orders/infrastructure/sales-summary-repository";

/** The sales summary read; it joins the open snapshot of `readSalesForAssistant` when called inside it. */
export const salesSummaryOperations = {
  summarizeSales: (input: SummarizeSalesInput, context: OrderAccess) => summarizeSales(input, context, { readFigures: readSalesFigures }),
};
