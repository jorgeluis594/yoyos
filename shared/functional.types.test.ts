import { andThen, andThenAsync, err, map, ok } from "@shared/functional";
import type { Result } from "@shared/result";

type Missing = { message: string; code: "MISSING" };
type Invalid = { message: string; field: string };

function checkTypes(input: Result<number, Missing>) {
  const next = (n: number): Result<string, Invalid> =>
    n > 0 ? ok(String(n)) : err({ message: "Invalid", field: "amount" });
  const combined: Result<string, Missing | Invalid> = andThen(input, next);
  const asyncCombined: Promise<Result<string, Missing | Invalid>> = andThenAsync(input, next);
  // @ts-expect-error Composition must preserve errors from both steps.
  const lostError: Result<string, Missing> = andThen(input, next);
  // @ts-expect-error Mapping receives the actual success value type.
  map(input, (value: string) => value.length);
  // @ts-expect-error Error messages remain mandatory in constructors.
  err({ code: "MISSING" });
  return [combined, asyncCombined, lostError];
}

void checkTypes;
