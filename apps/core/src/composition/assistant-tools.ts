import type { ToolModule } from "@core/src/features/assistants/presentation/tool-module";
import { createOrderToolsModule } from "@core/src/features/assistants/presentation/tools/orders-tools";
import { orderToolsDependencies } from "@core/src/composition/assistant-order-capabilities";
import { createProductToolsModule } from "@core/src/features/assistants/presentation/tools/products-tools";
import { productToolsDependencies } from "@core/src/composition/assistant-product-capabilities";
import { createSalesToolsModule } from "@core/src/features/assistants/presentation/tools/sales-tools";
import { salesSummaryTools } from "@core/src/composition/assistant-sales-summary-capabilities";
import { productSalesTools } from "@core/src/composition/assistant-product-sales-capabilities";

/**
 * The tool modules the MCP server offers: one per data category, plus the sales group that needs both scopes. MCP 3/4-4/4 each add their module file and one entry here;
 * `assistant-tools.test.ts` (also `pnpm --dir apps/core mcp:validate`) checks every entry against the rules of the registry.
 */
export const toolModules: readonly ToolModule[] = [createOrderToolsModule(orderToolsDependencies), createProductToolsModule(productToolsDependencies), createSalesToolsModule([...salesSummaryTools, ...productSalesTools])];
