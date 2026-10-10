/**
 * WA-14 traceability matrix. Walks the source tree and produces, for each of the 242 catalog cases
 * (68 UT, 174 IT), the task that owns it, the tests that cite it and its real status.
 *
 *   node --experimental-strip-types scripts/trace-matrix.ts [--go-json f] [--jest-json f] [--sh-json f] [--links f] [--check] [--out dir]
 *
 * Inputs: the case catalog (docs/whatsmeow-go-expo-implementation.md), the task assignment (docs/
 * whatsmeow-go-expo-tasks.md), every test file of the module, the declared links in trace-links.json (tests
 * that cover a case without citing its ID; each link is verified against the code) and, optionally, the
 * machine results of `go test -json` and `jest --json`. Without results nothing is reported as passing.
 *
 * Status vocabulary: `pasa` (a non-native test that ran and passed covers it and nothing native is left),
 * `parcial` (only a part passed: native half unrun, source-shape test or a described gap), `no ejecutado-nativo`
 * (the only evidence is Kotlin/Swift/instrumented code that cannot run here), `falla`, `no implementado`
 * (no test cites or is linked to it). A status never claims behaviour against real WhatsApp.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { z } from "zod";

export type Status = "pasa" | "parcial" | "no ejecutado-nativo" | "falla" | "no implementado";
export type Lang = "go" | "ts" | "kotlin" | "swift" | "sh";
export type Result = "pass" | "fail" | "skip" | "none";

export interface CatalogCase { id: string; title: string }
export interface Decl { file: string; lang: Lang; name: string; line: number; key: string; each?: boolean; indent?: number }
export interface Citation { id: string; decl: Decl | null; file: string; line: number }
export interface Evidence { decl: Decl | null; file: string; result: Result; via: "cite" | "link"; note?: string }
export interface Row { id: string; task: string; title: string; status: Status; evidence: Evidence[]; reason: string }

const ID_PATTERN = /(?:^|[^A-Za-z]|Test|test)(UT|IT)[-_]?([A-Z]{2,4})[-_]?(\d{2})(?!\d)/g;
const CATALOG_LINE = /^- \[.\] \*\*((?:UT|IT)-[A-Z]+-\d+) — (.+?)\*\*/;
// Word boundaries: a bare /iOS/i also matched "cambios" and "arbitrarios" (WA-14 review minor 1).
const NATIVE_TEXT = /\b(?:Android|iOS|Keystore|Keychain|manifest|Gradle|emulador|xcode|nativ[oa]s?|fsync)\b|dispositivo real|teléfono/i;
const SOURCE_TEST = /\.source\.test\.ts$/;

// ---------------------------------------------------------------------------------------------------------
// Catalog and assignment
// ---------------------------------------------------------------------------------------------------------

export function parseCatalog(markdown: string): CatalogCase[] {
  const cases: CatalogCase[] = [];
  for (const line of markdown.split("\n")) {
    const match = CATALOG_LINE.exec(line);
    if (match) cases.push({ id: match[1], title: match[2].replace(/\.$/, "") });
  }
  return cases;
}

/** `| WA-05 | \`UT-API-03\`, ... |` rows of the "Cobertura del documento fuente" matrix. */
export function parseAssignment(markdown: string): Map<string, string> {
  const owner = new Map<string, string>();
  for (const line of markdown.split("\n")) {
    const row = /^\| (WA-\d+) \| (.+) \|$/.exec(line);
    if (!row || !row[2].includes("`")) continue;
    for (const id of row[2].match(/(?:UT|IT)-[A-Z]+-\d+/g) ?? []) owner.set(id, row[1]);
  }
  return owner;
}

export function normalizeId(kind: string, category: string, number: string): string {
  return `${kind}-${category}-${number}`;
}

// ---------------------------------------------------------------------------------------------------------
// Source scan
// ---------------------------------------------------------------------------------------------------------

const DECLARATIONS: Record<Lang, RegExp[]> = {
  go: [/^func (Test\w+)\(\w+ \*testing\.T\)/],
  kotlin: [/^\s*(?:@Test\s+)?fun (`[^`]+`|\w+)\(/],
  swift: [/^\s*func (test\w+)\(/],
  ts: [/^\s*(?:test|it)(?:\.\w+)?\(\s*(["'`])((?:\\.|(?!\1).)*)\1/],
  sh: [],
};

