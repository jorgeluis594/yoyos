import type { AppliedMessage, Observation } from "@core/evals/lib/production";

/** The diagnostics of a record: the reader's last raw answer and the reasons of the invalid actions, or nulls when diagnostics are off (`diagnosticsOn`). */
export type Diagnostics = Readonly<{ readerAnswer: unknown | null; invalidReasons: readonly string[] | null }>;

export function diagnosticsOf(on: boolean, applied: Pick<AppliedMessage, "result"> | null, observation: Pick<Observation, "readerAnswers">): Diagnostics {
  if (!on) return { readerAnswer: null, invalidReasons: null };
  const outcomes = applied?.result.success && "outcomes" in applied.result.data ? applied.result.data.outcomes : [];
  return {
    // A retried message keeps the answer of the scored attempt only (the observation is reset per attempt).
    readerAnswer: observation.readerAnswers.at(-1) ?? null,
    invalidReasons: outcomes.flatMap((outcome) => outcome.kind === "invalid_action" ? [outcome.reason] : []),
  };
}
