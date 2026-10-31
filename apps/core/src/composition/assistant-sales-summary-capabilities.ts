import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { walletProviderLabel, walletProviderSchema } from "@shared/wallet-providers";
import { orders } from "@core/src/features/orders";
import { catalogStorefront } from "@core/src/features/catalog";
import type { SalesFigures, SalesSummary } from "@core/src/features/orders/application/summarize-sales";
import type { ProjectableFigures, ProjectableSalesSummary } from "@core/src/features/assistants/domain/sales-projection";
import type { ToolModule } from "@core/src/features/assistants/presentation/tool-module";
import { createSalesSummaryTool, type SalesSummaryRead, type SalesSummaryToolDependencies } from "@core/src/features/assistants/presentation/tools/sales-summary-tool";
import { salesRead } from "@core/src/composition/assistant-sales-capabilities";

/** «Yape», «Plin» or the wallets of the country's catalog; «Transferencia bancaria» for a transfer; a wallet payment without a known provider has its own label. */
function methodLabel({ method, walletProvider }: SalesFigures["receivedBy"][number]): string {
  if (method === "bank_transfer") return "Transferencia bancaria";
  const provider = walletProviderSchema.safeParse(walletProvider);
  return provider.success ? walletProviderLabel(provider.data) : "Billetera digital sin especificar";
}

const figuresOf = (figures: SalesFigures): ProjectableFigures => ({
  ...figures, receivedBy: figures.receivedBy.map((received) => ({ label: methodLabel(received), amount: received.amount })),
});
const summaryOf = (summary: SalesSummary): ProjectableSalesSummary => ({ ...summary, current: summary.current.map(figuresOf), previous: summary.previous.map(figuresOf) });

/** The store currency and the figures of both windows in one sales snapshot; each read is a step so a timeout is told apart (period or catalog). */
export const salesSummaryDependencies: SalesSummaryToolDependencies = {
  clock: () => new Date(),
  summarize: (request, access) => salesRead("summary", access, request.periodDays, async (step): Promise<Result<SalesSummaryRead, Readonly<{ code: string; message: string }>>> => {
    const storefront = await step("storefront", "catalog", () => catalogStorefront.describe(access.companyId));
    if (!storefront.success) return storefront;
    const figures = await step("figures", "period", () => orders.summarizeSales({ current: request.current, previous: request.previous }, { companyId: access.companyId, userId: access.userId }));
    if (!figures.success) return figures;
    return ok({ summary: summaryOf(figures.data), storeCurrency: storefront.data.currency });
  }),
};

/** The sales summary tool; the sales module (`assistant-tools.ts`) offers it with the product tools of the other sales task. */
export const salesSummaryTools: ToolModule["tools"] = [createSalesSummaryTool(salesSummaryDependencies)];
