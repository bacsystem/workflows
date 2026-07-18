---
description: Parse an approved implementation plan and launch the parallel-plan-executor Workflow against a target repo
argument-hint: [plan-path] [repo-path] [integration-branch]
---

## What this command does

Runs the `parallel-plan-executor` Workflow against a `cys:plan` implementation plan,
executing its independent tasks in parallel instead of one at a time.

REPO = `${CLAUDE_PLUGIN_ROOT}`

<!--
  When this command runs as part of the cys plugin (/cys:run-plan), CLAUDE_PLUGIN_ROOT
  resolves to the installed plugin's directory — which IS the parallel-plan-executor
  repo, so the command is zero-config. If instead you copied this file by hand to
  ~/.claude/commands/ (standalone /run-plan), replace the value above with the absolute
  path of your clone (see README.md / README.es.md). Everything below refers to that
  path as REPO. If REPO cannot be resolved (the variable is empty and no path was
  substituted), ask the user for the clone's absolute path before continuing.
-->

## Steps

1. **Parse `$ARGUMENTS`** as up to three whitespace-separated tokens: `plan-path`,
   `repo-path`, `integration-branch`. Any of the three that's missing or ambiguous — ask
   the user for it in plain language before continuing. Do not guess a plan path, a
   target repo, or a branch name.

2. **Check for leftover state from an interrupted run**: check whether
   `<repo-path>/.cys/state.json` exists. If it does not, continue
   normally — step 4 below uses `bin/parse-plan.js` as usual.
   - If it exists, read it:
     - If its `planPath` matches `<plan-path>` exactly: tell the user
       which tasks are already `done`/`failed`/pending per the file, and
       ask whether to continue with only what's left (step 4 below then
       uses `bin/plan-remainder.js` instead of `bin/parse-plan.js`) or
       start fresh (delete `<repo-path>/.cys/state.json` first; step 4
       then uses `bin/parse-plan.js` as usual).
     - If its `planPath` does not match: warn the user there's
       incomplete state from a different, unrelated run and ask how to
       proceed (look at it first / delete it and continue / stop) —
       never decide silently.

3. **Sanity-check before running anything**:
   - Confirm `plan-path` exists and looks like an approved plan (has `### Task N:`
     blocks). If it looks like a spec instead of a plan, say so and stop.
   - Confirm `repo-path` is a git repo with a clean working tree (`git status`). If it's
     dirty, tell the user and stop — don't run against uncommitted work.
   - Confirm `integration-branch` is an ephemeral feature branch (e.g. `feature/<name>`),
     **not** `develop`/`main`/`master` directly. If the user asked for one of those
     directly, warn them (mainline should never take agent merges directly) and confirm
     they really want that before proceeding.

4. **Parse the plan**: if step 2 confirmed resuming a previous run, run
   `node REPO/bin/plan-remainder.js <plan-path> <repo-path>/.cys/state.json`
   instead of the command below. Otherwise, run
   `node bin/parse-plan.js <plan-path>` from `REPO`. Either way, capture
   stdout as JSON (`{ tasks, graph, warnings, allDone? }`). Show any
   warnings to the user — in particular a duplicate-producer warning or
   an empty graph is worth surfacing before launching, not after.
   - If `allDone` is `true` (only present when resuming): every task was
     already merged in the earlier run — nothing to implement, only the
     final whole-branch review and handoff never finished. Tell the user
     this, skip steps 5 and 7 below (no new merges, no new branch), and
     launch (step 8) with `finishOnly: true` and empty `tasks`/`graph`
     instead of what `plan-remainder.js` printed for those two fields.

5. **Ask what's still missing** (skip this step if `allDone` was `true`),
   in plain language, one question at a time:
   - Whether to push and open a PR at the end (`openPr`), and if so, the PR base branch
     (`pr.base`) and any optional fields (`assignees`, `labels`, `milestone`, `closes`).
   - **Their explicit merge authorization**, naming the branches (e.g. "I authorize
     merging task-1 through task-N"). Do not fabricate or assume this text on the user's
     behalf, and do not treat a bare "yes"/"go ahead" as sufficient — ask them to name
     the branches themselves. Pass their words verbatim as `args.mergeAuthorization`. If
     they decline to give one, proceed without it and mention that some merges may then
     need authorizing individually mid-run.

6. **Summarize before launching**: plan path, repo, task count, integration branch,
   openPr/PR settings, and confirm the authorization text with the user. This is a real
   run against their repo — don't skip the confirmation.

7. **Create the integration branch if it doesn't exist** (skip if `allDone`
   was `true` — the branch already has everything merged on it): run
   `git -C <repo-path> show-ref --verify --quiet
   refs/heads/<integration-branch>`. If it exits non-zero, create it from `develop`:
   `git -C <repo-path> branch --no-track <integration-branch> develop`. If
   it exits 0, the branch already exists — step 3's sanity check already
   covers its naming, nothing more to do here.
   `--no-track` matters: if the target repo has no local `develop` (only
   `origin/develop`), git resolves `develop` against the remote-tracking
   branch and, without `--no-track`, sets the new branch's upstream to
   `origin/develop` by default — a later `git push` with no explicit
   refspec from that branch would push straight to `develop`. Reported by
   a real user who hit exactly this.

8. **Launch**: invoke the `Workflow` tool with:
   - `scriptPath`: `<REPO>/workflows/parallel-plan-executor.js`
   - `args`: if `allDone` was `true`, `{ tasks: [], graph: {}, planPath, repoPath, integrationBranch, executorPath: <REPO>, finishOnly: true, openPr, pr }` (no `mergeAuthorization` — nothing merges in this mode). Otherwise,
     `{ tasks, graph, planPath, repoPath, integrationBranch, executorPath: <REPO>, openPr, pr, mergeAuthorization }`
     (executorPath is REPO — the workflow invokes REPO/bin scripts by exact path;
     omit `openPr`/`pr`/`mergeAuthorization` if not provided)

9. **After launching**: tell the user it's running in the background, mention they can
   ask "how's the workflow going?" any time or open `/workflows`, and that you'll report
   back when it finishes or if a merge needs authorization.

10. **Offer the manual retry guide** (skip entirely if `allDone` was
    `true` — the run finishes immediately, nothing to resume): ask one
    question, in plain language — whether they want the copy-paste text
    for a Claude Code Desktop Local Routine that resumes this run
    unattended if it gets cut short. On "no", stop here. On "yes", print
    this block, filling in this run's own already-known values (no new
    questions):

    ```
    Name: cys auto-retry — <plan or integration-branch slug>

    Instructions:
    Check whether <repo-path>/.cys/state.json exists. If it does not
    exist, do nothing and finish immediately.
    If it exists, resume the interrupted cys run: invoke
    /cys:run-plan <plan-path> <repo-path> <integration-branch>.
    When asked whether to open a PR, answer <this run's openPr/pr.base>.
    When asked for merge authorization, say you don't have one this time
    — let any merge pause for the user's own permission click.

    Suggested schedule: every 15 minutes
    Folder: <repo-path>
    ```

    Tell them where to paste it: Claude Code Desktop → Routines → New
    routine → Local (or describe the same thing conversationally to
    Claude in a Desktop session, which walks through the same form).
    Remind them to delete or disable the Routine once the run finishes
    or once they no longer need it — there is no way for it to clean
    itself up yet.

## Notes

- This command only *launches* the run — treat "how's it going" follow-ups as fresh
  requests to check `journal.jsonl` / `TaskOutput`, not something to pre-empt here.
- If `node bin/parse-plan.js` errors or the workflow's own startup validation rejects
  `args`, report the exact error — don't retry blindly or work around it silently.
