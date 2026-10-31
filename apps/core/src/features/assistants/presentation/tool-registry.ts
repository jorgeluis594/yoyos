import { McpServer, type CallToolResult, type StandardSchemaWithJSON, type ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";
import { log } from "@core/src/shared/infrastructure/logger";
import { answerToolCall, type AnswerToolCallDependencies, type RegisteredTool, type ToolAnswer } from "@core/src/features/assistants/application/answer-tool-call";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import type { AssistantScope } from "@core/src/features/assistants/domain/scopes";
import { serverInstructions } from "@core/src/features/assistants/presentation/server-instructions";
import type { ToolModule } from "@core/src/features/assistants/presentation/tool-module";

/** Each tool's response is one JSON document of at most this size; the text block repeats it. */
export const maxToolOutputBytes = 24 * 1024;
const toolNamePattern = /^[a-z][a-z0-9_]{2,63}$/;
// Every tool of a read module carries these hints, so a later write tool cannot inherit them by accident.
const readAnnotations: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const annotationsOf = (access: ToolModule["access"]): ToolAnnotations => {
  if (access !== "read") throw new Error(`Unsupported tool module access: ${String(access)}`);
  return readAnnotations;
};

type JsonSchema = Record<string, unknown>;
export type ToolDefinition = Readonly<{
  scope: AssistantScope;
  tool: RegisteredTool<unknown, unknown>;
  annotations: ToolAnnotations;
  inputJsonSchema: JsonSchema;
  outputJsonSchema: JsonSchema;
}>;

// The SDK validates and lists schemas through the Standard Schema interface. Input is validated by `answerToolCall` (after the store limit),
// so the SDK gets the schema only to list it, already converted at startup; its own validation lets everything through.
function listedSchema(jsonSchema: JsonSchema, validate: (value: unknown) => { value: unknown } | { issues: { message: string }[] }): StandardSchemaWithJSON {
  return { "~standard": { version: 1, vendor: "yoyos", validate, jsonSchema: { input: () => jsonSchema, output: () => jsonSchema } } } as StandardSchemaWithJSON;
}

function jsonSchemaOf(schema: z.ZodType, io: "input" | "output"): JsonSchema {
  const { $schema: _draft, ...rest } = z.toJSONSchema(schema, { io, target: "draft-2020-12" }) as JsonSchema;
  void _draft;
  return rest;
}

/** Definitions with their JSON Schemas, built once at startup. Refuses a module that is not read-only, a repeated tool name and an invalid one. */
export function buildToolDefinitions(modules: readonly ToolModule[]): readonly ToolDefinition[] {
  const names = new Set<string>();
  return modules.flatMap((module) => {
    const annotations = annotationsOf(module.access);
    return module.tools.map((tool): ToolDefinition => {
      if (!toolNamePattern.test(tool.name)) throw new Error(`Invalid tool name: ${tool.name}`);
      if (names.has(tool.name)) throw new Error(`Repeated tool name: ${tool.name}`);
      names.add(tool.name);
      return { scope: module.scope, tool, annotations, inputJsonSchema: jsonSchemaOf(tool.inputSchema, "input"), outputJsonSchema: jsonSchemaOf(tool.outputSchema, "output") };
    });
  });
}

export type ToolCallLogger = (fields: Readonly<{ tool: string; outcome: ToolAnswer<unknown>["outcome"]; durationMs: number }>, access: AssistantAccess) => void;

export type ToolRegistryOptions = Readonly<{
  modules: readonly ToolModule[];
  answer: AnswerToolCallDependencies;
  toolCallLimit: number;
  now: () => number;
}>;

export const readFailureMessage = "No pudimos leer tus pedidos en este momento. Inténtalo de nuevo en unos segundos.";
export const limitMessage = (limit: number, seconds: number) =>
  `Llegaste al límite de ${limit} consultas por minuto de tu tienda. No reintentes antes de ${seconds} segundos.`;

// An error result carries no structuredContent: clients on the v1 SDK validate it against the output schema even when isError is set.
function errorResult(message: string, _meta?: Record<string, unknown>): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }], ...(_meta ? { _meta } : {}) };
}

export type ToolRegistry = Readonly<{
  definitions: readonly ToolDefinition[];
  /** A fresh server for one request, with only the tools of the scopes the connection holds. */
  createServer: (access: AssistantAccess) => McpServer;
}>;

