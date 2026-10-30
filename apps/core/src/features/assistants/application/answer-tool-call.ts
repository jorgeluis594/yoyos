import { z } from "zod";
import type { Result } from "@shared/result";
import type { AssistantConnectionId } from "@core/src/features/assistants/domain/assistant-connection";
import { sameMinute } from "@core/src/features/assistants/domain/assistant-connection";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import type { LimiterDecision } from "@core/src/shared/infrastructure/fixed-window-limiter";
import type { CompanyId } from "@shared/identity";

export type ToolRunError = Readonly<{ code: "NOT_FOUND" | "INVALID_INPUT" | "FAILURE"; message: string }>;
/** What a tool returns: its output (and whether that is an empty answer), or a business refusal worded for the agent in Spanish. */
export type ToolRun<O> = Result<Readonly<{ output: O; empty: boolean }>, ToolRunError>;

export type RegisteredTool<I, O> = Readonly<{
  name: string;                          // stable ASCII, ^[a-z][a-z0-9_]{2,63}$
  title: string;                         // Spanish display name
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  sampleOutputs: readonly O[];           // for the validator, including a maximum-length case
  run: (input: I, access: AssistantAccess) => Promise<ToolRun<O>>;
}>;

export type ToolCallOutcome = "answered" | "empty" | "rate_limited" | "invalid_input" | "not_found" | "failure";
export type ToolAnswer<O> =
  | Readonly<{ outcome: "answered" | "empty"; output: O }>
  | Readonly<{ outcome: "rate_limited"; retryAfterSeconds: number }>
  | Readonly<{ outcome: "invalid_input" | "not_found"; message: string }>
  // `message` is the tool's own wording; `null` leaves the presentation to its default reading-failure text. `cause` is for the log only.
  | Readonly<{ outcome: "failure"; message: string | null; cause?: unknown }>;

export type AnswerToolCallDependencies = Readonly<{
  allowCall: (companyId: CompanyId) => LimiterDecision;
  touchConnection: (id: AssistantConnectionId, now: Date) => Promise<Result<null, Readonly<{ code: string; message: string }>>>;
  clock: () => Date;
}>;

function describeIssues(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const field = issue.path.join(".");
    return field === "" ? issue.message : `${field}: ${issue.message}`;
  });
  return `Revisa los datos enviados. ${issues.join(" ")}`;
}

/**
 * The pipeline every `tools/call` goes through: the store limit, the «Último uso» write, input validation and the tool.
 * A refused or invalid call still updates «Último uso»; the write is its own short transaction and never encloses the tool's reads.
 */
export async function answerToolCall<I, O>(
  tool: RegisteredTool<I, O>, rawInput: unknown, access: AssistantAccess, deps: AnswerToolCallDependencies,
): Promise<ToolAnswer<O>> {
  const decision = deps.allowCall(access.companyId);
  const at = deps.clock();
  if (access.lastUsedAt === null || !sameMinute(access.lastUsedAt, at)) {
    // A failed write is logged by the adapter and never refuses the call.
    await deps.touchConnection(access.connectionId, at);
  }
  if (!decision.allowed) return { outcome: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds };
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) return { outcome: "invalid_input", message: describeIssues(parsed.error) };
  let run: ToolRun<O>;
  try {
    run = await tool.run(parsed.data, access);
  } catch (cause) {
    return { outcome: "failure", message: null, cause };
  }
  if (run.success) return { outcome: run.data.empty ? "empty" : "answered", output: run.data.output };
  switch (run.error.code) {
    case "NOT_FOUND": return { outcome: "not_found", message: run.error.message };
    case "INVALID_INPUT": return { outcome: "invalid_input", message: run.error.message };
    default: return { outcome: "failure", message: run.error.message };
  }
}

