import { copyFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { allCases } from "@core/evals/cases";
import { splits, type EvalSplit } from "@core/evals/cases/split";
import { rebuildResult, splitResult, type ResultFile } from "@core/evals/lib/rebuild";
import { formatSummary } from "@core/evals/lib/report";

/**
 * Rebuilds the report of saved runs from their records, with no model call (evals/README.md «Report»). From apps/core:
 * `pnpm exec tsx evals/scripts/rebuild-report.ts eval-results/<run>.json [...]`. The first rebuild keeps the original as `<run>.orig.json`.
 * With `EVAL_SPLIT=dev` or `test` it leaves the run as it is and writes that split's part as `<run>.<split>.json`.
 */

const paths = process.argv.slice(2);
const split = (splits as readonly string[]).includes(process.env.EVAL_SPLIT ?? "") ? process.env.EVAL_SPLIT as EvalSplit : null;
const knownLimitations = new Set(allCases.filter(({ tags }) => tags?.includes("known-limitation")).map(({ id }) => id));
if (!paths.length) throw new Error("Pass one or more eval-results/<run>.json files");

for (const path of paths) {
  const file = JSON.parse(await readFile(path, "utf8")) as ResultFile;
  if (split) {
    const part = rebuildResult(splitResult(file, split), knownLimitations);
    const target = path.replace(/\.json$/, `.${split}.json`);
    await writeFile(target, `${JSON.stringify(part, null, 2)}\n`);
    console.log(`${formatSummary(part.report, target)}\n`);
    continue;
  }
  const original = path.replace(/\.json$/, ".orig.json");
  if (!existsSync(original)) await copyFile(path, original);
  const rebuilt = rebuildResult(file, knownLimitations);
  await writeFile(path, `${JSON.stringify(rebuilt, null, 2)}\n`);
  console.log(`${formatSummary(rebuilt.report, path)}\n`);
}
