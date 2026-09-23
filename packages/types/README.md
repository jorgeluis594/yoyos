# @yoyos/types

Shared, framework-independent type contracts for core and mobile. This package
contains declarations only: no runtime dependencies, helpers, or build step.
Both apps consume it through a local `file:../../packages/types` dependency.

```ts
import type { Result } from "@yoyos/types";

const saved: Result<{ id: string }> = { success: true, data: { id: "1" } };
const failed: Result<never> = {
  success: false,
  error: { message: "Could not save the product" },
};
```

Exports: `AppError`, `Success<T>`, `Failure<E>`, and `Result<T, E>`.
`error.message` is required; `error.code` is optional. Features may specialize
the error type with codes and additional plain data when their consumers need it.
The envelope is readonly; payload immutability is the responsibility of its type.

Follow [Domain Conventions](../../docs/domain.md#outcomes-and-functional-composition)
for programming rules, composition, absence, and error handling. Keep feature
entities in their owning feature; this package is for shared contracts.

Run `pnpm install` and `pnpm typecheck` in this directory to verify the contract,
including narrowing, uncoded failures, typed errors, and rejected invalid shapes.
Static types do not validate incoming JSON.
