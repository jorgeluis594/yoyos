import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  describeCitations, evaluate, lookupResult, parseAssignment, parseCatalog, parseGoResults, parseLinks, render, scanSource, summarize, validateLinks,
  type Decl, type Inputs, type Result,
} from "./trace-matrix";

const repoRoot = join(__dirname, "../../../../..");
const doc = (name: string) => readFileSync(join(repoRoot, "docs", name), "utf8");

function inputsFor(source: { file: string; text: string }, ids: string[], results: Record<string, Result>, links: Inputs["links"] = { links: [], gaps: [] }): Inputs {
  const scanned = scanSource(source.file, source.text);
  return {
    catalog: ids.map((id) => ({ id, title: "x" })),
    owner: new Map(ids.map((id) => [id, "WA-99"])),
    decls: scanned.decls,
    citations: [...scanned.citations, ...describeCitations(source.file, source.text, scanned.decls)],
    links,
    results: new Map(Object.entries(results)),
  };
}

describe("catalog and assignment (the 242 cases)", () => {
  const catalog = parseCatalog(doc("whatsmeow-go-expo-implementation.md"));
  const owner = parseAssignment(doc("whatsmeow-go-expo-tasks.md"));
  test("68 unit and 174 integration cases, each owned by exactly one task", () => {
    expect(catalog).toHaveLength(242);
    expect(catalog.filter((item) => item.id.startsWith("UT-"))).toHaveLength(68);
    expect(catalog.filter((item) => item.id.startsWith("IT-"))).toHaveLength(174);
    expect(new Set(catalog.map((item) => item.id)).size).toBe(242);
    expect(catalog.filter((item) => !owner.has(item.id))).toEqual([]);
    expect(owner.size).toBe(242);
  });
});

describe("scanSource", () => {
  const go = [
    "package x", "",
    "// IT-BRG-07 and the lock order.", "func TestAlpha(t *testing.T) {", "\t// UT-ID-01 inside the body", "}", "",
    "func TestITID08Beta(t *testing.T) {}", "",
    "func TestNothing(t *testing.T) {}",
  ].join("\n");
  const scanned = scanSource("go/internal/x/x_test.go", go);
  test("a leading comment attaches to the test below it, a body comment to its own test", () => {
    const owners = Object.fromEntries(scanned.citations.map((citation) => [citation.id, citation.decl?.name]));
    expect(owners["IT-BRG-07"]).toBe("TestAlpha");
    expect(owners["UT-ID-01"]).toBe("TestAlpha");
  });
  test("an ID folded into a Go test name is recognised", () => {
    expect(scanned.citations.find((citation) => citation.id === "IT-ID-08")?.decl?.name).toBe("TestITID08Beta");
  });
  test("Go tests key on their package, jest tests on their file and full title", () => {
    expect(scanned.decls.map((decl) => decl.key)).toContain("yoyos-whatsapp/internal/x::TestAlpha");
    const ts = scanSource("a.test.ts", 'describe("IT-SEG-01 group", () => {\n  test("does a thing", () => {});\n});\n');
    expect(ts.decls[0].key).toBe("a.test.ts::IT-SEG-01 group does a thing");
  });
  test("a describe title cites for the tests inside it", () => {
    const text = 'describe("IT-SEG-01 group", () => {\n  test("a", () => {});\n});\ndescribe("other", () => {\n  test("b", () => {});\n});\n';
    const inherited = describeCitations("a.test.ts", text, scanSource("a.test.ts", text).decls);
    expect(inherited.map((citation) => citation.decl?.name)).toEqual(["IT-SEG-01 group a"]);
  });
  test("test.each titles are tests, with %s matched against the rows jest ran", () => {
    const text = 'test.each([\n  ["a", 1],\n])("UT-API-06 rejects %s options", () => {});\n';
    const scanned = scanSource("c.test.ts", text);
    expect(scanned.decls.map((decl) => [decl.name, decl.each])).toEqual([["UT-API-06 rejects %s options", true]]);
    expect(scanned.citations[0].decl?.name).toBe("UT-API-06 rejects %s options");
    const results = new Map<string, Result>([["c.test.ts::UT-API-06 rejects a options", "pass"], ["c.test.ts::UT-API-06 rejects b options", "pass"]]);
    expect(lookupResult(scanned.decls[0], results)).toBe("pass");
    results.set("c.test.ts::UT-API-06 rejects c options", "fail");
    expect(lookupResult(scanned.decls[0], results)).toBe("fail");
    expect(lookupResult(scanned.decls[0], new Map())).toBe("none");
  });
  test("Kotlin counts only @Test functions", () => {
    const kt = ["class T {", "  // IT-AND-01", "  @Test fun manifest() {}", "  fun helper() {}", "}"].join("\n");
    expect(scanSource("android/src/test/X/YTest.kt", kt).decls.map((decl) => decl.name)).toEqual(["manifest"]);
  });
});

