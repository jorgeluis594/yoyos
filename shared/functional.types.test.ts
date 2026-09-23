import { andThen, andThenAsync, err, map, ok, pipe, pipeAsync } from "@shared/functional";
import type { Result } from "@shared/result";

type Missing = { message: string; code: "MISSING" };
type Invalid = { message: string; field: string };

function checkTypes(input: Result<number, Missing>) {
  const next = (n: number): Result<string, Invalid> =>
    n > 0 ? ok(String(n)) : err({ message: "Invalid", field: "amount" });
  const combined: Result<string, Missing | Invalid> = andThen(input, next);
  const asyncCombined: Promise<Result<string, Missing | Invalid>> = andThenAsync(input, next);
  const piped: Result<boolean, Missing | Invalid> = pipe(input, next, (text) => ok(text.length > 0));
  const asyncPiped: Promise<Result<boolean, Missing | Invalid>> = pipeAsync(input, next, async (text) => ok(text.length > 0));
  // @ts-expect-error A pipeline preserves errors from every step.
  const lostPipeError: Result<boolean, Missing> = pipe(input, next, (text) => ok(text.length > 0));
  // @ts-expect-error Each step receives the previous success value.
  pipe(input, next, (value: number) => ok(value));
  // @ts-expect-error Composition must preserve errors from both steps.
  const lostError: Result<string, Missing> = andThen(input, next);
  // @ts-expect-error Mapping receives the actual success value type.
  map(input, (value: string) => value.length);
  // @ts-expect-error Error messages remain mandatory in constructors.
  err({ code: "MISSING" });
  return [combined, asyncCombined, piped, asyncPiped, lostError, lostPipeError];
}

void checkTypes;
