import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { allCases } from "@core/evals/cases";
import type { ResultFile } from "@core/evals/lib/rebuild";
import { resultsDir } from "@core/evals/lib/case-record";
import { comparisonOf, formatComparison, rescoreFile } from "@core/evals/lib/rescore";

/**
 * Scores a saved run again with the current code and prints the before and after of the audited metrics (evals/README.md «Rescoring a saved run»). From apps/core:
 * `pnpm eval:rescore <run.json> [--out <path>]`. It needs no model, database, network or key. The input is never written: the rescored file goes to `--out`, by
 * default `eval-results/<run>.rescored.json` (git-ignored). The table holds aggregate numbers only.
 */

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
const inputs = args.filter((arg, index) => !arg.startsWith("--") && index !== outIndex + 1);
if (outIndex >= 0 && !out) throw new Error("--out needs a path");
if (inputs.length !== 1) throw new Error("Usage: pnpm eval:rescore <run.json> [--out <path>]");

const input = resolve(inputs[0]!);
const target = resolve(out ?? join(resultsDir, `${basename(input).replace(/\.json$/, "")}.rescored.json`));
if (target === input) throw new Error("--out is the input file: the input is never overwritten");

const knownLimitations = new Set(allCases.filter(({ tags }) => tags?.includes("known-limitation")).map(({ id }) => id));
const file = JSON.parse(await readFile(input, "utf8")) as ResultFile;
const { result, kept } = rescoreFile(file, knownLimitations);
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(result, null, 2)}\n`);

console.log(`Rescored ${basename(input)}: ${file.records.length} records\n${formatComparison(comparisonOf(file.report, result.report, file.records), kept)}\nRescored file: ${target}`);
