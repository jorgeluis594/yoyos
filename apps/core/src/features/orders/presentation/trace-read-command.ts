import { z } from "zod";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { CompanyId } from "@core/src/features/orders/domain/order";
import type { StoredMessageTraceRead, TraceReadAudit } from "@core/src/features/orders/infrastructure/message-trace-repository";
import { readerNameOf, type TraceReader } from "@core/src/features/orders/presentation/trace-reader-token";

const expiredText = "texto vencido";
const maxMessages = 50;
const argumentsSchema = z.object({ company: z.uuid(), message: z.string().transform((value) => value.split(",").map((id) => id.trim())).pipe(z.array(z.uuid()).min(1).max(maxMessages)) });

export type TraceReadCommand = Readonly<{
  args: readonly string[];
  readers: readonly TraceReader[];
  /** Asked for only after the arguments are valid; the token never comes from argv or env. */
  token: () => Promise<string | null>;
  osUser: string;
  read: (companyId: CompanyId, audit: TraceReadAudit) => Promise<Result<StoredMessageTraceRead, Readonly<{ code: string; message: string }>>>;
  print: (text: string) => void;
  fail: (text: string) => void;
}>;

function parseArguments(args: readonly string[]) {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!flag?.startsWith("--") || args[index + 1] === undefined) return null;
    values[flag.slice(2)] = args[index + 1]!;
  }
  const parsed = argumentsSchema.safeParse(values);
  return parsed.success ? { companyId: parsed.data.company as CompanyId, messageIds: parsed.data.message as ChatMessageId[] } : null;
}

/** Exit codes: 0 read, 1 refused or failed (nothing printed), 2 bad usage. */
export async function runTraceRead(command: TraceReadCommand): Promise<number> {
  const request = parseArguments(command.args);
  if (!request) { command.fail(`Usage: trace:read --company <uuid> --message <uuid>[,<uuid>…] (at most ${maxMessages}); the token comes from standard input`); return 2; }
  const token = await command.token();
  const readerName = token === null ? null : readerNameOf(command.readers, token);
  if (readerName === null) {
    log.warn({ event: "message_trace_read_refused", osUser: command.osUser, reason: token === null ? "missing_token" : "unknown_token" }, "Message trace read refused");
    command.fail(token === null ? "A reader token is required on standard input" : "Unknown reader token");
    return 1;
  }
  const result = await command.read(request.companyId, { readerName, osUser: command.osUser, messageIds: request.messageIds });
  if (!result.success) { command.fail(`Unable to read the traces: ${result.error.code}`); return 1; }
  log.info({ event: "message_trace_read", companyId: request.companyId, readerName, osUser: command.osUser, messageCount: request.messageIds.length }, "Message traces read");
  command.print(`${JSON.stringify(present(result.data), null, 2)}\n`);
  return 0;
}

/** Each trace with its own masked text and its context texts; a text that expired shows «texto vencido». */
function present(stored: StoredMessageTraceRead) {
  const texts = new Map(stored.texts.map((mask) => [mask.messageId, mask.text]));
  return {
    traces: stored.traces.map((trace) => ({ ...trace, text: texts.get(trace.messageId) ?? expiredText,
      contextTexts: trace.contextMessageIds.map((messageId) => ({ messageId, text: texts.get(messageId) ?? expiredText })) })),
    verdicts: stored.verdicts,
  };
}