function languageOf(file: string): Lang | null {
  if (file.endsWith("_test.go")) return "go";
  if (/\.test\.tsx?$/.test(file)) return "ts";
  if (/(?:Test|Tests|InstrumentedTest)\.kt$/.test(file)) return "kotlin";
  if (/Tests\.swift$/.test(file)) return "swift";
  if (/^scripts\/test-[\w-]+\.sh$/.test(file)) return "sh";
  return null;
}

function isComment(line: string): boolean {
  return /^\s*(\/\/|\/\*|\*)/.test(line);
}

interface RawDecl { name: string; line: number; indent: number; describe: boolean; annotated: boolean; each?: boolean }

function declarationOf(lang: Lang, line: string): { name: string; describe: boolean } | null {
  if (lang === "ts") {
    const describe = /^\s*describe(?:\.\w+)?\(\s*(["'`])((?:\\.|(?!\1).)*)\1/.exec(line);
    if (describe) return { name: describe[2], describe: true };
    const match = DECLARATIONS.ts[0].exec(line);
    return match ? { name: match[2], describe: false } : null;
  }
  for (const pattern of DECLARATIONS[lang]) {
    const match = pattern.exec(line);
    if (match) return { name: match[1], describe: false };
  }
  return null;
}

/** Kotlin: only a function preceded by @Test counts; the annotation may share the line or the previous one. */
function kotlinIsTest(lines: string[], index: number): boolean {
  if (/@Test\b/.test(lines[index])) return true;
  for (let back = index - 1; back >= 0; back--) {
    if (/^\s*@\w+(\(.*\))?\s*$/.test(lines[back])) {
      if (/@Test\b/.test(lines[back])) return true;
      continue;
    }
    return false;
  }
  return false;
}

const EACH_TITLE = /\)\(\s*(["'`])((?:\\.|(?!\1).)*)\1\s*,/;

function collectRaw(lang: Lang, lines: string[]): RawDecl[] {
  const raw: RawDecl[] = [];
  let eachPending = false; // `test.each(table)(title, fn)`: the title may sit several lines below `.each(`
  lines.forEach((text, index) => {
    if (lang === "ts" && /\b(?:test|it)\.each\b/.test(text)) eachPending = true;
    const each = lang === "ts" && eachPending ? EACH_TITLE.exec(text) : null;
    if (each) eachPending = false;
    const found = each ? { name: each[2], describe: false } : declarationOf(lang, text);
    if (!found) return;
    if (lang === "kotlin" && !kotlinIsTest(lines, index)) return;
    raw.push({ name: found.name, line: index + 1, indent: text.length - text.trimStart().length, describe: found.describe, annotated: true, each: each !== null });
  });
  return raw;
}

/** Full jest-style name: enclosing `describe` titles (by indentation) plus the test title. */
function qualify(lang: Lang, raw: RawDecl[], position: number): string {
  if (lang !== "ts") return raw[position].name;
  const parts = [raw[position].name];
  let indent = raw[position].indent;
  for (let back = position - 1; back >= 0; back--) {
    if (raw[back].describe && raw[back].indent < indent) {
      parts.unshift(raw[back].name);
      indent = raw[back].indent;
    }
  }
  return parts.join(" ");
}

function packageOf(file: string): string {
  const inGo = file.replace(/^go\//, "");
  const dir = dirname(inGo);
  return dir === "." ? "yoyos-whatsapp" : `yoyos-whatsapp/${dir}`;
}

function declKey(lang: Lang, file: string, name: string): string {
  return lang === "go" ? `${packageOf(file)}::${name}` : `${file}::${name}`;
}

export function scanSource(file: string, source: string): { decls: Decl[]; citations: Citation[] } {
  const lang = languageOf(file);
  if (!lang) return { decls: [], citations: [] };
  const lines = source.split("\n");
  if (lang === "sh") return scanShell(file, lines);
  const raw = collectRaw(lang, lines);
  const decls = raw.filter((entry) => !entry.describe).map((entry, _, all) => {
    const position = raw.indexOf(entry);
    const name = qualify(lang, raw, position);
    return { file, lang, name, line: entry.line, key: declKey(lang, file, name), each: entry.each, indent: entry.indent } satisfies Decl;
  });
  const byLine = new Map(decls.map((decl) => [decl.line, decl]));
  const citations: Citation[] = [];
  lines.forEach((text, index) => {
    const line = index + 1;
    for (const found of text.matchAll(ID_PATTERN)) {
      const id = normalizeId(found[1], found[2], found[3]);
      citations.push({ id, decl: attach(lang, lines, raw, byLine, decls, index), file, line });
    }
  });
  return { decls, citations };
}

/** A shell test is one unit: the script itself, run as a whole. */
function scanShell(file: string, lines: string[]): { decls: Decl[]; citations: Citation[] } {
  const name = file.split("/").pop() ?? file;
  const decl: Decl = { file, lang: "sh", name, line: 1, key: `${file}::${name}` };
  const citations: Citation[] = [];
  lines.forEach((text, index) => {
    for (const found of text.matchAll(ID_PATTERN)) citations.push({ id: normalizeId(found[1], found[2], found[3]), decl, file, line: index + 1 });
  });
  return { decls: [decl], citations };
}

/** A citation names the declaration it sits on, the one a leading comment precedes, or the enclosing one. */
function attach(lang: Lang, lines: string[], raw: RawDecl[], byLine: Map<number, Decl>, decls: Decl[], index: number): Decl | null {
  const sameLine = byLine.get(index + 1);
  if (sameLine) return sameLine;
  const describeIndex = raw.findIndex((entry) => entry.describe && entry.line === index + 1);
  if (describeIndex >= 0) return null; // a describe title citing an ID covers the tests inside it (see below)
  if (isComment(lines[index])) {
    let next = index + 1;
    while (next < lines.length && (isComment(lines[next]) || /^\s*@\w+/.test(lines[next]))) next++;
    const following = byLine.get(next + 1) ?? byLine.get(next);
    if (following) return following;
  }
  if (lang === "kotlin" || lang === "ts" || lang === "go" || lang === "swift") {
    // Only a mention indented deeper than the declaration it follows sits inside that test; a column-0 or
    // same-indent comment between tests belongs to no test (WA-14 review minor 4).
    let enclosing: Decl | null = null;
    for (const decl of decls) if (decl.line <= index + 1) enclosing = decl;
    const indent = lines[index].length - lines[index].trimStart().length;
    return enclosing !== null && indent > (enclosing.indent ?? 0) ? enclosing : null;
  }
  return null;
}

/** Tests nested under a `describe` whose title cites an ID inherit the citation. */
export function describeCitations(file: string, source: string, decls: Decl[]): Citation[] {
  if (!/\.test\.tsx?$/.test(file)) return [];
  const lines = source.split("\n");
  const raw = collectRaw("ts", lines);
  const inherited: Citation[] = [];
  raw.forEach((entry, position) => {
    if (!entry.describe) return;
    const ids = [...entry.name.matchAll(ID_PATTERN)].map((found) => normalizeId(found[1], found[2], found[3]));
    if (ids.length === 0) return;
    const end = raw.slice(position + 1).find((later) => later.indent <= entry.indent) ?? null; // the first sibling or outer declaration closes the block
    for (const decl of decls) {
      if (decl.line > entry.line && (!end || decl.line < end.line)) {
        for (const id of ids) inherited.push({ id, decl, file, line: entry.line });
      }
    }
  });
  return inherited;
}

function walk(dir: string, accept: (path: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === "build" || name === ".gradle") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, accept, out);
    else if (accept(path)) out.push(path);
  }
  return out;
}

/** The module and the Yoyos composition tests that exercise it from outside (options, budgets). */
export function scanModule(moduleDir: string, extraRoots: string[] = [join(moduleDir, "../../src/composition")]): { decls: Decl[]; citations: Citation[] } {
  // The script's own tests quote case IDs as fixtures; they are not evidence of any case (WA-14 review minor 4).
  const accept = (path: string) => languageOf(relative(moduleDir, path)) !== null && relative(moduleDir, path) !== "scripts/trace-matrix.test.ts";
  const files = [moduleDir, ...extraRoots.filter((root) => existsSync(root))].flatMap((root) => walk(root, accept));
  const decls: Decl[] = [];
  const citations: Citation[] = [];
  for (const path of files) {
    const file = relative(moduleDir, path);
    const source = readFileSync(path, "utf8");
    const scanned = scanSource(file, source);
    decls.push(...scanned.decls);
    citations.push(...scanned.citations, ...describeCitations(file, source, scanned.decls));
  }
  return { decls, citations };
}

// ---------------------------------------------------------------------------------------------------------
// Declared links (tests that cover a case without citing its ID)
// ---------------------------------------------------------------------------------------------------------

const LinksSchema = z.object({
  links: z.array(z.object({
    id: z.string().regex(/^(UT|IT)-[A-Z]+-\d+$/),
    file: z.string().min(1),
    test: z.string().min(1),
    note: z.string().optional(),
  })),
  gaps: z.array(z.object({ id: z.string().regex(/^(UT|IT)-[A-Z]+-\d+$/), note: z.string().min(1) })).default([]),
});
export type Links = z.infer<typeof LinksSchema>;

export function parseLinks(text: string): { ok: true; value: Links } | { ok: false; error: string } {
  let json: unknown;
  try { json = JSON.parse(text); } catch (error) { return { ok: false, error: `invalid JSON: ${String(error)}` }; }
  const parsed = LinksSchema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.message };
}

// ---------------------------------------------------------------------------------------------------------
// Machine results
// ---------------------------------------------------------------------------------------------------------

const GoEventSchema = z.object({ Action: z.string(), Package: z.string().optional(), Test: z.string().optional() });
const JestSchema = z.object({
  testResults: z.array(z.object({
    name: z.string(),
    assertionResults: z.array(z.object({ fullName: z.string(), status: z.string() })),
  })),
});

/** `go test -json` output, possibly mixed with plain lines from vet and the other commands of test-go.sh. */
export function parseGoResults(text: string): Map<string, Result> {
  const results = new Map<string, Result>();
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    let json: unknown;
    try { json = JSON.parse(line); } catch { continue; }
    const event = GoEventSchema.safeParse(json);
    if (!event.success || !event.data.Test || !event.data.Package || event.data.Test.includes("/")) continue;
    const action = event.data.Action;
    if (action !== "pass" && action !== "fail" && action !== "skip") continue;
    results.set(`${event.data.Package}::${event.data.Test}`, action);
  }
  return results;
}

export function parseJestResults(text: string, moduleDir: string): Map<string, Result> {
  const results = new Map<string, Result>();
  const parsed = JestSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`jest results: ${parsed.error.message}`);
  for (const suite of parsed.data.testResults) {
    const file = relative(moduleDir, suite.name);
    for (const test of suite.assertionResults) {
      results.set(`${file}::${test.fullName}`, test.status === "passed" ? "pass" : test.status === "failed" ? "fail" : "skip");
    }
  }
  return results;
}

/** `{ "scripts/test-x.sh": "pass" | "fail" }`, written by trace-evidence.sh from each script's exit status. */
export function parseShellResults(text: string): Map<string, Result> {
  const parsed = z.record(z.string(), z.enum(["pass", "fail"])).safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`shell results: ${parsed.error.message}`);
  return new Map(Object.entries(parsed.data).map(([file, result]) => [`${file}::${file.split("/").pop()}`, result]));
}

