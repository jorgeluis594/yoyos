import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { invalidAiResponse, type AiError } from "@core/src/shared/ai-tools/application/ai-error";
import type { DecisionChoiceQuestion, JsonSchema, OfferedTool } from "@core/src/shared/ai-tools/application/tool-registry";

export type { AiError };

export type MessagePart =
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "image"; dataUrl: string }>;

export type ToolCall = Readonly<{ tool: string; args: unknown }>;

export type ToolCallPlan =
  | Readonly<{ kind: "calls"; calls: readonly [ToolCall, ...ToolCall[]]; extraction: boolean }>
  | Readonly<{ kind: "ambiguous" }>;

export const SEVERAL = "several";

/** One Decision API request. Choice ids are `tool:field`; the client uses them as question names. */
export type DecisionRequest = Readonly<{
  contextText: string;
  messageParts: readonly MessagePart[];
  action: Readonly<{ instructions: string; choices: readonly Readonly<{ value: string; description: string }>[] }>;
  predicates: readonly Readonly<{ tool: string; instructions: string }>[];
  choices: readonly Readonly<{ id: string } & Omit<DecisionChoiceQuestion, "name">>[];
}>;

export type DecisionAnswers = Readonly<{
  action: Readonly<{ choice: string; confidence: number }>;
  predicates: Readonly<Record<string, number>>;
  choices: Readonly<Record<string, Readonly<{ value: string | boolean; confidence: number }>>>;
}>;

export type ExtractionRequest = Readonly<{
  contextText: string;
  messageParts: readonly MessagePart[];
  tools: readonly Readonly<{ name: string; description: string; jsonSchema: JsonSchema }>[];
}>;

/** The fixed wording of the Decision request. It is text for a model, so infrastructure supplies it. */
export type DecisionRequestText = Readonly<{
  actionInstructions: string;
  /** The description of the `several` action choice. */
  several: string;
  /** A tool's predicate question, from the tool's description. */
  predicate: (toolDescription: string) => string;
}>;

export type OrchestrateDependencies = Readonly<{
  text: DecisionRequestText;
  decide: (request: DecisionRequest, signal: AbortSignal) => Promise<Result<DecisionAnswers, AiError>>;
  extract: (request: ExtractionRequest, signal: AbortSignal) => Promise<Result<readonly ToolCall[], AiError>>;
  minActionConfidence: number;
  minToolPredicate: number;
  /** Under the action gate, a report-only tool whose own predicate reaches this, while no other tool's reaches `minToolPredicate`, is still called. */
  minReportPredicate: number;
}>;

type OfferedQuestions = ReadonlyMap<string, readonly DecisionChoiceQuestion[]>;

const choiceId = (tool: string, field: string) => `${tool}:${field}`;

function questionsOf<Context>(tool: OfferedTool<Context>, context: Context): readonly DecisionChoiceQuestion[] {
  return tool.args.kind === "none" ? [] : tool.args.questions?.(context) ?? [];
}

function buildDecisionRequest<Context>(input: OrchestrateInput<Context>, questions: OfferedQuestions, text: DecisionRequestText): DecisionRequest {
  return {
    contextText: input.contextText,
    messageParts: input.messageParts,
    action: {
      instructions: text.actionInstructions,
      choices: [
        ...input.tools.map((tool) => ({ value: tool.name, description: tool.description })),
        { value: SEVERAL, description: text.several },
      ],
    },
    predicates: input.tools.map((tool) => ({ tool: tool.name, instructions: text.predicate(tool.description) })),
    choices: input.tools.flatMap((tool) => (questions.get(tool.name) ?? []).map(({ name, ...question }) => ({ id: choiceId(tool.name, name), ...question }))),
  };
}

/** The Decision answers of a tool's questions as `{ field: { value, confidence } }`, or null when one is missing or not offered. */
function decisionArguments(tool: string, questions: readonly DecisionChoiceQuestion[], answers: DecisionAnswers): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  for (const question of questions) {
    const answer = answers.choices[choiceId(tool, question.name)];
    if (!answer || !question.choices.some(({ value }) => value === answer.value)) return null;
    result[question.name] = { value: answer.value, confidence: answer.confidence };
  }
  return result;
}

function withoutFields(schema: JsonSchema, fields: ReadonlySet<string>): JsonSchema {
  if (fields.size === 0) return schema;
  const properties = Object.fromEntries(Object.entries((schema.properties ?? {}) as Record<string, unknown>).filter(([name]) => !fields.has(name)));
  const required = ((schema.required ?? []) as string[]).filter((name) => !fields.has(name));
  return { ...schema, properties, required };
}

