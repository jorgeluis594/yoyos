import { userInfo } from "node:os";
import { reportConfiguredVerdictLabels } from "@core/src/features/orders/composition";
import { parseTraceReaders, readTokenFromInput, readTokenFromTerminal } from "@core/src/features/orders/presentation/trace-reader-token";
import { runVerdictsReport } from "@core/src/features/orders/presentation/verdicts-command";

process.exitCode = await runVerdictsReport({
  args: process.argv.slice(2),
  readers: parseTraceReaders(process.env.TRACE_READERS),
  token: () => process.stdin.isTTY ? readTokenFromTerminal(process.stdin, process.stderr) : readTokenFromInput(process.stdin),
  osUser: userInfo().username,
  report: reportConfiguredVerdictLabels,
  print: (text) => process.stdout.write(text),
  fail: (text) => console.error(text),
});
process.exit();
