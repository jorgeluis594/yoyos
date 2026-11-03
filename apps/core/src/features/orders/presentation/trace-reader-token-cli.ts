import { issueReaderToken } from "@core/src/features/orders/presentation/trace-reader-token";

const name = process.argv[2]?.trim();
if (!name || name.includes(":") || name.includes(",")) {
  console.error("Usage: pnpm --dir apps/core trace:reader-token <name>   (the name has no ':' or ',')");
  process.exit(2);
}
const { token, line } = issueReaderToken(name);
console.log(`Token (give it to ${name}; it is not stored anywhere): ${token}`);
console.log(`Add to TRACE_READERS: ${line}`);
