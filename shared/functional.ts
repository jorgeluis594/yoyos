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

/** Chain Result-returning steps, stopping at the first failure. */
export function pipe<A, E extends AppError>(initial: Result<A, E>): Result<A, E>;
export function pipe<A, B, E extends AppError, F extends AppError>(
  initial: Result<A, E>, first: (value: A) => Result<B, F>,
): Result<B, E | F>;
export function pipe<A, B, C, E extends AppError, F extends AppError, G extends AppError>(
  initial: Result<A, E>, first: (value: A) => Result<B, F>,
  second: (value: B) => Result<C, G>,
): Result<C, E | F | G>;
export function pipe<A, B, C, D, E extends AppError, F extends AppError, G extends AppError, H extends AppError>(
  initial: Result<A, E>, first: (value: A) => Result<B, F>,
  second: (value: B) => Result<C, G>, third: (value: C) => Result<D, H>,
): Result<D, E | F | G | H>;
export function pipe(
  initial: Result<unknown, AppError>,
  ...steps: Array<(value: never) => Result<unknown, AppError>>
): Result<unknown, AppError> {
  let result = initial;
  for (const step of steps) {
    if (!result.success) return result;
    result = step(result.data as never);
  }
  return result;
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

/** Chain synchronous or asynchronous Result steps, stopping at the first failure. */
export function pipeAsync<A, E extends AppError>(initial: Result<A, E> | Promise<Result<A, E>>): Promise<Result<A, E>>;
export function pipeAsync<A, B, E extends AppError, F extends AppError>(
  initial: Result<A, E> | Promise<Result<A, E>>,
  first: (value: A) => Result<B, F> | Promise<Result<B, F>>,
): Promise<Result<B, E | F>>;
export function pipeAsync<A, B, C, E extends AppError, F extends AppError, G extends AppError>(
  initial: Result<A, E> | Promise<Result<A, E>>,
  first: (value: A) => Result<B, F> | Promise<Result<B, F>>,
  second: (value: B) => Result<C, G> | Promise<Result<C, G>>,
): Promise<Result<C, E | F | G>>;
export function pipeAsync<A, B, C, D, E extends AppError, F extends AppError, G extends AppError, H extends AppError>(
  initial: Result<A, E> | Promise<Result<A, E>>,
  first: (value: A) => Result<B, F> | Promise<Result<B, F>>,
  second: (value: B) => Result<C, G> | Promise<Result<C, G>>,
  third: (value: C) => Result<D, H> | Promise<Result<D, H>>,
): Promise<Result<D, E | F | G | H>>;
export async function pipeAsync(
  initial: Result<unknown, AppError> | Promise<Result<unknown, AppError>>,
  ...steps: Array<(value: never) => Result<unknown, AppError> | Promise<Result<unknown, AppError>>>
): Promise<Result<unknown, AppError>> {
  let result = await initial;
  for (const step of steps) {
    if (!result.success) return result;
    result = await step(result.data as never);
  }
  return result;
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
