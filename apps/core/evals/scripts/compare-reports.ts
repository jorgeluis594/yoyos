import { readFile } from "node:fs/promises";
import { compareResults, formatComparison, type ResultFile } from "@core/evals/lib/compare";

/**
 * `pnpm eval:compare <a> <b>`: compares two saved runs (`eval-results/<run>.json`), `a` the previous one and `b` the new one, with no model call.
 * A metric is better or worse only when the ranges over the runs of each do not overlap; otherwise it prints «not distinguishable».
 */
const [before, after] = process.argv.slice(2);
if (!before || !after) {
  console.error("Usage: pnpm eval:compare <previous run .json> <new run .json>");
  process.exit(2);
}
const read = async (path: string) => JSON.parse(await readFile(path, "utf8")) as ResultFile;
console.log(formatComparison(compareResults(await read(before), await read(after)), before, after));