describe("evaluate", () => {
  const text = [
    "package p", "// IT-API-01", "func TestOne(t *testing.T) {}", "// IT-API-02", "func TestTwo(t *testing.T) {}", "// IT-API-03", "func TestThree(t *testing.T) {}",
  ].join("\n");
  const file = { file: "go/internal/p/p_test.go", text };
  const key = (name: string) => `yoyos-whatsapp/internal/p::${name}`;
  const ids = ["IT-API-01", "IT-API-02", "IT-API-03", "IT-API-04", "IT-STO-01"];

  test("pass, fail, missing result and no test map to distinct statuses", () => {
    const rows = evaluate(inputsFor(file, ids, { [key("TestOne")]: "pass", [key("TestTwo")]: "fail" }));
    const by = Object.fromEntries(rows.map((row) => [row.id, row.status]));
    expect(by).toMatchObject({ "IT-API-01": "pasa", "IT-API-02": "falla", "IT-API-03": "no implementado", "IT-API-04": "no implementado" });
  });
  test("nothing is reported as passing without results", () => {
    expect(summarize(evaluate(inputsFor(file, ids, {}))).pasa).toBe(0);
  });
  test("a declared gap downgrades a passing case to partial", () => {
    const rows = evaluate(inputsFor(file, ids, { [key("TestOne")]: "pass" }, { links: [], gaps: [{ id: "IT-API-01", note: "native half unrun" }] }));
    expect(rows[0]).toMatchObject({ status: "parcial", reason: "native half unrun" });
  });
  test("a link adds a test that cites nothing; Android cases cap at partial", () => {
    const rows = evaluate(inputsFor(file, ids, { [key("TestThree")]: "pass" }, { links: [{ id: "IT-STO-01", file: file.file, test: "TestThree" }], gaps: [] }));
    expect(rows.find((row) => row.id === "IT-STO-01")?.status).toBe("pasa");
    const android = evaluate(inputsFor(file, ["IT-AND-01"], { [key("TestThree")]: "pass" }, { links: [{ id: "IT-AND-01", file: file.file, test: "TestThree" }], gaps: [] }));
    expect(android[0].status).toBe("parcial");
  });
  test("native-only evidence is not executed; native plus passing controlled evidence is partial", () => {
    const kt = { file: "android/src/test/X/PolicyTest.kt", text: "// IT-CFG-03\n@Test fun policy() {}\n" };
    expect(evaluate(inputsFor(kt, ["IT-CFG-03"], {}))[0].status).toBe("no ejecutado-nativo");
    const mixed = inputsFor(kt, ["IT-CFG-03"], { [key("TestOne")]: "pass" }, { links: [{ id: "IT-CFG-03", file: file.file, test: "TestOne" }], gaps: [] });
    mixed.decls.push(...scanSource(file.file, file.text).decls);
    expect(evaluate(mixed)[0].status).toBe("parcial");
  });
  test("a source-shape jest test never counts as a pass of the behaviour", () => {
    const shape = { file: "thing.source.test.ts", text: 'test("IT-API-01 manifest", () => {});\n' };
    const rows = evaluate(inputsFor(shape, ["IT-API-01"], { "thing.source.test.ts::IT-API-01 manifest": "pass" }));
    expect(rows[0].status).toBe("parcial");
  });
});

describe("classifier review fixes", () => {
  const pass = (text: string) => {
    const source = { file: "go/internal/p/p_test.go", text: "package p\n// IT-API-01\nfunc TestOne(t *testing.T) {}\n" };
    const input = inputsFor(source, ["IT-API-01"], { "yoyos-whatsapp/internal/p::TestOne": "pass" });
    input.catalog = [{ id: "IT-API-01", title: text }];
    return evaluate(input)[0].status;
  };
  test("'iOS' only counts as a word: 'cambios' and 'arbitrarios' do not demand a platform", () => {
    expect(pass("Aplica cambios arbitrarios sin tocar el almacen")).toBe("pasa");
    expect(pass("Funciona en iOS con Keychain")).toBe("parcial");
  });
  test("a comment between tests belongs to no test, one inside a body to its test", () => {
    const text = ["package p", "func TestOne(t *testing.T) {", "\t// IT-API-01 inside", "}", "// IT-API-02 between tests", "func helper() {}", "func TestTwo(t *testing.T) {}"].join("\n");
    const owners = Object.fromEntries(scanSource("go/internal/p/p_test.go", text).citations.map((citation) => [citation.id, citation.decl?.name ?? null]));
    expect(owners).toEqual({ "IT-API-01": "TestOne", "IT-API-02": null });
  });
  test("a describe closes at the first sibling, so later top-level tests do not inherit its IDs", () => {
    const text = 'describe("IT-SEG-01 group", () => {\n  test("a", () => {});\n});\ntest("top level", () => {});\n';
    const inherited = describeCitations("a.test.ts", text, scanSource("a.test.ts", text).decls);
    expect(inherited.map((citation) => citation.decl?.name)).toEqual(["IT-SEG-01 group a"]);
  });
});

