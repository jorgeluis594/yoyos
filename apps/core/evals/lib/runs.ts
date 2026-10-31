/** One run of a case: `repeat` 0 is the first of the `EVAL_REPEATS` full runs. Every run is scored; the report aggregates them (lib/metrics.ts). */
export type CaseRun<Case extends Readonly<{ id: string }>> = Readonly<{ testCase: Case; repeat: number; label: string }>;

/** The whole selected set once per repeat, in order: all cases of run 0, then all of run 1… */
export function runsOf<Case extends Readonly<{ id: string }>>(cases: readonly Case[], repeats: number): readonly CaseRun<Case>[] {
  return Array.from({ length: repeats }, (_, repeat) => cases.map((testCase) => ({ testCase, repeat, label: repeat === 0 ? testCase.id : `${testCase.id} (repeat ${repeat})` }))).flat();
}