/**
 * The report-only tool without arguments the Decision's predicates point at alone, when the action choice is unsure: the action
 * spreads over similar tools, while the tool's own predicate may still be clear. A report changes nothing, so a wrong one costs a
 * notice, never a change.
 */
function clearReportOf<Context>(tools: readonly OfferedTool<Context>[], answers: DecisionAnswers, deps: OrchestrateDependencies): OfferedTool<Context> | null {
  const predicateOf = (tool: OfferedTool<Context>) => answers.predicates[tool.name] ?? 0;
  const [report, ...others] = tools.filter((tool) => tool.reportOnly && tool.args.kind === "none" && predicateOf(tool) >= deps.minReportPredicate);
  if (!report || others.length) return null;
  return tools.every((tool) => tool === report || predicateOf(tool) < deps.minToolPredicate) ? report : null;
}

export type OrchestrateInput<Context> = Readonly<{
  messageParts: readonly MessagePart[];
  contextText: string;
  context: Context;
  tools: readonly OfferedTool<Context>[];
}>;

/** Decides which tools a message calls, asking the extraction model only for tools whose arguments are free-form. */
export async function orchestrate<Context>(
  input: OrchestrateInput<Context>,
  deps: OrchestrateDependencies,
  signal: AbortSignal,
): Promise<Result<ToolCallPlan, AiError>> {
  if (input.tools.length === 0) return ok({ kind: "ambiguous" });
  const questions: OfferedQuestions = new Map(input.tools.map((tool) => [tool.name, questionsOf(tool, input.context)]));
  const decided = await deps.decide(buildDecisionRequest(input, questions, deps.text), signal);
  if (!decided.success) return decided;
  const answers = decided.data;

  const offered = new Set(input.tools.map(({ name }) => name));
  if (!offered.has(answers.action.choice) && answers.action.choice !== SEVERAL) return err(invalidAiResponse("The decision chose a tool that was not offered"));
  if (answers.action.confidence < deps.minActionConfidence) {
    const report = clearReportOf(input.tools, answers, deps);
    return report ? ok({ kind: "calls", calls: [{ tool: report.name, args: {} }], extraction: false }) : ok({ kind: "ambiguous" });
  }

  const selected = answers.action.choice === SEVERAL
    ? input.tools.filter((tool) => (answers.predicates[tool.name] ?? 0) >= deps.minToolPredicate)
    : input.tools.filter((tool) => tool.name === answers.action.choice);
  if (selected.length === 0 || (answers.action.choice === SEVERAL && selected.length < 2)) return ok({ kind: "ambiguous" });

  const calls: ToolCall[] = [];
  const extracted: OfferedTool<Context>[] = [];
  const decisionAnswersOf = new Map<string, Record<string, unknown>>();
  for (const tool of selected) {
    const args = decisionArguments(tool.name, questions.get(tool.name) ?? [], answers);
    if (!args) return err(invalidAiResponse(`The decision did not answer the questions of ${tool.name}`));
    decisionAnswersOf.set(tool.name, args);
    if (tool.args.kind === "extracted") extracted.push(tool);
    else calls.push({ tool: tool.name, args });
  }

  if (extracted.length > 0) {
    const request: ExtractionRequest = {
      contextText: input.contextText,
      messageParts: input.messageParts,
      tools: extracted.map((tool) => ({
        name: tool.name, description: tool.description,
        jsonSchema: withoutFields(tool.jsonSchema(input.context), new Set((questions.get(tool.name) ?? []).map(({ name }) => name))),
      })),
    };
    const extraction = await deps.extract(request, signal);
    if (!extraction.success) return extraction;
    if (extraction.data.length === 0) return err(invalidAiResponse("The extraction returned no tool call"));
    for (const call of extraction.data) {
      const answered = decisionAnswersOf.get(call.tool);
      if (!answered || !extracted.some(({ name }) => name === call.tool)) return err(invalidAiResponse("The extraction called a tool that was not requested"));
      if (typeof call.args !== "object" || call.args === null || Array.isArray(call.args)) return err(invalidAiResponse("The extraction returned arguments that are not an object"));
      calls.push({ tool: call.tool, args: { ...call.args, ...answered } });
    }
    // §6.3 is silent on a tool the model skipped; dropping it would apply part of the message unnoticed, so the whole message fails and is retried.
    const called = new Set(extraction.data.map(({ tool }) => tool));
    if (extracted.some(({ name }) => !called.has(name))) return err(invalidAiResponse("The extraction did not call every requested tool"));
  }

  const [first, ...rest] = calls;
  if (!first) return ok({ kind: "ambiguous" });
  return ok({ kind: "calls", calls: [first, ...rest], extraction: extracted.length > 0 });
}
