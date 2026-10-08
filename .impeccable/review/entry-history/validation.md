# Entry-history validation record

2026-10-08, implementation commit 8330784.

| Command | Observed result |
| --- | --- |
| `PATH=/Users/jorgegonzalez/.local/share/mise/installs/node/24.21.0/bin:$PATH pnpm --silent --dir apps/mobile test` | Exit 0; exact configured wrapper output: `Todo OK` |
| `PATH=/Users/jorgegonzalez/.local/share/mise/installs/node/24.21.0/bin:$PATH pnpm --dir apps/mobile typecheck` | Exit 0; `tsc --noEmit` |
| `PATH=/Users/jorgegonzalez/.local/share/mise/installs/node/24.21.0/bin:$PATH pnpm --dir apps/mobile lint` | Exit 0; 0 errors, 3 existing warnings |
| `git diff --check` | Exit 0 |
| Impeccable embedded-prompt scan | `SCAN: 3 rasters, 0 missing` |

Lint warnings: two no-require-imports warnings in src/components/ui/option-selector.test.tsx lines9/10; import/first in src/features/printing/infrastructure/temporary-documents.test.ts line14. No unrelated source was changed to silence them.

The repository test wrapper deletes its temporary output file on exit; this record preserves the observed command/result, not a fabricated full Jest log. The final complete test run used the default timeout. Earlier runs under multi-agent contention hit the 5s timeout, and initial shared dependency resolution failed before setup. A focused run with CLI-only timeout60000 passed all15 home/access/history tests; this was superseded by the passing full configured run. No timeout override was committed. All later test execution requires coordinator authorization under the user's serial-test instruction.

Shared dependencies: frozen installation failed because shared/pnpm-lock.yaml contains multiple YAML documents. An ignored shared/node_modules symlink points to the coordinator-authorized main checkout, with zod4.6.5 and decimal.js10.6.0 versions verified. No lockfile/manifest changes.

Native evidence intentionally omitted after the user explicitly ended further phone/exhaustive QA on 2026-10-08. No claims of Android/iOS/tablet runtime visual verification; final review is limited to inspected mocks and the diff.