export function createToolRegistry(options: ToolRegistryOptions): ToolRegistry {
  const definitions = buildToolDefinitions(options.modules);

  function render(definition: ToolDefinition, answer: ToolAnswer<unknown>, access: AssistantAccess): CallToolResult {
    switch (answer.outcome) {
      case "answered":
      case "empty": {
        // Strict output schemas are the last guard of the masking rules: an output with an unknown field is never sent.
        const checked = definition.tool.outputSchema.safeParse(answer.output);
        if (!checked.success) {
          log.error({ event: "assistant_tool_failed", companyId: access.companyId, connectionId: access.connectionId, tool: definition.tool.name, errorCode: "INVALID_TOOL_OUTPUT" }, "assistant_tool_failed");
          return errorResult(readFailureMessage);
        }
        return { content: [{ type: "text", text: JSON.stringify(checked.data) }], structuredContent: checked.data as Record<string, unknown> };
      }
      case "rate_limited":
        return errorResult(limitMessage(options.toolCallLimit, answer.retryAfterSeconds), { retryAfterSeconds: answer.retryAfterSeconds });
      case "invalid_input":
      case "not_found":
        return errorResult(answer.message);
      case "failure":
        if (answer.cause !== undefined) {
          log.error({ event: "assistant_tool_failed", companyId: access.companyId, connectionId: access.connectionId, tool: definition.tool.name, errorCode: "UNEXPECTED_ERROR", err: answer.cause }, "assistant_tool_failed");
        }
        return errorResult(answer.message ?? readFailureMessage);
    }
  }

  async function call(definition: ToolDefinition, rawInput: unknown, access: AssistantAccess): Promise<CallToolResult> {
    const startedAt = options.now();
    const answer = await answerToolCall(definition.tool, rawInput, access, options.answer);
    const result = render(definition, answer, access);
    log.info({
      event: "assistant_tool_called", companyId: access.companyId, connectionId: access.connectionId, tool: definition.tool.name,
      outcome: answer.outcome, durationMs: options.now() - startedAt,
    }, "assistant_tool_called");
    return result;
  }

  function createServer(access: AssistantAccess): McpServer {
    const modules = options.modules.filter((module) => access.scopes.includes(module.scope));
    const server = new McpServer({ name: "yoyos", version: "1.0.0" }, { instructions: serverInstructions(modules) });
    for (const definition of definitions) {
      if (!access.scopes.includes(definition.scope)) continue;
      server.registerTool(definition.tool.name, {
        title: definition.tool.title,
        description: definition.tool.description,
        inputSchema: listedSchema(definition.inputJsonSchema, (value) => ({ value })),
        outputSchema: listedSchema(definition.outputJsonSchema, (value) => ({ value })),
        annotations: definition.annotations,
      }, (args) => call(definition, args, access));
    }
    return server;
  }

  return { definitions, createServer };
}

const writeVerbStems = ["crear", "creat", "actualiz", "updat", "edit", "modific", "borr", "delet", "elimin", "cancel", "registr", "write", "cambi", "anul", "agreg", "add", "remov", "quit", "enviar", "send", "confirm", "marcar", "pagar", "guard", "save"];
const forbiddenSampleStrings = ["987654789", "Av. Larco 123", "45678912"];

const words = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word !== "");

/** The static rules every tool module must keep. Returns one sentence per violation; empty when the modules are fine. */
export function checkToolModules(modules: readonly ToolModule[]): string[] {
  const violations: string[] = [];
  for (const module of modules) {
    if ((module.access as string) !== "read") violations.push(`A module of scope ${module.scope} is not declared read.`);
  }
  let definitions: readonly ToolDefinition[] = [];
  // The tools of a module that is not read are checked too, as if it were.
  try { definitions = buildToolDefinitions(modules.map((module) => ({ ...module, access: "read" as const }))); } catch (cause) { violations.push(String(cause instanceof Error ? cause.message : cause)); }
  for (const { tool, inputJsonSchema, annotations } of definitions) {
    const where = `Tool ${tool.name}:`;
    if (tool.title.trim() === "" || tool.title.length > 80 || toolNamePattern.test(tool.title)) violations.push(`${where} needs a Spanish display title.`);
    if (tool.description.trim().length < 20) violations.push(`${where} needs a description.`);
    if (inputJsonSchema.type !== "object" || inputJsonSchema.additionalProperties !== false) violations.push(`${where} input must be a strict JSON Schema object.`);
    if (annotations.readOnlyHint !== true || annotations.destructiveHint !== false) violations.push(`${where} annotations must be the read-only ones.`);
    if ([...words(tool.name), ...words(tool.title)].some((word) => writeVerbStems.some((stem) => word.startsWith(stem)))) violations.push(`${where} name or title names a write action.`);
    tool.sampleOutputs.forEach((sample, index) => {
      if (!tool.outputSchema.safeParse(sample).success) violations.push(`${where} sample output ${index + 1} does not validate against its output schema.`);
      const json = JSON.stringify(sample);
      if (Buffer.byteLength(json) > maxToolOutputBytes) violations.push(`${where} sample output ${index + 1} is over 24 KB.`);
      for (const secret of forbiddenSampleStrings) if (json.includes(secret)) violations.push(`${where} sample output ${index + 1} contains ${secret}.`);
    });
    if (tool.sampleOutputs.length === 0) violations.push(`${where} needs at least one sample output.`);
  }
  return violations;
}
