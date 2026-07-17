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

2. **Sanity-check before running anything**:
   - Confirm `plan-path` exists and looks like an approved plan (has `### Task N:`
     blocks). If it looks like a spec instead of a plan, say so and stop.
   - Confirm `repo-path` is a git repo with a clean working tree (`git status`). If it's
     dirty, tell the user and stop — don't run against uncommitted work.
   - Confirm `integration-branch` is an ephemeral feature branch (e.g. `feature/<name>`),
     **not** `develop`/`main`/`master` directly. If the user asked for one of those
     directly, warn them (mainline should never take agent merges directly) and confirm
     they really want that before proceeding.

3. **Parse the plan**: run `node bin/parse-plan.js <plan-path>` from `REPO`, capturing
   stdout as JSON (`{ tasks, graph, warnings }`). Show any warnings to the user — in
   particular a duplicate-producer warning or an empty graph is worth surfacing before
   launching, not after.

4. **Ask what's still missing**, in plain language, one question at a time:
   - Whether to push and open a PR at the end (`openPr`), and if so, the PR base branch
     (`pr.base`) and any optional fields (`assignees`, `labels`, `milestone`, `closes`).
   - **Their explicit merge authorization**, naming the branches (e.g. "I authorize
     merging task-1 through task-N"). Do not fabricate or assume this text on the user's
     behalf, and do not treat a bare "yes"/"go ahead" as sufficient — ask them to name
     the branches themselves. Pass their words verbatim as `args.mergeAuthorization`. If
     they decline to give one, proceed without it and mention that some merges may then
     need authorizing individually mid-run.

5. **Summarize before launching**: plan path, repo, task count, integration branch,
   openPr/PR settings, and confirm the authorization text with the user. This is a real
   run against their repo — don't skip the confirmation.

6. **Launch**: invoke the `Workflow` tool with:
   - `scriptPath`: `<REPO>/workflows/parallel-plan-executor.js`
   - `args`: `{ tasks, graph, planPath, repoPath, integrationBranch, executorPath: <REPO>, openPr, pr, mergeAuthorization }`
     (executorPath is REPO — the workflow invokes REPO/bin scripts by exact path;
     omit `openPr`/`pr`/`mergeAuthorization` if not provided)

7. **After launching**: tell the user it's running in the background, mention they can
   ask "how's the workflow going?" any time or open `/workflows`, and that you'll report
   back when it finishes or if a merge needs authorization.

## Notes

- This command only *launches* the run — treat "how's it going" follow-ups as fresh
  requests to check `journal.jsonl` / `TaskOutput`, not something to pre-empt here.
- If `node bin/parse-plan.js` errors or the workflow's own startup validation rejects
  `args`, report the exact error — don't retry blindly or work around it silently.
