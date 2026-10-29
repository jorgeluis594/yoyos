import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { evalCatalogSchema, type EvalCatalog } from "@core/evals/fixtures/catalog";
import { parseCases, type EvalCase } from "@core/evals/cases/schema";

/**
 * Private catalog and cases, read at run time from `EVAL_PRIVATE_DIR` (evals/README.md «Private files format»). Nothing private is
 * committed and no committed table imports this file: only the model suites and the report call it.
 */

const repositoryRoot = realpathSync(resolve(import.meta.dirname, "../../../.."));

export type PrivateData = Readonly<{
  /** The resolved real path of the folder. Records, judge and classifier output of the run go under `<dir>/runs/`. */
  dir: string;
  catalog: EvalCatalog;
  cases: readonly EvalCase[];
}>;

const isInside = (parent: string, child: string) => {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path) && !path.startsWith(`..${sep}`));
};

/** The real path of `dir`, which must be absolute and outside the repository, whatever the symlinks on the way. */
export function privateDirOf(dir: string): string {
  if (!isAbsolute(dir)) throw new Error("EVAL_PRIVATE_DIR must be an absolute path");
  const real = realpathSync(dir);
  if (isInside(repositoryRoot, real)) throw new Error("EVAL_PRIVATE_DIR must be outside the repository");
  return real;
}

function readJson(dir: string, file: string): unknown {
  const real = realpathSync(join(dir, file));
  if (isInside(repositoryRoot, real)) throw new Error(`${file} must be outside the repository`);
  return JSON.parse(readFileSync(real, "utf8"));
}

/** Loads `<dir>/catalog.json` and `<dir>/cases.json` with the committed schemas. Photo passes are not available without photos. */
export function loadPrivateData(dir: string): PrivateData {
  const real = privateDirOf(dir);
  const catalog = evalCatalogSchema.parse(readJson(real, "catalog.json"));
  const cases = parseCases(readJson(real, "cases.json") as never, catalog);
  if (cases.some((testCase) => testCase.pass === "image" || (testCase.pass !== "conversation" && testCase.input.photo !== undefined && "file" in testCase.input.photo))) {
    throw new Error("Private cases cannot use photo files");
  }
  return { dir: real, catalog, cases };
}
