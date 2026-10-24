import { copyFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { allCases } from "@core/evals/cases";
import { rebuildResult, type ResultFile } from "@core/evals/lib/rebuild";
import { formatSummary } from "@core/evals/lib/report";

/**
 * Rebuilds the report of saved runs from their records, with no model call (evals/README.md «Report»). From apps/core:
 * `pnpm exec tsx evals/scripts/rebuild-report.ts eval-results/<run>.json [...]`. The first rebuild keeps the original as `<run>.orig.json`.
 */

const paths = process.argv.slice(2);
const knownLimitations = new Set(allCases.filter(({ tags }) => tags?.includes("known-limitation")).map(({ id }) => id));
if (!paths.length) throw new Error("Pass one or more eval-results/<run>.json files");

for (const path of paths) {
  const file = JSON.parse(await readFile(path, "utf8")) as ResultFile;
  const original = path.replace(/\.json$/, ".orig.json");
  if (!existsSync(original)) await copyFile(path, original);
  const rebuilt = rebuildResult(file, knownLimitations);
  await writeFile(path, `${JSON.stringify(rebuilt, null, 2)}\n`);
  console.log(`${formatSummary(rebuilt.report, path)}\n`);
}
