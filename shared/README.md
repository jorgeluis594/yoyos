# Shared functional contracts

Core and mobile import types from `@shared/result` and functions from
`@shared/functional`. No runtime dependencies are required.

```ts
import { ok, err, andThen, map } from "@shared/functional";
import type { Result } from "@shared/result";

const positive = (value: number): Result<number> =>
  value > 0 ? ok(value) : err({ message: "Must be positive" });

const result = map(andThen(ok(4), positive), (value) => value * 2);
// { success: true, data: 8 }
```

| Function | Purpose |
| --- | --- |
| `ok(data)` / `err(error)` | Construct a success or failure; error codes are optional. |
| `map(result, transform)` | Transform successful data. |
| `mapError(result, transform)` | Transform only the error. |
| `andThen(result, next)` | Chain a step returning Result, preserving both error types. |
| `mapAsync(input, transform)` | Map with a sync or async callback. |
| `andThenAsync(input, next)` | Chain a sync or async Result step. |
| `sequence(results)` | Collect successful values or return the first failure. |
| `traverse(items, transform)` | Process items in order, stopping at the first failure. |

Async inputs may be Results or promises. Exceptions and promise rejections
propagate; adapters and boundary handlers translate them as described in
[Domain Conventions](../docs/domain.md#outcomes-and-functional-composition).
Collection helpers return success with `[]` for empty input. `sequence` cannot
cancel work already executed to create its input. Callbacks own their side effects.

Run `node --test shared/functional.test.mjs` from the repository root.
Run `pnpm exec tsc --noEmit` in each app to check the shared type contracts,
including error unions and `@shared` imports.
