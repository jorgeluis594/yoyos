import { z } from "zod";
import { err } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { invalidAiResponse, type AiError } from "@core/src/shared/ai-tools/application/ai-error";
import { dropNullOptionals, toStrictSchema } from "@core/src/shared/ai-tools/application/strict-schema";

export type JsonSchema = Readonly<Record<string, unknown>>;

/** A choice the Decision API answers instead of the extraction model; `name` is the argument field that receives `{ value, confidence }`. */
export type DecisionChoiceQuestion = Readonly<{
  name: string;
  instructions: string;
  choices: readonly Readonly<{ value: string | boolean; description?: string }>[];
}>;

export type ToolArgsSource<Context> =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "decision"; questions: (context: Context) => readonly DecisionChoiceQuestion[] }>
  | Readonly<{ kind: "extracted"; questions?: (context: Context) => readonly DecisionChoiceQuestion[] }>;

export type ToolDefinition<Context, Args, Action, E extends AppError> = Readonly<{
  /** `^[a-z][a-z0-9_]*$`. */
  name: string;
  /** The only thing the models know about the tool. */
  description: string;
  schema: (context: Context) => z.ZodType<Args>;
  args: ToolArgsSource<Context>;
  /** The tool only reports to the caller and never changes its state: its own Decision predicate may select it under the action gate. */
  reportOnly?: boolean;
  /** Runs outside any transaction. */
  resolve: (args: Args, context: Context, signal: AbortSignal) => Promise<Result<readonly Action[], E>>;
}>;

export type RegisteredTool<Context, Action, E extends AppError> = Readonly<{
  name: string;
  description: string;
  args: ToolArgsSource<Context>;
  reportOnly: boolean;
  jsonSchema: (context: Context) => JsonSchema;
  parseAndResolve: (raw: unknown, context: Context, signal: AbortSignal) => Promise<Result<readonly Action[], E | AiError>>;
}>;

/** What the orchestrator needs to offer a tool: everything but the arguments' parsing and resolution. */
export type OfferedTool<Context> = Pick<RegisteredTool<Context, never, never>, "name" | "description" | "args" | "jsonSchema" | "reportOnly">;

export type ToolRegistry<Context, Action, E extends AppError> = Readonly<{
  tools: readonly RegisteredTool<Context, Action, E>[];
  get: (name: string) => RegisteredTool<Context, Action, E> | undefined;
}>;

const TOOL_NAME = /^[a-z][a-z0-9_]*$/;
/** The action choice that selects several tools at once; a tool with this name would be indistinguishable from it. */
const RESERVED_TOOL_NAMES: ReadonlySet<string> = new Set(["several"]);

const originalSchema = (schema: z.ZodType): unknown => z.toJSONSchema(schema, { io: "input", target: "draft-7" });

export function defineTool<Context, Args, Action, E extends AppError>(
  definition: ToolDefinition<Context, Args, Action, E>,
): RegisteredTool<Context, Action, E> {
  if (!TOOL_NAME.test(definition.name)) throw new Error(`Invalid tool name: ${definition.name}`);
  if (RESERVED_TOOL_NAMES.has(definition.name)) throw new Error(`Reserved tool name: ${definition.name}`);
  return {
    name: definition.name,
    description: definition.description,
    args: definition.args,
    reportOnly: definition.reportOnly ?? false,
    jsonSchema: (context) => toStrictSchema(originalSchema(definition.schema(context))) as JsonSchema,
    parseAndResolve: async (raw, context, signal) => {
      const schema = definition.schema(context);
      // The model sees optional fields as nullable (strict mode); the schema knows them as absent.
      const parsed = schema.safeParse(dropNullOptionals(raw, originalSchema(schema)));
      if (!parsed.success) {
        // Paths only: the values come from the buyer's text.
        log.error({ event: "ai_tool_arguments_invalid", tool: definition.name, issuePaths: parsed.error.issues.map(({ path }) => path.join(".")) }, "ai_tool_arguments_invalid");
        return err(invalidAiResponse(`Invalid arguments for tool ${definition.name}`));
      }
      return definition.resolve(parsed.data, context, signal);
    },
  };
}

export function defineToolRegistry<Context, Action, E extends AppError>(
  tools: readonly RegisteredTool<Context, Action, E>[],
): ToolRegistry<Context, Action, E> {
  const byName = new Map<string, RegisteredTool<Context, Action, E>>();
  for (const tool of tools) {
    if (byName.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
    byName.set(tool.name, tool);
  }
  return { tools, get: (name) => byName.get(name) };
}
