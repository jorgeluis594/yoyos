import { userInfo } from "node:os";
import { readMessageTraces } from "@core/src/features/orders/composition";
import { parseTraceReaders, readTokenFromInput, readTokenFromTerminal } from "@core/src/features/orders/presentation/trace-reader-token";
import { runTraceRead } from "@core/src/features/orders/presentation/trace-read-command";

process.exitCode = await runTraceRead({
  args: process.argv.slice(2),
  readers: parseTraceReaders(process.env.TRACE_READERS),
  token: () => process.stdin.isTTY ? readTokenFromTerminal(process.stdin, process.stderr) : readTokenFromInput(process.stdin),
  osUser: userInfo().username,
  read: readMessageTraces,
  print: (text) => process.stdout.write(text),
  fail: (text) => console.error(text),
});
process.exit();
