# parallel-plan-executor

*[Leer esto en español](README.es.md)*

A Claude Code `Workflow` that executes a `superpowers:writing-plans` implementation
plan, running independent tasks in parallel via a dependency DAG inferred from each
task's `Consumes`/`Produces` block — instead of one task at a time like
`superpowers:subagent-driven-development` does by default.

The **generated code** is technology-agnostic — validated against both Node and
Java/Spring Boot projects, nothing in the design is tied to a specific language.

Design spec: `docs/superpowers/specs/2026-07-04-parallel-plan-executor-design.md`.

## What kind of thing is this? (plugin? skill? neither)

Neither. This repo is a **`Workflow` script** — a third kind of Claude Code extension,
different from plugins and skills:

- It is **not a plugin**: you don't install it through `/plugin` or a marketplace.
- It is **not a skill**: it doesn't live under `.claude/skills/` and isn't invoked
  through the Skill tool.
- It is a **script for Claude Code's `Workflow` tool**: you clone this repo anywhere on
  your machine, and Claude Code runs the script by absolute path
  (`scriptPath: <clone>/workflows/parallel-plan-executor.js`) when you ask it to.

The only piece of it that gets "installed" in the Claude Code sense is the optional
`/run-plan` slash command (a single `.md` file you copy — see below).

## Requirements

- **[Claude Code](https://claude.com/claude-code)**, with access to the `Workflow` tool.
  This is **not optional or swappable for another AI assistant**: the script in
  `workflows/parallel-plan-executor.js` is written against that tool's primitives
  (`agent()`, `pipeline()`, `parallel()`, etc.) — it isn't an open standard another
  assistant (ChatGPT, Gemini, etc.) can interpret. What *is* agnostic is the **target
  project** being automated: it can be Go, Node, Java, or whatever stack the plan
  describes.
- **The [superpowers](https://github.com/anthropics/claude-plugins) plugin, installed in
  Claude Code.** This is a hard dependency, not a nice-to-have: the workflow's
  implementer and reviewer agents run the `task-brief` and `review-package` scripts from
  superpowers' `subagent-driven-development` skill, follow its
  `test-driven-development` skill, and the final review uses its
  `requesting-code-review` template. The plans this workflow executes are also written
  with its `writing-plans` skill. Installing this repo does **not** install superpowers
  for you — do it first (see Installation, step 0).
- **Node.js >= 20** (for `bin/parse-plan.js` and the test suite — no runtime
  dependencies, just standard Node).
- Git, and a clean working tree in the project you're automating.
- `gh` (GitHub CLI) installed and authenticated, **only if** you'll use `openPr: true`
  (so the workflow can create the final PR).

## Installation

```bash
# 0. Inside Claude Code, install the superpowers plugin if you don't have it yet:
#    type /plugin, open the marketplace, and install "superpowers".
#    Verify: the skill listing should show superpowers:writing-plans,
#    superpowers:subagent-driven-development, etc.

# 1. Clone this repo (where the workflow lives) onto your machine.
#    WHERE: anywhere you like — your home folder, a tools directory, etc.
#    It does NOT need to be inside .claude/, and it does NOT need to live next to
#    the projects you'll automate; every path you pass it later is absolute.
git clone <this-repo-url> parallel-plan-executor
cd parallel-plan-executor

# 2. Check your Node version (must be >= 20)
node --version

# 3. Install (no runtime dependencies; this just wires up the npm scripts)
npm install

# 4. Run the test suite to confirm everything works in your environment
npm test

# 5. Build the workflow artifact (regenerates workflows/parallel-plan-executor.js
#    from the template — also re-run this after any change under src/)
npm run build
```

That's it — the workflow is invoked **from a Claude Code session**, no need to publish
it to npm or install it globally. See Usage below. Before your first real run, also do
the one-time **permissions setup** below so task merges don't get blocked mid-run.

## One-time permissions setup (merges)

The workflow's merge agents run `git merge` inside your target repo. Claude Code treats
an agent merging code as a sensitive action, and what happens depends on your
permission mode:

- **Default (normal) mode**: nothing to configure. The first time a merge agent runs
  `git merge`, you get Claude Code's native permission dialog — **Allow once / Allow
  always / Deny**. Pick "Allow always" on the first one and the rest of the run flows
  without asking again.
- **Auto mode**: there is no dialog by default — an automatic classifier decides alone,
  and it may block agent merges even when you authorized the run up front (see the
  permissions note further down for why). To get the same yes/no dialog as normal mode,
  add an **`ask` rule** to the **target project's** `.claude/settings.json` (create the
  file if needed):

```json
{
  "permissions": {
    "ask": [
      "Bash(git merge:*)",
      "Bash(git -C * merge *)"
    ]
  }
}
```

With that rule in place, every `git merge` from any agent pauses and asks **you**,
deterministically, regardless of mode — you just click, never type. If you'd rather
never be asked, use `"allow"` instead of `"ask"` (the run becomes fully hands-off; the
human gate moves to the final PR review).

## How it works

1. `bin/parse-plan.js` reads a plan file and computes its task list + dependency graph
   (pure Node, fully unit tested — see `tests/`).
2. `workflows/parallel-plan-executor.js` (built from `workflows/parallel-plan-executor.template.js`
   via `npm run build`) takes that graph and runs each task in its own git worktree via
   `agent()`, starting a task the moment its specific dependencies finish rather than
   waiting for a whole batch.
3. Each task gets an adversarial review agent instead of a human checkpoint per task,
   since a `Workflow` can't pause mid-run to ask you anything.
4. Merges happen one at a time, serialized, respecting the dependency order.
5. You get a single report at the end, and — if at least one task merged — a **Handoff**
   agent prepares the git-flow closing for you (see below).

## Step-by-step guide (first time using this)

This section is for anyone who hasn't run the workflow before and wants to go through
it without getting lost. If you already know it, the "Usage" section below is the quick
reference.

### Step 0 — What you need ready before starting

- **An approved implementation plan**, with numbered tasks and their
  `Consumes`/`Produces` blocks (the format produced by the `superpowers:writing-plans`
  skill). If you don't have one yet, ask Claude Code, from your project's repo: *"help
  me write an implementation plan for [your feature]"* — that runs the matching skill
  and leaves the plan file ready.
- **The repo you're automating**, with a clean working tree (`git status` shows no
  pending changes) and, if you'll request `openPr: true` at the end, a GitHub remote
  already configured with `gh auth status` green.
