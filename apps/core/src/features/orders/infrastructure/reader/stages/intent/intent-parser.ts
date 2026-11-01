import type { Result } from "@shared/result";
import type { AddressSpan, ContextMessageRef, IntentReading, Quote, ReadingInput, RequestIntent, RequestRef } from "@core/src/features/orders/domain/reader/readings";
import { intentAnswerSchema } from "@core/src/features/orders/infrastructure/reader/stages/intent/intent.v1";

export { requestKinds } from "@core/src/features/orders/infrastructure/reader/stages/intent/intent.v1";

const fail = (message: string): Result<never> => ({ success: false, error: { message } });

/**
 * The validated answer as an `IntentReading`, or a failure whose reason never carries model text. Requests are numbered here, in the order
 * given. A request is quoted only from the current message: a context quote would reach no verification. Address spans of masked or unknown messages are
 * dropped, because those messages must not be masked again; the quotes themselves are verified later.
 */
export function parseIntentAnswer(answer: unknown, input: ReadingInput): Result<IntentReading> {
  const parsed = intentAnswerSchema.safeParse(answer);
  if (!parsed.success) return fail(`The intent answer does not match its schema: ${parsed.error.issues.map(({ path }) => path.join(".") || "answer").join(", ")}`);
  const { outcome, noIntentReason, language, requests, addresses } = parsed.data;
  const unmasked = new Set<string>(["current", ...input.context.filter(({ masked }) => !masked).map(({ ref }) => ref)]);
  const spans: AddressSpan[] = addresses.filter(({ message, text }) => text.length > 0 && unmasked.has(message))
    .map(({ message, text }) => ({ message: message === "current" ? "current" : (message as ContextMessageRef), text }));

  if (outcome === "unsure" || outcome === "no_intent") {
    if (requests.length > 0) return fail("The intent answer lists requests next to an outcome without requests");
    if (outcome === "unsure") return { success: true, data: { kind: "unsure", language, addresses: spans } };
    return noIntentReason === null ? fail("The intent answer has no reason for no intent")
      : { success: true, data: { kind: "no_intent", reason: noIntentReason, language, addresses: spans } };
  }
  if (requests.length === 0) return fail("The intent answer lists no requests");
  const quoted: RequestIntent[] = [];
  for (const [index, request] of requests.entries()) {
    const quote: Quote = { source: "current", text: request.quote.text };
    quoted.push({ id: `R${index + 1}` as RequestRef, kind: request.kind, quote });
  }
  return { success: true, data: { kind: "requests", requests: quoted, language, addresses: spans } };
}
