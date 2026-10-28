import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { orchestrate, type OrchestrateDependencies, type ToolCallPlan } from "@core/src/shared/ai-tools/application/orchestrate";
import { executeToolCalls } from "@core/src/shared/ai-tools/application/execute-tool-calls";
import type { AiError } from "@core/src/shared/ai-tools/application/ai-error";
import type { ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import { toolsFor, type ChatToolName, type ChatToolRegistry } from "@core/src/features/orders/application/chat-message-actions";
import type { ChatToolContext, ToolResolveError } from "@core/src/features/orders/application/chat-tool-types";
import { isChangeRequested } from "@core/src/features/orders/application/chat-text-actions";

/** How the interpretation runs: the models choose, or the use case already knows the tool and no model is called. */
export type InterpretationPlan =
  | Readonly<{ kind: "decide"; /** The tool to run when the models are not sure what the message asks; null reports `ambiguous_intent`. */ fallbackTool: string | null }>
  | Readonly<{ kind: "tool"; tool: string }>;

export type ChatInterpretationRequest = Readonly<{
  context: ChatToolContext;
  /** The buyer's words, as text only: the image never reaches interpretation. */
  messageText: string | null;
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

/** The orchestrator lists the tools without extracted arguments first; the registry order is the order a message reads in («agrega una gorra y listo» adds before it is ready). */
function inRegistryOrder(plan: Extract<ToolCallPlan, { kind: "calls" }>, registry: ChatToolRegistry): Extract<ToolCallPlan, { kind: "calls" }> {
  const position = (tool: string) => registry.tools.findIndex(({ name }) => name === tool);
  const [first, ...rest] = [...plan.calls].sort((left, right) => position(left.tool) - position(right.tool));
  return first ? { ...plan, calls: [first, ...rest] } : plan;
}

/**
 * Founder rule (docs/message-to-order.md «Change variant»): only an explicit change request changes an item's variant. A variant call
 * whose Decision answer is missing or not a confident `requested` becomes the `variant_only` report, once per message, so nothing changes
 * and the seller is told; the message's other calls stay.
 */
export function variantOnlyRule(plan: Extract<ToolCallPlan, { kind: "calls" }>): Extract<ToolCallPlan, { kind: "calls" }> {
  const requested = (args: unknown) => isChangeRequested((args as { change?: unknown } | null)?.change);
  const report = { tool: "report_variant_without_product" satisfies ChatToolName, args: {} };
  const rewritten = plan.calls.map((call) => call.tool === ("change_item_variant" satisfies ChatToolName) && !requested(call.args) ? report : call);
  // Two rewritten variant calls are one notice, not two.
  const [first, ...rest] = rewritten.filter((call, index) => call !== report || rewritten.indexOf(report) === index);
  return { ...plan, calls: [first!, ...rest] };
}

/** The order and photo as text for the models; infrastructure words it. */
export type DescribeChatContext = (context: ChatToolContext) => string;

/** Binds the generic orchestrator and executor to the chat tools. Without models (`ai` null) only planned tools can run. */
export function createChatInterpreter(registry: ChatToolRegistry, ai: OrchestrateDependencies | null, describeContext: DescribeChatContext): InterpretAndApply {
  return async (request, signal, run) => {
    const execute = async (unordered: Extract<ToolCallPlan, { kind: "calls" }>, decisionCalls: number) => {
      const plan = inRegistryOrder(variantOnlyRule(unordered), registry);
      const executed = await executeToolCalls({ plan, registry, context: request.context, signal, run });
      return executed.success ? ok({ applied: executed.data, trace: { tools: plan.calls.map(({ tool }) => tool), extraction: plan.extraction, decisionCalls } }) : executed;
    };
    if (request.plan.kind === "tool") return execute(direct(request.plan.tool), 0);
    if (!ai) return err({ code: "AI_PROVIDER_UNAVAILABLE" as const, message: "Interpretation is not configured" });
    const plan = await orchestrate({
      messageParts: request.messageText === null ? [] : [{ kind: "text", text: request.messageText }],
      contextText: describeContext(request.context), context: request.context, tools: toolsFor(registry, request.context),
    }, ai, signal);
    if (!plan.success) return plan;
    if (plan.data.kind === "calls") return execute(plan.data, 1);
    if (request.plan.fallbackTool) return execute(direct(request.plan.fallbackTool), 1);
    const ambiguous = await run([{ kind: "report", outcome: { kind: "ambiguous_intent" } }]);
    return ambiguous.success ? ok({ applied: ambiguous.data, trace: { tools: [], extraction: false, decisionCalls: 1 } }) : ambiguous;
  };
}
