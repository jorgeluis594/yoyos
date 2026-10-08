const { createRequire } = require("node:module");

const expoRequire = createRequire(require.resolve("expo/package.json"));
const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
const { sprintf } = cliRequire("sprintf-js");

test("bounds numeric precision without breaking ordinary formats", () => {
  for (const format of ["%.999e", "%.999f", "%.999g", "%.0g"]) {
    expect(() => sprintf(format, 1.25)).not.toThrow();
  }
  expect(sprintf("%.2f", 1.25)).toBe("1.25");
});
