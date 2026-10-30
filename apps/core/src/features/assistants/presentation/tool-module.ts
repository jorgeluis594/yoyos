import type { AssistantScope } from "@core/src/features/assistants/domain/scopes";
import type { RegisteredTool } from "@core/src/features/assistants/application/answer-tool-call";

export type { RegisteredTool, ToolRun, ToolRunError } from "@core/src/features/assistants/application/answer-tool-call";

/**
 * One data category's tools. A later category adds a module file, a scope literal and one entry in `src/composition/assistant-tools.ts`;
 * it never edits the server, the transport, the limiter or another module.
 */
export type ToolModule = Readonly<{
  scope: AssistantScope;                 // a connection without it does not see these tools
  access: "read";                        // the only value this version accepts; a write module needs its own design
  instructions: string;                  // paragraph appended to the server instructions
  // The tool list is heterogeneous (each tool has its own input and output types), so the registry holds them without their type arguments.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: readonly RegisteredTool<any, any>[];
}>;
