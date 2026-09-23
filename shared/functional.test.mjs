import assert from "node:assert/strict";
import test from "node:test";
import {
  ok, err, map, mapError, andThen, mapAsync, andThenAsync, sequence, traverse,
} from "./functional.ts";

test("composition transforms values and preserves failures without running later work", async () => {
  const failure = err({ message: "Unavailable" });
  const unexpected = () => assert.fail("Callback must not run");
  assert.deepEqual(andThen(map(ok(2), (n) => n + 1), (n) => ok(n * 2)), ok(6));
  assert.equal(map(failure, unexpected), failure);
  assert.equal(andThen(failure, unexpected), failure);
  assert.equal(andThen(ok(1), () => failure), failure);
  assert.deepEqual(mapError(failure, (error) => ({ ...error, code: "UNAVAILABLE" })),
    err({ message: "Unavailable", code: "UNAVAILABLE" }));
  const success = ok(null);
  assert.equal(mapError(success, unexpected), success);
  assert.deepEqual(await mapAsync(Promise.resolve(ok(2)), async (n) => n + 1), ok(3));
  assert.deepEqual(await andThenAsync(ok(2), async (n) => ok(String(n))), ok("2"));
  assert.deepEqual(await andThenAsync(Promise.resolve(ok(2)), (n) => ok(n + 1)), ok(3));
  assert.equal(await mapAsync(failure, unexpected), failure);
  assert.equal(await andThenAsync(Promise.resolve(failure), unexpected), failure);
  assert.equal(await andThenAsync(ok(1), async () => failure), failure);
});

test("collections preserve order, accept empty input, and stop traversal on failure", () => {
  const failure = err({ message: "Invalid item" });
  assert.deepEqual(sequence([ok(1), ok(2)]), ok([1, 2]));
  assert.deepEqual(sequence([]), ok([]));
  assert.deepEqual(traverse([], () => assert.fail("Empty input")), ok([]));
  assert.equal(sequence([ok(1), failure, err({ message: "Later" })]), failure);
  const visited = [];
  assert.equal(traverse([1, 2, 3], (n) => {
    visited.push(n);
    return n === 2 ? failure : ok(n);
  }), failure);
  assert.deepEqual(visited, [1, 2]);
  const input = Object.freeze([1, 2]);
  assert.deepEqual(traverse(input, (n) => ok(n * 2)), ok([2, 4]));
});

test("exceptions and rejected promises remain observable", async () => {
  const exception = new Error("Unexpected");
  const throws = () => { throw exception; };
  assert.throws(() => map(ok(1), throws), (error) => error === exception);
  assert.throws(() => andThen(ok(1), throws), (error) => error === exception);
  await assert.rejects(mapAsync(ok(1), throws), (error) => error === exception);
  await assert.rejects(andThenAsync(ok(1), throws), (error) => error === exception);
  await assert.rejects(andThenAsync(Promise.reject(exception), ok),
    (error) => error === exception);
});
