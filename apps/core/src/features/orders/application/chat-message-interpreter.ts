import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { orchestrate, type OrchestrateDependencies, type ToolCallPlan } from "@core/src/shared/ai-tools/application/orchestrate";
import { executeToolCalls } from "@core/src/shared/ai-tools/application/execute-tool-calls";
import type { AiError } from "@core/src/shared/ai-tools/application/ai-error";
import type { ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import { toolsForKind, type ChatToolContext, type ChatToolRegistry, type ToolResolveError } from "@core/src/features/orders/application/chat-message-tools";

/** How the interpretation runs: the models choose, or the use case already knows the tool and no model is called. */
export type InterpretationPlan =
  | Readonly<{ kind: "decide"; /** The tool to run when the models are not sure what the message asks; null reports `ambiguous_intent`. */ fallbackTool: string | null }>
  | Readonly<{ kind: "tool"; tool: string }>;

export type ChatInterpretationRequest = Readonly<{
  context: ChatToolContext;
  /** The buyer's words, as text only: the image never reaches interpretation. */
  messageText: string | null;
  contextText: string;
  plan: InterpretationPlan;
}>;

export type InterpretationTrace = Readonly<{ tools: readonly string[]; extraction: boolean; decisionCalls: number }>;
export type Interpreted<T> = Readonly<{ applied: T; trace: InterpretationTrace }>;

export type InterpretAndApply = <T, RunError extends Readonly<{ code: string; message: string }>>(
  request: ChatInterpretationRequest,
  signal: AbortSignal,
  run: (actions: readonly ResolvedChatAction[]) => Promise<Result<T, RunError>>,
) => Promise<Result<Interpreted<T>, AiError | ToolResolveError | RunError>>;

const direct = (tool: string): Extract<ToolCallPlan, { kind: "calls" }> => ({ kind: "calls", calls: [{ tool, args: {} }], extraction: false });

/** Binds the generic orchestrator and executor to the chat tools. Without models (`ai` null) only planned tools can run. */
export function createChatInterpreter(registry: ChatToolRegistry, ai: OrchestrateDependencies | null): InterpretAndApply {
  return async (request, signal, run) => {
    const execute = async (plan: Extract<ToolCallPlan, { kind: "calls" }>, decisionCalls: number) => {
      const executed = await executeToolCalls({ plan, registry, context: request.context, signal, run });
      return executed.success ? ok({ applied: executed.data, trace: { tools: plan.calls.map(({ tool }) => tool), extraction: plan.extraction, decisionCalls } }) : executed;
    };
    if (request.plan.kind === "tool") return execute(direct(request.plan.tool), 0);
    if (!ai) return err({ code: "AI_PROVIDER_UNAVAILABLE" as const, message: "Interpretation is not configured" });
    const plan = await orchestrate({
      messageParts: request.messageText === null ? [] : [{ kind: "text", text: request.messageText }],
      contextText: request.contextText, context: request.context, tools: toolsForKind(registry, request.context.kind),
    }, ai, signal);
    if (!plan.success) return plan;
    if (plan.data.kind === "calls") return execute(plan.data, 1);
    if (request.plan.fallbackTool) return execute(direct(request.plan.fallbackTool), 1);
    const ambiguous = await run([{ kind: "report", outcome: { kind: "ambiguous_intent" } }]);
    return ambiguous.success ? ok({ applied: ambiguous.data, trace: { tools: [], extraction: false, decisionCalls: 1 } }) : ambiguous;
  };
}
