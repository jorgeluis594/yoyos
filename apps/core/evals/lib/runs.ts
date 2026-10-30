/** One run of a case: `repeat` 0 is the scored one; the others only feed the flip check, latency and usage. */
export type CaseRun<Case extends Readonly<{ id: string; tags: readonly string[] }>> = Readonly<{ testCase: Case; repeat: number; label: string }>;

/** The scored run of every selected case, then the extra runs of the cases tagged with any of `repeatTags`; the tag `all` repeats every case. */
export function runsOf<Case extends Readonly<{ id: string; tags: readonly string[] }>>(cases: readonly Case[], repeats: number, repeatTags: readonly string[]): readonly CaseRun<Case>[] {
  const first = cases.map((testCase) => ({ testCase, repeat: 0, label: testCase.id }));
  const again = cases.filter(({ tags }) => repeatTags.includes("all") || tags.some((tag) => repeatTags.includes(tag)))
    .flatMap((testCase) => Array.from({ length: repeats - 1 }, (_, index) => ({ testCase, repeat: index + 1, label: `${testCase.id} (repeat ${index + 1})` })));
  return [...first, ...again];
}