// ---------------------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------------------

export interface Inputs {
  catalog: CatalogCase[];
  owner: Map<string, string>;
  decls: Decl[];
  citations: Citation[];
  links: Links;
  results: Map<string, Result>;
}

export function isNative(decl: Decl | null): boolean {
  return decl !== null && (decl.lang === "kotlin" || decl.lang === "swift");
}

/** `test.each` titles carry %s-style placeholders: they match every row that jest ran for them. */
export function lookupResult(decl: Decl, results: Map<string, Result>): Result {
  const exact = results.get(decl.key);
  if (exact || !decl.each) return exact ?? "none";
  const [file, name] = [decl.file, decl.name];
  const pattern = new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}::${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%[spdijoOfc#]/g, ".*")}$`);
  const rows = [...results].filter(([key]) => pattern.test(key)).map(([, value]) => value);
  if (rows.length === 0) return "none";
  return rows.includes("fail") ? "fail" : rows.every((row) => row === "pass") ? "pass" : "skip";
}

function collectEvidence(id: string, inputs: Inputs): Evidence[] {
  const evidence: Evidence[] = [];
  const seen = new Set<string>();
  const add = (decl: Decl | null, file: string, via: "cite" | "link", note?: string) => {
    const key = decl ? decl.key : `${file}::`;
    if (seen.has(key)) return;
    seen.add(key);
    const result: Result = decl && !isNative(decl) ? lookupResult(decl, inputs.results) : "none";
    evidence.push({ decl, file, result, via, note });
  };
  for (const citation of inputs.citations) if (citation.id === id) add(citation.decl, citation.file, "cite");
  for (const link of inputs.links.links) {
    if (link.id !== id) continue;
    const decl = inputs.decls.find((candidate) => candidate.file === link.file && candidate.name === link.test) ?? null;
    add(decl, link.file, "link", link.note);
  }
  return evidence;
}

/** A citation without a declaration names a file header: it proves nothing runs for that case. */
function classify(item: CatalogCase, evidence: Evidence[], gap: string | undefined): { status: Status; reason: string } {
  const named = evidence.filter((entry) => entry.decl !== null);
  const native = named.filter((entry) => isNative(entry.decl));
  const controlled = named.filter((entry) => !isNative(entry.decl));
  const failed = controlled.filter((entry) => entry.result === "fail");
  const passed = controlled.filter((entry) => entry.result === "pass");
  const behavioral = passed.filter((entry) => !SOURCE_TEST.test(entry.file));
  const nativeText = NATIVE_TEXT.test(item.title) || /^IT-(AND|IOS|BLD)-/.test(item.id);
  if (failed.length > 0) return { status: "falla", reason: `${failed.length} prueba(s) fallan` };
  if (named.length === 0) return { status: "no implementado", reason: gap ?? (evidence.length > 0 ? "solo menciones sin prueba" : "ninguna prueba lo cita ni lo enlaza") };
  if (passed.length === 0) {
    if (native.length > 0) return { status: "no ejecutado-nativo", reason: "solo código Kotlin/Swift sin ejecutar" };
    const unrun = controlled.length;
    return { status: "no implementado", reason: `${unrun} prueba(s) sin resultado de ejecución` };
  }
  if (gap) return { status: "parcial", reason: gap };
  if (behavioral.length === 0) return { status: "parcial", reason: "solo pruebas de forma sobre el código fuente" };
  if (native.length > 0) return { status: "parcial", reason: "parte controlada pasa; la parte nativa no se ejecutó" };
  if (nativeText) return { status: "parcial", reason: "parte controlada pasa; el caso exige plataforma real" };
  return { status: "pasa", reason: "" };
}

export function evaluate(inputs: Inputs): Row[] {
  const gaps = new Map(inputs.links.gaps.map((entry) => [entry.id, entry.note]));
  return inputs.catalog.map((item) => {
    const evidence = collectEvidence(item.id, inputs);
    const { status, reason } = classify(item, evidence, gaps.get(item.id));
    return { id: item.id, task: inputs.owner.get(item.id) ?? "?", title: item.title, status, evidence, reason };
  });
}

/** Links and citations that point at nothing are errors, not silent gaps. */
export function validateLinks(inputs: Inputs): string[] {
  const problems: string[] = [];
  const ids = new Set(inputs.catalog.map((item) => item.id));
  for (const link of inputs.links.links) {
    if (!ids.has(link.id)) problems.push(`link to unknown case ${link.id}`);
    if (!inputs.decls.some((decl) => decl.file === link.file && decl.name === link.test)) problems.push(`link ${link.id} -> ${link.file}::${link.test} not found`);
  }
  for (const gap of inputs.links.gaps) if (!ids.has(gap.id)) problems.push(`gap for unknown case ${gap.id}`);
  for (const id of ids) if (!inputs.owner.has(id)) problems.push(`case ${id} has no task in the assignment matrix`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------------------

const ORDER: Status[] = ["pasa", "parcial", "no ejecutado-nativo", "falla", "no implementado"];

export function summarize(rows: Row[]): Record<Status, number> {
  const counts = { pasa: 0, parcial: 0, "no ejecutado-nativo": 0, falla: 0, "no implementado": 0 } as Record<Status, number>;
  for (const row of rows) counts[row.status]++;
  return counts;
}

function describeEvidence(entry: Evidence): string {
  if (!entry.decl) return `\`${entry.file}\` (mención sin prueba)`;
  const suffix = isNative(entry.decl) ? " (nativa, no ejecutada)" : entry.result === "pass" ? "" : ` (${entry.result === "none" ? "sin resultado" : entry.result})`;
  return `\`${entry.file}\` → \`${entry.decl.name}\`${suffix}`;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

export function render(rows: Row[], hasResults: boolean): string {
  const counts = summarize(rows);
  const byKind = (kind: string) => rows.filter((row) => row.id.startsWith(kind));
  const out: string[] = [];
  out.push("# WA-14 traceability matrix", "");
  out.push("<!-- Generated by scripts/trace-matrix.ts. Do not edit by hand: run `sh scripts/trace-evidence.sh`. -->", "");
  out.push(`${rows.length} cases (${byKind("UT").length} UT, ${byKind("IT").length} IT), each assigned once in \`docs/whatsmeow-go-expo-tasks.md\`. Assignment is not coverage: the status below comes from tests found in the code${hasResults ? " and from the results of the last run" : " (no run results were supplied, so nothing is reported as passing)"}.`, "");
  out.push("| Status | Cases |", "| --- | ---: |");
  for (const status of ORDER) out.push(`| ${status} | ${counts[status]} |`);
  out.push("", "`pasa` means a non-native test that ran and passed covers the case and the case does not require a platform. `parcial` means only a part is demonstrated (the reason is in the last column). Nothing here asserts behaviour against real WhatsApp.", "");
  const tasks = [...new Set(rows.map((row) => row.task))].sort();
  out.push("## By task", "", `| Task | ${ORDER.join(" | ")} |`, `| --- | ${ORDER.map(() => "---:").join(" | ")} |`);
  for (const task of tasks) {
    const subset = summarize(rows.filter((row) => row.task === task));
    out.push(`| ${task} | ${ORDER.map((status) => subset[status]).join(" | ")} |`);
  }
  out.push("", "## Cases", "", "| ID | Task | File and test | Status | Reason |", "| --- | --- | --- | --- | --- |");
  for (const row of rows) {
    const shown = row.evidence.slice(0, 4).map(describeEvidence);
    if (row.evidence.length > 4) shown.push(`+${row.evidence.length - 4} more`);
    out.push(`| ${row.id} | ${row.task} | ${cell(shown.join("<br>") || "—")} | ${row.status} | ${cell(row.reason)} |`);
  }
  out.push("");
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

export function run(args: string[], moduleDir: string, repoRoot: string): number {
  const goPath = option(args, "--go-json");
  const jestPath = option(args, "--jest-json");
  const shellPath = option(args, "--sh-json");
  const catalog = parseCatalog(readFileSync(join(repoRoot, "docs/whatsmeow-go-expo-implementation.md"), "utf8"));
  const owner = parseAssignment(readFileSync(join(repoRoot, "docs/whatsmeow-go-expo-tasks.md"), "utf8"));
  const linksPath = option(args, "--links") ?? join(moduleDir, "trace-links.json");
  const links = existsSync(linksPath) ? parseLinks(readFileSync(linksPath, "utf8")) : { ok: true as const, value: { links: [], gaps: [] } };
  if (!links.ok) { console.error(`trace-links.json: ${links.error}`); return 1; }
  const results = new Map<string, Result>();
  if (goPath) for (const [key, value] of parseGoResults(readFileSync(goPath, "utf8"))) results.set(key, value);
  if (jestPath) for (const [key, value] of parseJestResults(readFileSync(jestPath, "utf8"), moduleDir)) results.set(key, value);
  if (shellPath) for (const [key, value] of parseShellResults(readFileSync(shellPath, "utf8"))) results.set(key, value);
  const scanned = scanModule(moduleDir);
  const inputs: Inputs = { catalog, owner, decls: scanned.decls, citations: scanned.citations, links: links.value, results };
  const problems = validateLinks(inputs);
  if (catalog.length !== 242) problems.push(`catalog has ${catalog.length} cases, expected 242`);
  if (problems.length > 0) { console.error(problems.join("\n")); return 1; }
  const rows = evaluate(inputs);
  const markdown = render(rows, results.size > 0);
  const outDir = option(args, "--out") ?? moduleDir;
  const target = join(outDir, "TRACEABILITY.md");
  if (args.includes("--check")) {
    const current = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (current !== markdown) { console.error("TRACEABILITY.md is stale: regenerate it with scripts/trace-evidence.sh"); return 1; }
    return 0;
  }
  writeFileSync(target, markdown);
  writeFileSync(join(outDir, "traceability.json"), JSON.stringify(rows.map((row) => ({
    id: row.id, task: row.task, status: row.status, reason: row.reason,
    tests: row.evidence.filter((entry) => entry.decl).map((entry) => ({ file: entry.file, test: entry.decl?.name, via: entry.via, native: isNative(entry.decl), result: entry.result })),
  })), null, 2) + "\n");
  console.log(JSON.stringify(summarize(rows)));
  return 0;
}

if (process.argv[1]?.endsWith("trace-matrix.ts")) {
  const moduleDir = join(dirname(process.argv[1]), "..");
  process.exitCode = run(process.argv.slice(2), moduleDir, join(moduleDir, "../../../.."));
}
