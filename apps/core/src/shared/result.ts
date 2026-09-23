/** Plain failure data. Supply a code only when consumers need to distinguish it. */
export type AppError = {
  readonly message: string;
  readonly code?: string;
};

export type Success<T> = {
  readonly success: true;
  readonly data: T;
};

export type Failure<E extends AppError = AppError> = {
  readonly success: false;
  readonly error: E;
};

/** Shared contract for fallible operations in core and mobile. */
export type Result<T, E extends AppError = AppError> = Success<T> | Failure<E>;