- This repo (`parallel-plan-executor`) cloned and installed — see Installation above.
  It doesn't need to live in the same folder as your project: the paths you pass it are
  always absolute.

### Step 1 — Open a Claude Code session

It can be in your project's folder, in this repo's folder, or anywhere else — the
workflow doesn't depend on where your Claude Code session is running, as long as you
give it absolute paths to the plan and the target repo.

### Step 2 — Ask Claude Code in plain language

**You don't need to hand-write the `args` JSON.** That's Claude Code's job: you just
tell it what you want in a sentence, with these pieces of information:

- the path to your plan (`planPath`),
- the path to your target project (`repoPath`),
- the name of the integration branch (`integrationBranch`) — an ephemeral feature branch
  cut from `develop`, **never** `develop`/`main` directly (see the recommended topology
  below),
- whether you want it to push and open the PR at the end (`openPr`) and against which
  branch (`pr.base`),
- **your explicit authorization for the merges**, naming the branches — this matters,
  see the box below.

Real example (similar to what was used while building this very fix):

> "Launch the parallel-plan-executor workflow on my project at `D:/my-project`. The plan
> is at `docs/plans/2026-07-16-my-feature.md`, already approved. Integration branch:
> `feature/my-feature`. At the end, push and create the PR against `develop`. I
> authorize merging branches task-1 through task-6."

Claude Code takes care of running `bin/parse-plan.js` on your plan, building the `args`,
and invoking the `Workflow` tool with this repo's script — you never touch JSON directly.

