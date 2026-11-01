import type { ToolModule } from "@core/src/features/assistants/presentation/tool-module";
import { salesReadFailureMessage, salesToolsInstructions } from "@core/src/features/assistants/presentation/tools/sales-texts";

/** The sales group reads orders, payments, items and products, so it needs both consents; it adds no scope literal. */
export function createSalesToolsModule(tools: ToolModule["tools"]): ToolModule {
  return { scopes: ["orders:read", "products:read"], access: "read", instructions: salesToolsInstructions, readFailureMessage: salesReadFailureMessage, tools };
}
