import type { AppError, Failure, Result, Success } from "./result.js";

export const ok = <T>(data: T): Success<T> => ({ success: true, data });

export const err = <E extends AppError = never>(error: E): Failure<E> => ({
  success: false,
  error,
});

export function map<A, B, E extends AppError = never>(
  result: Result<A, E>,
  transform: (value: A) => B,
): Result<B, E> {
  return result.success ? ok(transform(result.data)) : result;
}

export function mapError<T, E extends AppError = never, F extends AppError = never>(
  result: Result<T, E>,
  transform: (error: E) => F,
): Result<T, F> {
  return result.success ? result : err(transform(result.error));
}

export function andThen<A, B, E extends AppError = never, F extends AppError = never>(
  result: Result<A, E>,
  next: (value: A) => Result<B, F>,
): Result<B, E | F> {
  return result.success ? next(result.data) : result;
}

export async function mapAsync<A, B, E extends AppError = never>(
  input: Result<A, E> | Promise<Result<A, E>>,
  transform: (value: A) => B | Promise<B>,
): Promise<Result<B, E>> {
  const result = await input;
  return result.success ? ok(await transform(result.data)) : result;
}

export async function andThenAsync<A, B, E extends AppError = never, F extends AppError = never>(
  input: Result<A, E> | Promise<Result<A, E>>,
  next: (value: A) => Result<B, F> | Promise<Result<B, F>>,
): Promise<Result<B, E | F>> {
  const result = await input;
  return result.success ? next(result.data) : result;
}

/** Collect values or return the first failure. Already evaluated work is not undone. */
export function sequence<T, E extends AppError = never>(
  results: readonly Result<T, E>[],
): Result<T[], E> {
  return traverse(results, (result) => result);
}

/** Evaluate in order and stop invoking transform at the first failure. */
export function traverse<A, B, E extends AppError = never>(
  items: readonly A[],
  transform: (value: A) => Result<B, E>,
): Result<B[], E> {
  const values: B[] = [];
  for (const item of items) {
    const result = transform(item);
    if (!result.success) return result;
    values.push(result.data);
  }
  return ok(values);
}
