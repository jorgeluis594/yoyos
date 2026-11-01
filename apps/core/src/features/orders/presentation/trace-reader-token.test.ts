import { Readable } from "node:stream";
import { expect, test } from "vitest";
import { hashToken, issueReaderToken, parseTraceReaders, readTokenFromInput, readerNameOf } from "@core/src/features/orders/presentation/trace-reader-token";

const anaHash = hashToken("ana-token");
const luisHash = hashToken("luis-token");

test("parses name:sha256 pairs and ignores blanks", () => {
  expect(parseTraceReaders(` Ana:${anaHash}, ,Luis:${luisHash}`)).toEqual([{ name: "Ana", hash: anaHash }, { name: "Luis", hash: luisHash }]);
  expect(parseTraceReaders(undefined)).toEqual([]);
  expect(parseTraceReaders("")).toEqual([]);
});

test("rejects a pair without a name or with a malformed hash", () => {
  expect(() => parseTraceReaders(`:${anaHash}`)).toThrow();
  expect(() => parseTraceReaders("Ana:abc")).toThrow();
  expect(() => parseTraceReaders("Ana")).toThrow();
});

test("resolves the reader of a token and nobody for an unknown one", () => {
  const readers = parseTraceReaders(`Ana:${anaHash},Luis:${luisHash}`);
  expect(readerNameOf(readers, "luis-token")).toBe("Luis");
  expect(readerNameOf(readers, "other")).toBeNull();
  expect(readerNameOf(readers, "")).toBeNull();
  expect(readerNameOf([], "ana-token")).toBeNull();
});

test("reads the first line of the input as the token and none when it is empty", async () => {
  expect(await readTokenFromInput(Readable.from(["ana-token\nrest"]))).toBe("ana-token");
  expect(await readTokenFromInput(Readable.from(["  ana-token  "]))).toBe("ana-token");
  expect(await readTokenFromInput(Readable.from([""]))).toBeNull();
  expect(await readTokenFromInput(Readable.from(["\n"]))).toBeNull();
});

test("issues a random 32-byte token with the line for TRACE_READERS", () => {
  const first = issueReaderToken("Ana");
  expect(Buffer.from(first.token, "hex")).toHaveLength(32);
  expect(first.line).toBe(`Ana:${hashToken(first.token)}`);
  expect(issueReaderToken("Ana").token).not.toBe(first.token);
});
