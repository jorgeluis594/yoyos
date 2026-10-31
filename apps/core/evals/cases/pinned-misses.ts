import type { EvalCaseInput } from "@core/evals/cases/schema";

/**
 * The 28 suite misses of the Todoist task, pinned by id (see evals/README.md): run with 3 repetitions and scored
 * per action. They carry `pinned-miss` so `EVAL_REPEAT_TAGS=consistency,pinned-miss` repeats them.
 */
export const pinnedMissIds = {
  dev: ["hold-photo-color-qty", "int-photo-label-other-size", "int-photo-label-other-size~p2", "hold-price-bundle-en", "hold-qty-trio", "int-ready~p1",
    "hold-remove-one-baja", "int-remove-one-unit~p1", "hold-add-and-done", "hold-dash-list", "int-multiline", "int-remove-and-ready", "int-remove-and-ready~p1",
    "int-remove-and-ready~p2", "hold-qty-unnamed-two", "int-unnamed-add-otro-igual~p2", "txt-gorra-two-candidates", "txt-polera-two-candidates", "hold-variant-mejor-en"],
  test: ["hold-price-offer-below", "int-price-bundle", "int-price-bundle~p1", "int-price-bundle~p2", "hold-two-products-y", "hold-unnamed-lo-mismo", "int-unnamed-add",
    "int-unnamed-add~p1", "int-unnamed-add~p2"],
} as const;

/** Text-identification cases of the removed text pass: no message, order or notice, so they are reported apart as not applicable. */
export const pinnedNotApplicableIds: readonly string[] = ["txt-gorra-two-candidates", "txt-polera-two-candidates"];

export const allPinnedMissIds: readonly string[] = [...pinnedMissIds.dev, ...pinnedMissIds.test];

/** Adds the `pinned-miss` tag to the pinned cases (paraphrases included, by their own id). */
export const withPinnedMisses = (cases: readonly EvalCaseInput[]): readonly EvalCaseInput[] =>
  cases.map((testCase) => allPinnedMissIds.includes(testCase.id) && !(testCase.tags ?? []).includes("pinned-miss")
    ? { ...testCase, tags: [...(testCase.tags ?? []), "pinned-miss"] } : testCase);
