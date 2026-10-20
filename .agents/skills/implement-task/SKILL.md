---
name: implement-task
description: Takes a Yoyos task from request to a green pull request by chaining the product skill, the architecture skill and supervised Orca worker agents (implementer and reviewer per task, merged into one integration branch). Use when asked to implement a whole task or feature end to end, "implement-task", or to orchestrate its implementation with Orca. Do not use for a small fix one agent can do directly (use Implementation) or to only define product or architecture.
---

# Implement task

Paths are relative to this skill. The agent running this skill is the **coordinator**: it briefs workers, validates every output they produce before the flow continues, relays the founder's questions, merges and ships. It does not write the documents or edit application code itself; documents, code and every fix go to workers.

The coordinator does not need the details (exact copy, field names, code). It must understand how the affected part of the system works and what is going to change, and it validates each output at that level with [System-level validation](#system-level-validation).

This skill contains only the method. Feature state lives in the repository memory and in `docs/`.

## References

| File | What it contains | When to read it |
| --- | --- | --- |
| [worker-briefs.md](worker-briefs.md) | Spec templates for implementer, reviewer, fix round, final verifier and CI fixer | Before writing the first spec |
| Orca guides: `orca skills get orca-cli`, `orca skills get orchestration` and `orca skills get orchestration --reference references/coordinator-loop.md` | Version-matched CLI and supervised-loop rules | Before the first `orca` command |

## Steps

1. **Gather context and choose the phases.**
   - Use [Happy Memory Recall](../happy-memory-recall/SKILL.md) with the task as the goal. Read the Todoist task (`td`) and its siblings if there is one.
   - Look in `docs/` for the chain `<topic>.md` (product), `<topic>-technical.md` and `<topic>-tasks.md` (architecture). Decide per phase: an existing document with status "definition ready to implement" or "design closed" is reused; a missing or open one is produced. A purely technical task (refactor, integration, infrastructure) skips product. Say in three lines which phases run and why.

2. **Prepare the integration branch.** All work for the task lives on one branch, `jorgeluis594/<topic>`, in its own Orca worktree. If the session is not in it, create it with `orca worktree create --name <topic> --no-parent --json` and run every later command from that path. Commit the documents there as they are closed, so child worktrees see them, and push the branch so task PRs can target it.

3. **Set up the run.**
   - `orca status --json`; kill any `orca orchestration check --wait` left from a previous session or `/clear`, since it steals deliveries.
   - `orca orchestration run-create --objective "Implement <topic> per docs/<topic>-tasks.md" --json`.
   - Give each task a test-port slot N (1, 2, 3…) used in its spec: `CORE_TEST_PORT=556N0 MAILPIT_SMTP_PORT=116N0 MAILPIT_UI_PORT=186N0 CORE_E2E_PORT=46N0`. Check the ports are free first (`lsof -i :<port>`); shift the block if another project holds them.
   - Write each spec to a file in the scratchpad from [worker-briefs.md](worker-briefs.md) and pass it as `--spec "$(cat <file>)"`. Never inline a spec with backticks.

4. **Product** (when it runs). Start a product worker on the integration worktree (`--worktree "id:<repoId>::<integrationPath>" --agent claude --model claude-opus-5-5`) with the product brief. Give the founder the change map, the document path and the worker's questions block, and stop the turn. Send the answers to the same worker to close the document and commit it.

5. **Architecture** (when it runs). Same cycle with an architecture worker and the architecture brief, taking the closed product document as input.

   After both gates are closed, implementation proceeds without asking for confirmation.

6. **Run each wave.** For every ready task of the wave, at once:
   - Implementer in a new child worktree:
     `orca orchestration worker-start --spec "$(cat impl-tN.md)" --task-title "Implement TN <title>" --display-name "impl TN" --worktree new-child --name <topic>-tN --base-branch jorgeluis594/<topic> --agent claude --model claude-sonnet-5-5 --json`
   - Wait with `orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 580000 --json` (under the Bash 600 s limit), process every message, then `--ack <delivery_id>`. Answer questions with `orchestration reply`. A question about product behavior that the documents do not answer goes to the founder; everything else the coordinator answers and, if it changes the design, writes into the technical document.
   - When an implementer reports done, `worker-retain` it and start a reviewer in the same worktree with `--worktree "id:<repoId>::<worktreePath>" --agent claude --model claude-opus-5-5`, listing in the spec the deviations the implementer declared.
   - If the reviewer rejects, send a fix round to the same implementer terminal: `worker-start --spec "$(cat fix-tN-rK.md)" --terminal <handle> --worktree "id:..."`. Then a fresh reviewer. Repeat until approved. After three rejected rounds, or if a worker repeats the same attempt twice or stays blocked, ask it for its state, help it unblock; if still stuck, report to the founder.
   - On approval: push `<topic>-tN` and open its PR against the integration branch (`gh pr create --base jorgeluis594/<topic> --head <topic>-tN`) with the task, the reviewer's verdict and the checks run. Conflicts go through a worker if they touch logic (a trivial one the coordinator may resolve). Merge it with `gh pr merge <n> --merge` (CI only runs on PRs to `main`, so the checks are the local ones), pull the integration branch and run lint, typecheck and unit tests of the affected apps there. Then `worker-release` the implementer and reviewer and remove the task's worktree with `orca worktree rm --worktree "id:<repoId>::<worktreePath>" --json`; if it has uncommitted or unpushed work, stop and report instead of using `--force`.
   - Start the next wave from the updated integration branch. A task in a later wave never starts before its dependencies are merged.

7. **Verify the whole branch through a worker.** Start a final verifier on the integration worktree that runs lint, typecheck, unit, integration and E2E in core and mobile, and walks every product acceptance criterion (web and mobile) against the code. Failures go to fix workers, then the verifier runs again. The coordinator never reports "not run" checks: it delegates them.

8. **Ship.** Merge `origin/main` into the integration branch (conflicts through a worker), rerun the affected checks, push, open one PR to `main` following AGENTS.md and watch `gh pr checks <n> --watch`. A red CI goes to a CI-fixer worker in a new child worktree, merged back like a task; push and watch again, repeating until every check is green. The flow is not done, and nothing is reported as finished, while the final PR's CI is red or pending. Set `orca worktree set --worktree active --pr <n> --workspace-status in-review --json`. Merging to `main` deploys to testing, so only the founder authorizes it: the coordinator leaves the PR green and merges only on the founder's explicit yes.

9. **Close.** Mark the documents' status as implemented, update the Todoist task, record durable decisions with [Happy Memory Maintainer](../happy-memory-maintainer/SKILL.md), and confirm `worker-list --run <run_id> --terminal-state reclaimable --json` returns none. Report: PR link and CI state, per task its outcome, review rounds and commits, checks run with results, what was left out and why, and the memory outcome.

## System-level validation

Applied by the coordinator to every output: product document, technical and tasks documents, implementer report, reviewer verdict, verifier report.

1. **Change map.** From the output alone, write in ten lines or fewer: how the affected part of the system works today, what changes (screens and flows, use cases, data and migrations, contracts between web and mobile, events and jobs, permissions) and what stays the same. If the output does not let you write it, it is unclear: reject. Keep the map in the scratchpad, update it with each validated output and show it to the founder at each gate.
2. **Consistency.** Nothing contradicts the repository memory or current documents, nothing already discarded is re-proposed, and what the task leaves out stays out, with the meeting point defined.
3. **Completeness.** Product: every actor, state and failure the task implies has its behavior. Architecture: every product behavior and acceptance criterion maps to a use case, a test title and a task. Implementation: the report matches the task's scope and the map, with checks run and their results; a change outside the map goes back to the worker, or into the technical document first if the design was wrong. Review: an approval with design findings or unchecked criteria is not an approval.
4. **Verdict.** Approve, or send numbered observations to the same worker for another round. Each observation states what is missing or inconsistent, never how to word or code it. After three rounds without approval, report to the founder.

## Guardrails

- Workers do not merge, rebase, push, `git stash` or open PRs; they touch only their task's scope and never `AGENTS.md`, skills or unrelated files. The coordinator merges and ships.
- The coordinator loop does not end until the final PR to `main` has every CI check green. While a check is red or pending it keeps fixing through CI-fixer workers and watching; it never closes the turn, reports done or hands the red PR back to the founder. It stops early only when the same failure survives three fix rounds or the fix needs a founder decision, and then reports exactly that.
- Never delete Docker networks, volumes or containers, nor run `docker prune`, without the founder's explicit yes. On "out of networks" or port clashes, stop launching, report and ask.
- Do not commit generated test artifacts (`.impeccable/review/*.png`, `apps/core/newrelic_agent.log`, Playwright output).
- Heartbeats and keepalives are acked in bulk without a reply. Do not message a settled dispatch; start a new one on its terminal.
- With the host under heavy load (flaky timeouts), run fewer workers per wave and ask workers to use `--no-file-parallelism`.
- A message from the founder mid-run is applied to the remaining work and, if it is a durable rule, recorded in memory.