describe("inputs", () => {
  test("go test -json is read among plain lines", () => {
    const out = [
      "plain line", '{"Action":"run","Package":"p","Test":"TestA"}', '{"Action":"pass","Package":"p","Test":"TestA/sub"}',
      '{"Action":"pass","Package":"p","Test":"TestA"}', '{"Action":"fail","Package":"p","Test":"TestB"}', '{"Action":"pass","Package":"p"}', "{broken",
    ].join("\n");
    expect([...parseGoResults(out)]).toEqual([["p::TestA", "pass"], ["p::TestB", "fail"]]);
  });
  test("subtests are judged with their parent: a skipped one makes it skip, a failed one makes it fail", () => {
    const line = (action: string, test: string) => JSON.stringify({ Action: action, Package: "p", Test: test });
    const out = [
      line("pass", "TestA/one"), line("skip", "TestA/two"), line("pass", "TestA"),
      line("fail", "TestB/one"), line("pass", "TestB/two"), line("pass", "TestB"),
      line("pass", "TestC/one"), line("pass", "TestC"),
    ].join("\n");
    expect([...parseGoResults(out)]).toEqual([["p::TestA", "skip"], ["p::TestB", "fail"], ["p::TestC", "pass"]]);
  });
  test("links are validated at the JSON boundary", () => {
    expect(parseLinks("not json").ok).toBe(false);
    expect(parseLinks('{"links":[{"id":"bad","file":"f","test":"t"}]}').ok).toBe(false);
    expect(parseLinks('{"links":[{"id":"IT-API-01","file":"f","test":"t"}]}').ok).toBe(true);
  });
  test("a link to a missing test or unknown case is a problem, not a silent gap", () => {
    const input = inputsFor({ file: "go/p/p_test.go", text: "package p\nfunc TestA(t *testing.T) {}\n" }, ["IT-API-01"], {}, {
      links: [{ id: "IT-API-01", file: "go/p/p_test.go", test: "TestMissing" }, { id: "IT-NOPE-01", file: "go/p/p_test.go", test: "TestA" }], gaps: [],
    });
    expect(validateLinks(input)).toEqual(expect.arrayContaining([expect.stringContaining("TestMissing"), expect.stringContaining("unknown case IT-NOPE-01")]));
  });
  test("the markdown states that no results means nothing passes", () => {
    const rows = evaluate(inputsFor({ file: "go/p/p_test.go", text: "package p\n// IT-API-01\nfunc TestA(t *testing.T) {}\n" }, ["IT-API-01"], {}));
    expect(render(rows, false)).toContain("nothing is reported as passing");
  });
});

describe("the generated matrix", () => {
  const rows = JSON.parse(readFileSync(join(__dirname, "../traceability.json"), "utf8")) as { id: string; status: string; tests: { file: string; test: string }[] }[];
  const catalog = parseCatalog(doc("whatsmeow-go-expo-implementation.md"));
  test("has one row per catalog case and only known statuses", () => {
    expect(rows.map((row) => row.id)).toEqual(catalog.map((item) => item.id));
    for (const row of rows) expect(["pasa", "parcial", "no ejecutado-nativo", "falla", "no implementado"]).toContain(row.status);
  });
  test("every referenced test exists in the code", () => {
    const decls: Decl[] = [];
    for (const file of new Set(rows.flatMap((row) => row.tests.map((test) => test.file)))) {
      decls.push(...scanSource(file, readFileSync(join(__dirname, "..", file), "utf8")).decls);
    }
    for (const row of rows) for (const test of row.tests) expect(decls.some((decl) => decl.file === test.file && decl.name === test.test)).toBe(true);
  });
  test("nothing failing is recorded", () => {
    expect(rows.filter((row) => row.status === "falla")).toEqual([]);
  });
});
