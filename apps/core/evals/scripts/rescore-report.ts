import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { allCases } from "@core/evals/cases";
import type { ResultFile } from "@core/evals/lib/rebuild";
import { resultsDir } from "@core/evals/lib/case-record";
import { comparisonOf, formatComparison, rescoreArgumentsOf, rescoreFile } from "@core/evals/lib/rescore";

/**
 * Scores a saved run again with the current code and prints the before and after of the audited metrics (evals/README.md «Rescoring a saved run»). From apps/core:
 * `pnpm eval:rescore <run.json> [--out <path>]`. It needs no model, database, network or key. The input is never written: the rescored file goes to `--out`, by
 * default `eval-results/<run>.rescored.json` (git-ignored). The table holds aggregate numbers only.
 */

const parsed = rescoreArgumentsOf(process.argv.slice(2), resultsDir);
if ("error" in parsed) throw new Error(parsed.error);
const { input, target } = parsed;

const knownLimitations = new Set(allCases.filter(({ tags }) => tags?.includes("known-limitation")).map(({ id }) => id));
const file = JSON.parse(await readFile(input, "utf8")) as ResultFile;
const { result, kept } = rescoreFile(file, knownLimitations);
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(result, null, 2)}\n`);

console.log(`Rescored ${basename(input)}: ${file.records.length} records\n${formatComparison(comparisonOf(file.report, result.report, { stored: file.records, rescored: result.records }), kept)}\nRescored file: ${target}`);
