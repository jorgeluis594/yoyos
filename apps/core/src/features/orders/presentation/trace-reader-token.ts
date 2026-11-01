import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type TraceReader = Readonly<{ name: string; hash: string }>;

const pair = /^([^:]+):([0-9a-f]{64})$/;

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** `TRACE_READERS`: comma-separated `name:sha256(token)` pairs. A malformed pair fails, so a typo cannot silently drop a reader. */
export function parseTraceReaders(value: string | undefined): readonly TraceReader[] {
  return (value ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry !== "").map((entry) => {
    const match = pair.exec(entry);
    if (!match || match[1]!.trim() === "") throw new Error("TRACE_READERS must hold name:sha256 pairs");
    return { name: match[1]!.trim(), hash: match[2]! };
  });
}

/** Compares the token's hash with every reader in constant time per comparison; no early exit on a match. */
export function readerNameOf(readers: readonly TraceReader[], token: string): string | null {
  if (token === "") return null;
  const candidate = Buffer.from(hashToken(token), "hex");
  let found: string | null = null;
  for (const reader of readers) if (timingSafeEqual(candidate, Buffer.from(reader.hash, "hex")) && found === null) found = reader.name;
  return found;
}

/** The first line of the stream, trimmed; null when there is none. */
export async function readTokenFromInput(input: AsyncIterable<string | Buffer>): Promise<string | null> {
  let text = "";
  for await (const chunk of input) {
    text += chunk.toString();
    if (text.includes("\n")) break;
  }
  const token = (text.split("\n")[0] ?? "").trim();
  return token === "" ? null : token;
}

/** Reads the token from a terminal without echoing it. */
export async function readTokenFromTerminal(input: NodeJS.ReadStream, output: NodeJS.WriteStream, prompt = "Token: "): Promise<string | null> {
  output.write(prompt);
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  return new Promise((resolve) => {
    let text = "";
    const finish = (value: string | null) => { input.setRawMode(false); input.pause(); input.off("data", onData); output.write("\n"); resolve(value); };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") return finish(text.trim() === "" ? null : text.trim());
        if (char === "\u0003") return finish(null);
        if (char === "\u007f") text = text.slice(0, -1);
        else text += char;
      }
    };
    input.on("data", onData);
  });
}

/** A new random token (32 bytes, hex) and the line to add to `TRACE_READERS`. It stores nothing. */
export function issueReaderToken(name: string): Readonly<{ token: string; line: string }> {
  const token = randomBytes(32).toString("hex");
  return { token, line: `${name}:${hashToken(token)}` };
}
