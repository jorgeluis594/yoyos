import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { allCases } from "@core/evals/cases";
import { committedCatalog } from "@core/evals/fixtures/catalog";
import { outcomeKinds } from "@core/evals/cases/schema";
import { sellerNoticeKinds } from "@core/src/features/orders/domain/seller-notice";

const readme = readFileSync(resolve(import.meta.dirname, "../README.md"), "utf8");
const heading = "## Private files format";
const section = readme.slice(readme.indexOf(heading) + heading.length).split(/\n## /)[0]!;

test("keeps examples out of the private files format section of the README", () => {
  const texts = allCases.flatMap((testCase) => {
    if (testCase.pass === "image") return [];
    const inputs = testCase.pass === "conversation" ? testCase.steps.flatMap((step) => "input" in step ? [step.input] : []) : [testCase.input];
    return inputs.flatMap((input) => [input.text, input.caption]).filter((text): text is string => text !== undefined);
  });
  const lower = section.toLowerCase();

  expect(section.length).toBeGreaterThan(500);
  expect(section).not.toContain("```");
  for (const text of texts.filter((candidate) => candidate.length >= 5)) expect(lower, text).not.toContain(text.toLowerCase());
  for (const product of committedCatalog.products) {
    expect(lower, product.key).not.toContain(product.key);
    expect(lower, product.name).not.toContain(product.name.toLowerCase());
  }
});

test("lists every notice and outcome kind in the private files format", () => {
  for (const kind of [...sellerNoticeKinds, ...outcomeKinds]) expect(section, kind).toContain(`\`${kind}\``);
});

test("states the payment-fallback scoring rule in Scoring and the new report parts in Report", () => {
  const part = (title: string) => readme.slice(readme.indexOf(`## ${title}`) + title.length).split(/\n## /)[0]!;
  const scoring = part("Scoring");

  for (const word of ["shippedReaderFeatures", "payment_request", "request_not_allowed", "not_applied", "order_closed", "judge"]) expect(scoring, word).toContain(word);
  const report = part("Report");
  for (const word of ["photo cases", "consistency", "question-caption", "noticesByKind", "readerAnswer", "invalidReasons"]) expect(report, word).toContain(word);
  expect(section).toContain("`not_found`");
  expect(readme).toContain("check-private.ts");
});
