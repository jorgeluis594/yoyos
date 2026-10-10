const { createRequire } = require("node:module");

const expoRequire = createRequire(require.resolve("expo/package.json"));
const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
const braces = cliRequire("braces");
const compile = cliRequire("braces/lib/compile");
const expand = cliRequire("braces/lib/expand");
const stringify = cliRequire("braces/lib/stringify");

test("bounds nested patterns and caller supplied ASTs", () => {
  const pattern = "{".repeat(101) + "a,b" + "}".repeat(101);
  expect(() => braces(pattern)).toThrow(/exceeds max depth/);
  expect(() => braces.expand(pattern)).toThrow(/exceeds max depth/);

  let ast = { type: "text", value: "a" };
  for (let index = 0; index < 101; index++) ast = { type: "brace", nodes: [ast] };
  ast = { type: "root", nodes: [ast] };
  for (const walk of [compile, expand, stringify]) {
    expect(() => walk(ast)).toThrow(/exceeds max depth/);
  }

  expect(braces("a/{b,c}/d")).toEqual(["a/(b|c)/d"]);
});