> **Why name the branches in your authorization?** If the environment has Claude Code's
> permission classifier in auto mode, it may require a human to explicitly authorize
> merges — and that authorization needs to name the concrete action ("merge task-1
> through task-6"), not a plain "yes" or "go ahead". Saying it upfront, with branches
> named, avoids the run getting stuck partway through. See the permissions note below
> for the technical detail.

### Step 3 — What you'll see while it runs

The workflow runs in the background — it doesn't wait for your reply. You'll see:

- A text progress bar like `[####----] 2/6 tasks settled` every time a task finishes
  (merged, failed, or skipped).
- A `Task N: started (implement)` notice as soon as each task starts, so you know it
  isn't stuck during the minutes implementation takes.

You can ask Claude Code *"how's the workflow going?"* at any point — it will check the
real state and tell you which tasks finished, which are in progress, and whether
anything went wrong. You can also open Claude Code's `/workflows` panel to see the
per-phase detail (Implement, Review, Merge, Final review, Handoff), how many agents and
tokens each phase used, and each agent's timing.

### Step 4 — If something gets stuck

The most common snag is a merge getting marked as blocked out of caution, **even after
you authorized upfront** — that's an environment safety measure, not a flaw in your
plan. If that happens:

1. Ask Claude Code what happened — it should be able to explain the concrete cause.
2. Repeat your authorization naming the specific branches still pending ("I authorize
   merging task-2 and task-3") and ask it to retry.
3. The run is recoverable: nothing already done is lost. Tasks that already finished
   (implemented, reviewed, merged) don't re-run — only what's still pending retries.

### Step 5 — When it finishes

- If **at least one task merged**, you'll have a `.superpowers/sdd/handoff.md` file in
  your project with: the suggested PR title and body, the proposed SemVer bump, and a
  cleanup checklist (which `task-N` branches to delete and when).
- If you requested `openPr: true`, the PR is **already created** in GitHub against the
  branch you specified — review it yourself and merge it whenever you're satisfied. The
  workflow never merges the PR on its own; that decision always stays in your hands.
- If any task failed or got blocked, the final report will tell you exactly which one
  and why — and which other tasks were skipped in cascade because they depended on it.

### Common errors

| What you see | What it means |
|---|---|
| `args.tasks must be a non-empty array` | The plan has no parseable tasks, or the plan wasn't parsed correctly. Check that your plan has `### Task N:` blocks with `Consumes`/`Produces`. |
| A merge comes back `CONFLICT` with no real git conflict | Almost always the permission classifier asking for explicit authorization — see Step 4. |
| The run stops partway through | It's recoverable: Claude Code can resume it without losing the work already done. |
| The agent takes several minutes "doing nothing" when the first task starts | Normal — the first `implement` includes setting up the project's environment; you'll see the progress notice as soon as it's done. |

## Usage

```bash
# 1. Compute the task graph for your plan
#    (stdout is pure JSON; ambiguity warnings — e.g. two tasks producing the same
#    symbol — go to stderr and are also included in the JSON's "warnings" field)
node bin/parse-plan.js /path/to/your-plan.md > /tmp/plan-graph.json

# 2. Ask Claude Code to invoke the Workflow tool with:
#    scriptPath: "<this repo>/workflows/parallel-plan-executor.js"
#    args: { tasks: <the "tasks" field of plan-graph.json>,
#            graph: <the "graph" field of plan-graph.json>,
#            planPath: "/path/to/your-plan.md",
#            repoPath: "/path/to/your/project",
#            integrationBranch: "feature/my-plan",  # the branch every task merges into (required)
#            openPr: true,                          # optional: push + open the PR at the end
#            pr: { base: "develop", assignees: ["me"], labels: ["story"],
#                  milestone: "v1.2", closes: 42 },  # optional PR fields (git-flow contract)
#            mergeAuthorization: "I authorize merging task-1 through task-N into <branch>"
#            }  # optional but recommended: your explicit authorization, so the merge
#               # agent doesn't have to guess whether consent was already given (see the
#               # permissions note below)
```

## Optional: the `/run-plan` slash command

If you'd rather not type out the natural-language request from the step-by-step guide
every time, this repo ships a Claude Code custom slash command that wraps it:
`commands/run-plan.md`.

### Installing it

1. Copy `commands/run-plan.md` from this repo to either:
   - `~/.claude/commands/run-plan.md` — available in **every** project on your machine, or
   - `<your-project>/.claude/commands/run-plan.md` — available only inside that one project.

   Global (`~/.claude/commands/`) is the right choice for most people, since this tool is
   meant to be invoked against other projects, not just the one it happens to live in.

2. Open the copied file and replace the `REPO = ...` placeholder near the top with the
   absolute path where you cloned **this** repo (`parallel-plan-executor`), e.g.
   `REPO = /home/you/parallel-plan-executor`. This is the one thing you must edit — the
   command has no other way to find the workflow script.

3. That's it — no restart needed. Claude Code picks up commands under `.claude/commands/`
   the next time you use them.

### Using it

```
/run-plan /path/to/your-plan.md /path/to/your/project feature/my-plan
```

All three arguments are optional to type up front — the command will ask you for
anything you leave out, plus whatever `Usage` above lists as optional (`openPr`, `pr`
fields, your merge authorization). It never invents your authorization text on your
behalf; it always asks you to name the branches yourself.

## Handoff phase (v0.5.0)

When at least one task merged, a final **handoff agent** prepares the git-flow closing
for you — without executing it. It writes `.superpowers/sdd/handoff.md` in the target
repo with: a suggested Conventional-Commit PR title, a full PR body (Summary / Type of
change / Main changes / Version / Checklist), the proposed SemVer bump derived from the
run's commits (git-flow rules, `0.x` included), the final review verdict, and a post-run
cleanup checklist.

With **`openPr: true`** (explicit consent given at launch) it additionally pushes the
integration branch and **creates** the pull request via `gh` against `pr.base` (default
`develop`), applying the optional `pr` fields — assignees, labels, milestone, and
`Closes #<closes>` in the body. **It never merges the PR**: that gate is human, always.

## Recommended branching topology (validated in pilot 4)

Point `integrationBranch` at an **ephemeral feature branch cut from `develop`** — never
at `develop`/`main` directly:

```
master (release)                 ← never touched by agents
  └── develop (integration)     ← never touched by agents
        └── feature/<plan>      ← integrationBranch: task branches merge here ★
              ├── task-1        ← one isolated worktree per implementer
              └── task-N
```

Why: mainline stays protected by construction (agent-written code never lands on a
shared branch without human review), a failed run costs one `git branch -D`, and the
human gate sits exactly where it belongs — the single `feature/<plan> → develop` PR you
open via `git-flow` after reviewing the finished branch.

**Permissions note (read this if a merge gets blocked)**: under Claude Code's auto
mode, an automatic classifier judges each agent action on its own, and agent-performed
`git merge` is exactly the pattern it watches for. Passing your authorization text via
`args.mergeAuthorization` helps the *merge agent itself* not self-block out of caution
(finding F8 in `docs/pilots/2026-07-15-pilot-stats-bitacora.md`) — but it does **not**
bind the classifier: in a later real run the classifier explicitly rejected that relayed
text as "self-asserted, unverifiable" consent and blocked the merge anyway. The
deterministic fix is the **one-time permissions setup** near the top of this README: an
`ask` (or `allow`) rule for `git merge` in the target project's `.claude/settings.json`,
added by you. Rules take precedence over the mode — with the rule in place you get a
plain yes/no dialog (or silent allow) instead of a classifier judgment call.

## Safety checks (v0.2)

- **Startup validation**: the workflow validates `args` before launching any agent —
  a cyclic graph or an id present in `graph` but missing from `tasks` fails fast with a
  clear error instead of deadlocking `runDag` silently.
- **Same-file chaining**: tasks touching the same file are serialized as a chain (each
  depends on the *last* task to touch it), so they never run in parallel against each
  other.
- **Duplicate-producer warnings**: two tasks declaring the same `Produces` symbol is
  surfaced as a warning (first producer still wins); it does not abort the run.
- **Skip reasons point at the root cause**: a task skipped through a cascade reports the
  task that originally failed, not the intermediate skipped link.

## Known limitations (v1)

- Only backtick-quoted symbols count in `Consumes`/`Produces` (e.g.
  `` - Produces: the `createWidget()` factory `` produces `createWidget`). Bare prose is
  ignored on purpose: extracting every identifier turned words like "the" or "None" into
  symbols and created spurious dependencies — even false cycles — between unrelated tasks.
  `Consumes: None` is therefore simply an empty list.
- The `Consumes`/`Produces` parser reads one line at a time — a value that wraps onto a
  second line in the plan's prose won't be captured. A missed dependency does **not**
  silently misorder tasks: the task starts without its real dependency in place, so it
  either fails loudly (or self-reports `BLOCKED`) and its transitive dependents are
  skipped, all surfaced in the final report. A retry-later mechanism (re-attempt once more
  of the DAG has closed) was evaluated and deferred — see design spec §7 — so today the
  only mitigation is keeping `Consumes`/`Produces` on one line per entry.
- No speculative re-execution of an abnormally slow task (evaluated and deferred, see
  design spec §7) — right-sizing tasks in the plan itself is the current mitigation.
- `task-<id>` branches of failed or BLOCKED tasks survive the run on purpose: they
  preserve whatever partial state exists for diagnosis. Clean them up afterwards with
  `git branch -D task-<id>` once you no longer need them.
