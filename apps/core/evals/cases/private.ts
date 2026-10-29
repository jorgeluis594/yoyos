import { readFileSync, realpathSync } from "node:fs";
import { ZodError } from "zod";
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

/** Schema field names that may appear in an error; any other path segment (a key the file chose, such as an attribute name) shows as «*». */
const schemaFields = new Set(["products", "key", "name", "photo", "active", "variants", "attributes", "price", "id", "pass", "kind", "tags", "criterion", "ambiguous", "input",
  "expected", "text", "caption", "order", "notice", "outcomes", "steps", "event", "days", "product", "shows", "label", "file", "variant", "quantity", "mentionedPrice",
  "amount", "units", "expectsRepeatNotice"]);

/**
 * A malformed private file must never print its content: the error names the file and the schema paths that failed, with no values,
 * no unknown keys and no text of the parser.
 */
export class PrivateFileError extends Error {}

const pathOf = (path: readonly PropertyKey[]) => path.map((segment) => typeof segment === "number" ? String(segment) : schemaFields.has(String(segment)) ? String(segment) : "*").join(".") || "(root)";

function invalid<T>(file: string, parse: () => T): T {
  try {
    return parse();
  } catch (cause) {
    if (cause instanceof PrivateFileError || (cause instanceof Error && cause.message.includes("outside the repository"))) throw cause;
    if (cause instanceof ZodError) throw new PrivateFileError(`${file} is invalid at: ${[...new Set(cause.issues.map((issue) => pathOf(issue.path)))].join(", ")}`);
    const message = cause instanceof Error ? cause.message : "";
    if (message.startsWith("Duplicated eval case id")) throw new PrivateFileError(`${file} repeats a case id`);
    if (message.startsWith("Cases name products outside")) throw new PrivateFileError(`${file} names a product the catalog does not have`);
    throw new PrivateFileError(`${file} is not valid JSON or cannot be read`);
  }
}

function readJson(dir: string, file: string): unknown {
  const real = realpathSync(join(dir, file));
  if (isInside(repositoryRoot, real)) throw new Error(`${file} must be outside the repository`);
  return invalid(file, () => JSON.parse(readFileSync(real, "utf8")));
}

/** Loads `<dir>/catalog.json` and `<dir>/cases.json` with the committed schemas. Photo passes are not available without photos. */
export function loadPrivateData(dir: string): PrivateData {
  const real = privateDirOf(dir);
  const catalog = invalid("catalog.json", () => evalCatalogSchema.parse(readJson(real, "catalog.json")));
  const cases = invalid("cases.json", () => parseCases(readJson(real, "cases.json") as never, catalog));
  if (cases.some((testCase) => testCase.pass === "image" || (testCase.pass !== "conversation" && testCase.input.photo !== undefined && "file" in testCase.input.photo))) {
    throw new PrivateFileError("cases.json uses photo files, which a private run does not have");
  }
  return { dir: real, catalog, cases };
}
