import { err } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { invalidAiResponse, type AiError } from "@core/src/shared/ai-tools/application/ai-error";
import type { ToolCallPlan } from "@core/src/shared/ai-tools/application/orchestrate";
import type { ToolRegistry } from "@core/src/shared/ai-tools/application/tool-registry";

export type ExecuteToolCallsInput<Context, Action, E extends AppError, T, RunError extends AppError> = Readonly<{
  plan: Extract<ToolCallPlan, { kind: "calls" }>;
  registry: ToolRegistry<Context, Action, E>;
  context: Context;
  signal: AbortSignal;
  /** The caller applies the actions to its own state. */
  run: (actions: readonly Action[]) => Promise<Result<T, RunError>>;
}>;

/** Validates and resolves every call outside any transaction, then hands the concatenated actions to `run`. */
export async function executeToolCalls<Context, Action, E extends AppError, T, RunError extends AppError>(
  input: ExecuteToolCallsInput<Context, Action, E, T, RunError>,
): Promise<Result<T, E | AiError | RunError>> {
  const actions: Action[] = [];
  for (const call of input.plan.calls) {
    const tool = input.registry.get(call.tool);
    if (!tool) {
      log.warn({ event: "ai_tool_unknown", tool: call.tool }, "ai_tool_unknown");
      return err(invalidAiResponse("Unknown tool"));
    }
    const resolved = await tool.parseAndResolve(call.args, input.context, input.signal);
    if (!resolved.success) return resolved;
    actions.push(...resolved.data);
  }
  return input.run(actions);
}

