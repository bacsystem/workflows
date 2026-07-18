---
description: Run the full cys flow end to end — take an idea for a target repo through cys:design and cys:plan, then launch the parallel-plan-executor Workflow. The all-in-one entry point; use /cys:run-plan instead when an approved plan already exists.
argument-hint: [repo-path] [idea...]
---

## What this command does

Takes an idea from zero to a running parallel execution: design spec →
implementation plan → parallel-plan-executor Workflow, with the user's
approval gates at every stage. Invoking /cys:flow IS the choice of
parallel execution — never offer sequential alternatives.

REPO = `${CLAUDE_PLUGIN_ROOT}`

<!--
  As a plugin command, CLAUDE_PLUGIN_ROOT resolves to the installed cys
  plugin's directory — which IS the parallel-plan-executor repo. If this
  file was copied by hand instead, replace the value with the clone's
  absolute path. If REPO cannot be resolved, ask the user for it before
  continuing.
-->

## Steps

1. **Parse `$ARGUMENTS`**: the first whitespace-separated token is
   `repo-path` (absolute path of the target repo); everything after it is
   the `idea`, free-form. Ask for whichever is missing — never guess.

2. **Sanity-check before designing anything**:
   - `repo-path` exists and is a git repo with a clean working tree
     (`git -C <repo-path> status`). If dirty, tell the user and stop —
     the design/plan stages create commits of their own.
   - If the repo has no `develop` branch, ask the user which branch the
     eventual PR should target before continuing.

3. **Check for leftover state from an interrupted run**: check whether
   `<repo-path>/.cys/state.json` exists. If it does not, continue
   normally. If it does, read it and tell the user its `planPath` and a
   one-line summary of each task's status, then ask how to proceed —
   never decide on your own:
   - **Handle that first**: stop here; tell them to use `/cys:run-plan`
     pointed at that `planPath` to resume it before starting a new idea.
   - **Ignore it and continue**: proceed with this new idea. Mention the
     leftover file will be overwritten once this run's first task settles.
   - **Delete it and continue**: delete
     `<repo-path>/.cys/state.json`, then proceed.

4. **Design**: invoke the `cys:design` skill, working against
   `repo-path` (explore ITS files, write the spec under ITS
   `docs/cys/specs/`), not against the session's cwd. The user approving
   the written spec is the gate — if they don't approve, stop; nothing
   launches.

5. **Plan**: invoke the `cys:plan` skill against the approved spec; the
   plan lands under `<repo-path>/docs/cys/plans/`. Commit spec and plan
   in `repo-path` per each skill's own instructions.

6. **Parse the plan**: run `node REPO/bin/parse-plan.js <plan-path>`,
   capturing stdout as JSON (`{ tasks, graph, warnings }`). Show any
   warnings to the user. If parsing errors or the graph is empty, report
   the exact error and stop — don't work around it silently. (This step
   always uses `bin/parse-plan.js`, never `bin/plan-remainder.js` — a
   plan freshly written by `cys:plan` is always a new file, so it can
   never match an older `state.json`'s `planPath`; resuming belongs to
   `/cys:run-plan`, not here.)

7. **Ask what's still missing**, one question at a time:
   - `integration-branch`: suggest `feature/<plan-slug>` created from
     `develop`. If the user names `develop`/`main`/`master` directly,
     warn (mainline should never take agent merges) and confirm.
   - Whether to push and open a PR at the end (`openPr`), and if so
     `pr.base` and optional fields (`assignees`, `labels`, `milestone`,
     `closes`).
   - **Their explicit merge authorization**, naming the branches (e.g.
     "I authorize merging task-1 through task-N into feature/x"). Never
     fabricate it; a bare "yes" is not enough — they name the branches.
     Pass their words verbatim as `args.mergeAuthorization`.

8. **Summarize and confirm**: plan path, repo, task count, parallelism
   the graph shows, integration branch, PR settings, authorization text.
   Re-check the working tree is still clean; if the integration branch
   already exists, ask whether to continue on it or pick another name.

9. **Create the integration branch if it doesn't exist**: run
   `git -C <repo-path> show-ref --verify --quiet
   refs/heads/<integration-branch>`. If it exits non-zero, create it from `develop`:
   `git -C <repo-path> branch <integration-branch> develop`. If
   it exits 0, the branch already exists — step 8 already handled
   confirming that with the user, nothing more to do here.

10. **Launch** the `Workflow` tool with:
   - `scriptPath`: `REPO/workflows/parallel-plan-executor.js`
   - `args`: `{ tasks, graph, planPath, repoPath, integrationBranch,
     executorPath: REPO, openPr, pr, mergeAuthorization }` (omit the
     optional ones not provided).

11. **After launching**: tell the user it runs in the background, that
   they can ask "how's the workflow going?" or open `/workflows`, and
   that merges may pause for their permission dialog — a click there is
   expected, not a failure.

## Notes

- The run's record lives under `<repo-path>/.cys/` (ledger, briefs,
  reports, review packages, handoff.md).
- If the workflow's startup validation rejects `args`, report the exact
  error verbatim.
