import { expect } from "vitest";
import { createHarness, describeEval } from "vitest-evals";

// Proves the eval wiring runs; it calls no model and is removed once real evals exist.
const echoHarness = createHarness<string, string>({
  name: "echo",
  run: async ({ input }) => ({
    output: input,
    events: [
      { type: "message", role: "user", content: input },
      { type: "message", role: "assistant", content: input },
    ],
  }),
});

describeEval("smoke", { harness: echoHarness }, (it) => {
  it("echoes the message", async ({ run }) => {
    const result = await run("quiero la gorra");

    expect(result.output).toBe("quiero la gorra");
  });
});
