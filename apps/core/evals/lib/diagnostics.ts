/** What a run kept of one message for diagnostics: the outcomes it returned and the reader's raw answers (one per call). Structural, so any reader path can supply it. */
export type DiagnosticsSource = Readonly<{
  applied: Readonly<{ result: Readonly<{ success: boolean; data?: unknown }> }> | null;
  observation: Readonly<{ readerAnswers: readonly unknown[] }>;
}>;

/** The diagnostics of a record: the reader's last raw answer and the reasons of the invalid actions, or nulls when diagnostics are off. */
export type Diagnostics = Readonly<{ readerAnswer: unknown | null; invalidReasons: readonly string[] | null }>;

type OutcomeLike = Readonly<{ kind: string; reason?: string }>;

export function diagnosticsOf(on: boolean, applied: DiagnosticsSource["applied"], observation: DiagnosticsSource["observation"]): Diagnostics {
  if (!on) return { readerAnswer: null, invalidReasons: null };
  const data = applied?.result.success ? (applied.result.data as { outcomes?: readonly OutcomeLike[] } | undefined) : undefined;
  return {
    // A retried message keeps the answer of the scored attempt only (the observation is reset per attempt).
    readerAnswer: observation.readerAnswers.at(-1) ?? null,
    invalidReasons: (data?.outcomes ?? []).flatMap((outcome) => outcome.kind === "invalid_action" && outcome.reason !== undefined ? [outcome.reason] : []),
  };
}
