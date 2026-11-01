import type { AssistantScope } from "@core/src/features/assistants/domain/scopes";
import type { RegisteredTool } from "@core/src/features/assistants/application/answer-tool-call";

export type { RegisteredTool, ToolRun, ToolRunError } from "@core/src/features/assistants/application/answer-tool-call";

/**
 * One group of tools. A module over one data category declares that category's scope; a group over several categories declares several scopes
 * and adds no literal. A new category adds a module file, its scope literal and one entry in `src/composition/assistant-tools.ts`;
 * it never edits the server, the transport, the limiter or another module.
 */
export type ToolModule = Readonly<{
  scopes: readonly [AssistantScope, ...AssistantScope[]];   // a connection sees the module only when it holds every one
  access: "read";                        // the only value this version accepts; a write module needs its own design
  instructions: string;                  // paragraph appended to the server instructions
  readFailureMessage: string;            // what the agent receives when a read of this module fails or its output breaks the schema; names the module's own data
  // The tool list is heterogeneous (each tool has its own input and output types), so the registry holds them without their type arguments.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: readonly RegisteredTool<any, any>[];
}>;
