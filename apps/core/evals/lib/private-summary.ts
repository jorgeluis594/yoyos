import type { PrivateData } from "@core/evals/cases/private";
import type { EvalCase } from "@core/evals/cases/schema";
import { isMessageStep } from "@core/evals/cases/schema";

/** A message case with a photo, or a conversation with a photo in any step: the cases the report counts apart (`CaseRecord.photoCase`). */
export function isPhotoCase(testCase: EvalCase): boolean {
  if (testCase.pass === "image") return true;
  if (testCase.pass === "conversation") return testCase.steps.some((step) => isMessageStep(step) && step.input.photo !== undefined);
  return testCase.input.photo !== undefined;
}

/** What `check-private.ts` prints for a folder that loaded: counts per pass, per kind of case and of photo case. No id, text, product or family name. */
export function privateSummaryText(data: PrivateData): string {
  const cases = data.cases;
  const count = (predicate: (testCase: EvalCase) => boolean) => cases.filter(predicate).length;
  return [
    `${cases.length} cases, ${data.catalog.products.length} products`,
    `passes: ${["interpretation", "end_to_end", "conversation"].map((pass) => `${pass} ${count((testCase) => testCase.pass === pass)}`).join(", ")}`,
    `message cases ${count((testCase) => testCase.pass === "interpretation" || testCase.pass === "end_to_end")}, conversations ${count((testCase) => testCase.pass === "conversation")}`,
    `photo cases ${count(isPhotoCase)} (described as matched nothing ${count(namesNotFoundPhoto)}, not a product ${count((testCase) => shows(testCase, "not_product"))})`,
  ].join("\n");
}

const shows = (testCase: EvalCase, value: string): boolean => {
  if (testCase.pass === "image") return false;
  const photos = testCase.pass === "conversation" ? testCase.steps.flatMap((step) => isMessageStep(step) ? [step.input.photo] : []) : [testCase.input.photo];
  return photos.some((photo) => photo !== undefined && "shows" in photo && photo.shows === value);
};
const namesNotFoundPhoto = (testCase: EvalCase) => shows(testCase, "not_found");
