import type { ToolModule } from "@core/src/features/assistants/presentation/tool-module";

/**
 * The tool modules the MCP server offers, one per data category. MCP 2/4-4/4 each add their module file and one entry here;
 * `assistant-tools.test.ts` (also `pnpm --dir apps/core mcp:validate`) checks every entry against the rules of the registry.
 */
export const toolModules: readonly ToolModule[] = [];
