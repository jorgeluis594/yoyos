# Worker briefs

Each spec is self-contained: the worker has no conversation history. Replace `<...>`. Write in English or Spanish, as the documents are written. Keep the common block identical across workers of a run.

## Common block (prepend to every spec)

```text
CONTEXT: Yoyos monorepo. Read AGENTS.md and follow it (happy-memory-recall before designing; happy-memory-maintainer before reporting when business rules or contracts change; database-migrations skill for schema changes; Implementation and Testing skills). Documents: docs/<topic>.md (product), docs/<topic>-technical.md (design, normative), docs/<topic>-tasks.md (tasks). Integration branch: jorgeluis594/<topic>.
CONSTRAINTS: Work only in your worktree and branch. Do only your task; sibling tasks run in parallel on other branches, so keep edits to shared files minimal and say which ones you touched. Do not merge, rebase, push, use git stash or open PRs. Do not edit AGENTS.md, skills or unrelated files. Do not commit generated artifacts (.impeccable/review/*.png, logs, Playwright output). Never delete Docker networks, volumes or containers; if Docker fails, report it with `ask`.
QUESTIONS: If the design is ambiguous or wrong, or you are blocked after two attempts, ask the coordinator with the `ask` command of your preamble instead of guessing.
TEST ISOLATION: Always export CORE_TEST_PORT=556N0 MAILPIT_SMTP_PORT=116N0 MAILPIT_UI_PORT=186N0 CORE_E2E_PORT=46N0 before tests. When finished run `docker compose -f compose.yaml --profile test down` from apps/core.
```

## Product writer

Use only CONTEXT and the first two sentences of CONSTRAINTS from the common block; this worker writes documents, not code.

```text
TASK: define <task, or Todoist task id> at the product level following the Product skill (.agents/skills/product/SKILL.md), and write docs/<topic>.md. Do not implement.
KNOWN CONTEXT: <three-line summary of what the task asks, what exists and what is out of scope>.
REPORT (worker_done): document path, the "Questions" block and the "Decided unless objected" list exactly as the skill delivers them. Do not ask the founder anything yourself; the coordinator relays the questions.
```

Later rounds: `ROUND <K>: address these observations from the coordinator: <numbered list>. Report as before.` Closing: `FOUNDER ANSWERS: <answers>. Close the document as in step 6 of the Product skill (skip Todoist; the coordinator updates it) and commit it. Report the commit.`

## Architecture writer

Same restrictions as the product writer.

```text
TASK: design docs/<topic>.md (closed product definition) following the Architecture skill (.agents/skills/architecture/SKILL.md), and write docs/<topic>-technical.md and docs/<topic>-tasks.md. Do not implement, create migrations or code files.
The tasks document must show the waves (which tasks run in parallel after which) and give each task scope, out of scope, acceptance criteria, test titles and dependencies.
REPORT (worker_done): both paths, the "Questions" block and the "Decided unless objected" list. Do not ask the founder anything yourself.
```

Rounds and closing as for the product writer, following step 6 of the Architecture skill.

## Implementer

```text
TASK: T<N> "<title>" of docs/<topic>-tasks.md. Read its Scope, Out of scope, Acceptance criteria, Tests and the design sections it references, and implement exactly that.
ALREADY MERGED IN YOUR BASE: <tasks and commits, or "nothing">.
RUNNING IN PARALLEL: <sibling tasks and the files they own>.
METHOD: write the listed tests first, then the code. Commit per logical unit (Implementation skill).
ACCEPTANCE: lint, typecheck and unit tests of every app you touched pass; integration tests pass when persistence or contracts changed; E2E when the task lists it.
REPORT (worker_done): branch, commits, each check command with its result, deviations from the design with the reason, known debt. Use --files-modified.
```

## Reviewer

```text
REVIEW-ONLY TASK for T<N> in this worktree (branch <topic>-tN). Validate, do not edit or commit.
Review `git diff jorgeluis594/<topic>...HEAD` against T<N> in docs/<topic>-tasks.md and the design:
(a) scope and every acceptance criterion; (b) correctness and failure cases; (c) security: company isolation, RLS, validation at boundaries; (d) declared deviations; (e) docs/programming-style.md and docs/architecture.md; (f) tests cover the listed titles and meaningful failures.
Run lint, typecheck and the task's tests yourself with your ports.
COORDINATOR NOTES — deviations declared by the implementer: <list>.
REPORT: write review-tN-rK.md with numbered findings (file:line, blocker or suggestion, and whether it is a design finding). worker_done --outcome succeeded with "APPROVED" when there are no blockers, otherwise --outcome failed with "REJECTED"; --report-path review-tN-rK.md.
```

## Fix round

```text
ROUND <K> for T<N>. Apply only these findings from review-tN-r<K-1>.md, verifying each against the current code first: <numbered list>. Do exactly this and nothing more.
<If the base moved:> First run `git merge jorgeluis594/<topic>`.
Then rerun: <exact commands>. REPORT as in the implementer task, per finding: fixed or why not.
```

## Final verifier

```text
VERIFY the integration branch jorgeluis594/<topic> in this worktree. Do not edit application code.
Run lint, typecheck and unit tests in core and mobile, `sh scripts/run-tests.sh integration` and `sh scripts/run-tests.sh e2e` in apps/core. Then walk every acceptance criterion of docs/<topic>.md (web and mobile) and say for each where it is satisfied or that it is missing.
REPORT: each command with its result, each criterion with its evidence, and the failures with file:line. --outcome failed if anything fails or is missing.
```

## CI fixer

```text
CI FAILED on PR #<n> (branch jorgeluis594/<topic>). Read `gh run view <run-id> --log-failed`, reproduce locally with your ports, fix the cause (not the test, unless the test is wrong, which you must justify), and commit. Do not push.
REPORT: cause, fix, commits and the commands that now pass.
```
