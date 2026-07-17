# cys F2 — Plugin and Skills Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the cys plugin: installable manifest + self-hosted marketplace, the five skills (`ship` migrated from the author's git-flow skill; `design`, `plan`, `check`, `guide` written from scratch), and updated docs.

**Architecture:** The repo root doubles as the plugin root (verified against the official plugin docs): `.claude-plugin/plugin.json` names the plugin `cys` so skills under `skills/<name>/SKILL.md` are invoked as `cys:<name>`; `.claude-plugin/marketplace.json` self-hosts the marketplace with `source: "./"`. A structure test guards every SKILL.md's frontmatter.

**Tech Stack:** JSON manifests, Markdown skills, Node >= 20 for the structure test (`node --test`, zero dependencies).

## Global Constraints

- Node >= 20, `"type": "module"`, zero runtime dependencies.
- All tests must pass: `npm test`.
- Commit messages follow Conventional Commits, in English.
- **Skills are written in English** (decision §10 of `docs/cys/specs/2026-07-16-cys-ecosystem-design.md`); READMEs are bilingual EN/ES.
- Skill/plugin names are kebab-case. The plugin is named exactly `cys`.
- JSON paths always use forward slashes.
- Do not chain shell commands with `&&`; one atomic command per invocation. Use `git -C <path>` instead of `cd`.
- The author's existing git-flow skill (source for Task 2) lives at `C:/Users/dbaci/.claude/skills/git-flow/`.

---

### Task 1: Plugin skeleton — manifests and structure test

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Test: `tests/skills.test.js`

**Interfaces:**
- Consumes: None
- Produces: `.claude-plugin/plugin.json` — plugin manifest, name `cys`.
- Produces: `.claude-plugin/marketplace.json` — self-hosted marketplace, source `./`.
- Produces: `tests/skills.test.js` — validates every existing `skills/*/SKILL.md` frontmatter plus both manifests.

- [ ] **Step 1: Write the failing test**

Create `tests/skills.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = path.join(root, 'skills');

// Frontmatter YAML mínimo: bloque --- ... --- con name: y description: no vacíos.
function parseFrontmatter(markdown) {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z-]+):\s*(.+)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

test('plugin.json declara el plugin cys con los campos mínimos', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'cys');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.description && manifest.description.length > 0);
});

test('marketplace.json se autohospeda apuntando a la raíz del repo', () => {
  const market = JSON.parse(readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.equal(market.name, 'bacsystem');
  assert.ok(Array.isArray(market.plugins) && market.plugins.length === 1);
  assert.equal(market.plugins[0].name, 'cys');
  assert.equal(market.plugins[0].source, './');
});

test('cada skill existente tiene SKILL.md con frontmatter name/description válidos', () => {
  if (!existsSync(skillsDir)) return; // aún sin skills: las tareas 2-6 las agregan
  for (const dir of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const skillFile = path.join(skillsDir, dir.name, 'SKILL.md');
    assert.ok(existsSync(skillFile), `skills/${dir.name} necesita un SKILL.md`);
    const fm = parseFrontmatter(readFileSync(skillFile, 'utf8'));
    assert.ok(fm, `skills/${dir.name}/SKILL.md necesita frontmatter ---`);
    assert.equal(fm.name, dir.name, 'el name del frontmatter debe coincidir con el directorio');
    assert.ok(fm.description && fm.description.length >= 20, 'la description guía la invocación: no puede ser vacía ni trivial');
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/skills.test.js`
Expected: FAIL — `.claude-plugin/plugin.json` does not exist (ENOENT).

- [ ] **Step 3: Create the manifests**

Create `.claude-plugin/plugin.json`:

```json
{
  "name": "cys",
  "displayName": "cys",
  "version": "0.6.1",
  "description": "Development methodology skills with parallel plan execution: design, plan, run, check, ship. Named after the author's twin daughters, Cielo y Sophia.",
  "author": { "name": "bacsystem" },
  "repository": "https://github.com/bacsystem/parallel-plan-executor",
  "license": "MIT",
  "keywords": ["workflow", "parallel", "plan-execution", "methodology"]
}
```

Create `.claude-plugin/marketplace.json`:

```json
{
  "name": "bacsystem",
  "owner": { "name": "bacsystem" },
  "plugins": [
    {
      "name": "cys",
      "source": "./",
      "description": "Development methodology skills with parallel plan execution: design, plan, run, check, ship."
    }
  ]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/skills.test.js`
Expected: PASS (3 tests; the skills loop is vacuous until other tasks land).

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json tests/skills.test.js
```

```bash
git commit -m "feat(cys): plugin manifest, self-hosted marketplace and skills structure test"
```

---

### Task 2: `cys:ship` — migrate the author's git-flow skill

**Files:**
- Create: `skills/ship/SKILL.md`
- Create: `skills/ship/references/pr-template.md`
- Create: `skills/ship/references/verify-commands.md`
- Create: `skills/ship/scripts/next-version.sh`
- Create: `skills/ship/scripts/test-next-version.sh`

**Interfaces:**
- Consumes: None
- Produces: `skills/ship/SKILL.md` — the cys:ship skill (working tree → PR: review, Conventional Commit, SemVer, PR template).

- [ ] **Step 1: Copy the source skill**

Copy ALL files from `C:/Users/dbaci/.claude/skills/git-flow/` into `skills/ship/`, preserving the directory layout (`SKILL.md`, `references/pr-template.md`, `references/verify-commands.md`, `scripts/next-version.sh`, `scripts/test-next-version.sh`, and any other file present in the source — copy everything, this is a migration, not a rewrite). Read the source directory listing first; do not assume it contains only the files named here.

- [ ] **Step 2: Adapt identity, not behavior**

Edit `skills/ship/SKILL.md` ONLY as follows (behavior, conventions, workflow steps, tables and rules stay byte-identical):

1. Set/replace the frontmatter so it reads exactly:

```markdown
---
name: ship
description: Use when changes are ready to ship — takes the working tree to a pull request with code review, Conventional Commit, automatic SemVer bump and a PR template. Part of the cys flow (after cys:check).
---
```

2. Replace the H1 title `# git-flow` with `# cys:ship`.
3. Replace every self-reference to "the git-flow skill" / "git-flow" *as the name of this skill* with "cys:ship" (do NOT touch mentions of the git-flow *branching model* — "GitFlow repo", "git-flow rules" as a versioning concept stay as-is).
4. If the SKILL.md references its own base directory or file paths (e.g. `references/pr-template.md`), keep them relative — they resolve within the skill directory.

- [ ] **Step 3: Verify the version script still passes its own tests**

Run: `bash skills/ship/scripts/test-next-version.sh`
Expected: all cases pass (exit 0). If `bash` reports CRLF issues on Windows, normalize the two `.sh` files to LF line endings and re-run.

- [ ] **Step 4: Run the structure test**

Run: `node --test tests/skills.test.js`
Expected: PASS — `skills/ship/SKILL.md` frontmatter satisfies name/description rules. (If Task 1 has not merged yet in your worktree, skip this step; the integration branch runs the full suite after merge.)

- [ ] **Step 5: Commit**

```bash
git add skills/ship
```

```bash
git commit -m "feat(cys): migrate git-flow skill as cys:ship"
```

---

### Task 3: `cys:design` — idea to approved spec

**Files:**
- Create: `skills/design/SKILL.md`

**Interfaces:**
- Consumes: None
- Produces: `skills/design/SKILL.md` — the cys:design skill (collaborative design: one question at a time, 2-3 approaches, spec file, user approval gate).

- [ ] **Step 1: Write the skill**

Create `skills/design/SKILL.md` with exactly this content:

```markdown
---
name: design
description: Use BEFORE any creative or feature work — turning an idea into an approved design spec through collaborative dialogue. Triggers - "let's build X", "I want a feature that...", "help me design...". The cys flow starts here; the output spec feeds cys:plan.
---

# cys:design

Turn an idea into an approved design spec through natural collaborative
dialogue. Understand first, propose second, write the spec last.

**Announce at start:** "Using cys:design to shape this idea into a spec."

<HARD-GATE>
Do NOT write implementation code, scaffold projects, or invoke any
implementation skill until the user has approved a presented design.
This applies to every project, no matter how simple it looks.
</HARD-GATE>

## Process

1. **Explore context** — read the relevant files, docs and recent commits
   of the target repo before asking anything.
2. **Scope check** — if the request spans multiple independent subsystems,
   say so and help decompose it first; one spec per coherent sub-project.
3. **Clarifying questions** — ONE question per message. Prefer multiple
   choice. Cover purpose, constraints, and success criteria. Stop asking
   when you can state what you are building in two sentences.
4. **Propose 2-3 approaches** — with trade-offs, leading with your
   recommendation and why.
5. **Present the design in sections** — scale each section to its
   complexity; ask after each whether it looks right. Cover: architecture,
   components, data flow, error handling, testing.
6. **Write the spec** to `docs/cys/specs/YYYY-MM-DD-<topic>-design.md`
   (user preferences for location override this default) and commit it.
7. **Self-review the spec** — placeholders ("TBD", vague requirements),
   internal contradictions, scope creep, ambiguous requirements readable
   two ways. Fix inline.
8. **User review gate** — ask the user to review the written spec file.
   Only proceed on explicit approval.
9. **Hand off to cys:plan** — the ONLY next step after approval is
   invoking cys:plan to write the implementation plan.

## Design principles

- Decisions the user already made are settled — do not re-litigate them.
- YAGNI ruthlessly: strike features the goal does not need.
- Prefer small units with one clear purpose and well-defined interfaces;
  if internals cannot change without breaking consumers, redraw the
  boundaries.
- In existing codebases, follow the established patterns; propose targeted
  improvements only where existing problems block the current work.

## Red flags — you are skipping the process

- "This is too simple to need a design" — simple projects hide the most
  unexamined assumptions. The spec may be short; it may not be skipped.
- Asking three questions in one message — ask one.
- Writing code "just to explore" before approval — exploration is reading,
  not writing.
```

- [ ] **Step 2: Verify structure**

Run: `node --test tests/skills.test.js`
Expected: PASS. (If Task 1 has not merged yet in your worktree, skip — the integration branch runs the full suite after merge.)

- [ ] **Step 3: Commit**

```bash
git add skills/design
```

```bash
git commit -m "feat(cys): add cys:design skill (idea to approved spec)"
```

---

### Task 4: `cys:plan` — spec to executable plan

**Files:**
- Create: `skills/plan/SKILL.md`

**Interfaces:**
- Consumes: None
- Produces: `skills/plan/SKILL.md` — the cys:plan skill (spec → `### Task N:` plan with single-line `Consumes`/`Produces`, ready for the parallel executor).

- [ ] **Step 1: Write the skill**

Create `skills/plan/SKILL.md` with exactly this content:

```markdown
---
name: plan
description: Use when an approved design spec exists and you need the implementation plan — numbered tasks with Files and Consumes/Produces blocks that the parallel-plan-executor can parse into a dependency DAG. Comes after cys:design, before cys:run.
---

# cys:plan

Write an implementation plan a zero-context engineer could execute:
bite-sized tasks, exact paths, complete code, TDD, frequent commits.
The plan doubles as machine input — the parallel-plan-executor parses
its task blocks into a dependency graph, so format discipline is load-
bearing, not cosmetic.

**Announce at start:** "Using cys:plan to write the implementation plan."

**Save plans to:** `docs/cys/plans/YYYY-MM-DD-<feature-name>.md`
(user preferences for location override this default).

## Plan header

Every plan MUST start with:

    # [Feature Name] Implementation Plan

    > **For agentic workers:** execute this plan with the
    > parallel-plan-executor Workflow (cys:run / the /cys-run command).
    > Steps use checkbox (`- [ ]`) syntax for tracking.

    **Goal:** [one sentence]

    **Architecture:** [2-3 sentences]

    **Tech Stack:** [key technologies]

    ## Global Constraints

    [Project-wide requirements, one line each, exact values copied
    verbatim from the spec. Every task implicitly includes this section.]

    ---

## Task format — the parser contract

    ### Task N: [Component Name]

    **Files:**
    - Create: `exact/path/to/file.js`
    - Modify: `exact/path/to/existing.js`
    - Test: `tests/exact/path/to/test.js`

    **Interfaces:**
    - Consumes: [backticked symbols from earlier tasks — exact signatures]
    - Produces: [backticked symbols later tasks rely on]

Hard rules (the executor's parser depends on them):

- Task headers are exactly `### Task N: Title` — sequential integer ids,
  never duplicated.
- Only **backticked** symbols count in Consumes/Produces; loose prose is
  ignored by the parser. Backtick every real interface (`createWidget()`,
  `src/db.js`); never backtick filler words.
- **One entry per line** in Consumes/Produces — a value wrapping onto a
  second line is silently lost by the parser.
- `Consumes: None` means an empty list; write it when a task is
  independent.
- Two tasks touching the same file are automatically serialized by the
  executor; design task boundaries so files are disjoint whenever
  possible — disjoint tasks run in parallel.

## Steps within a task

Each step is one 2-5 minute action, with complete content — never
"add error handling" or "similar to Task N":

1. Write the failing test (show the full test code).
2. Run it, expect FAIL (show the command and expected error).
3. Write the minimal implementation (show the full code).
4. Run the test, expect PASS.
5. Commit (show the exact `git add` + `git commit -m` commands,
   Conventional Commit message in English).

## Self-review before handing off

- **Spec coverage:** every spec requirement maps to a task; list gaps.
- **Placeholder scan:** no "TBD", no code-free code steps.
- **Type consistency:** names and signatures match across tasks — the
  Produces of task N must be exactly what task M Consumes.
- **Parser dry-run:** run `node <executor>/bin/parse-plan.js <plan>` and
  read the graph — verify the parallelism you designed is the parallelism
  it inferred, and surface any warnings to the user.

## Hand off

After saving the plan, hand off to execution: launch with cys:run
(or tell the user to run /cys-run). Do NOT offer sequential execution
paths — parallel execution via the DAG is the cys default.
```

- [ ] **Step 2: Verify structure**

Run: `node --test tests/skills.test.js`
Expected: PASS. (Skip if Task 1 has not merged in your worktree.)

- [ ] **Step 3: Commit**

```bash
git add skills/plan
```

```bash
git commit -m "feat(cys): add cys:plan skill (spec to parser-ready plan)"
```

---

### Task 5: `cys:check` — adversarial review and verification

**Files:**
- Create: `skills/check/SKILL.md`

**Interfaces:**
- Consumes: None
- Produces: `skills/check/SKILL.md` — the cys:check skill (adversarial review verdicts + evidence-before-claims verification).

- [ ] **Step 1: Write the skill**

Create `skills/check/SKILL.md` with exactly this content:

```markdown
---
name: check
description: Use when reviewing implemented work or before claiming anything is done, fixed or passing — adversarial review with explicit verdicts, and verification with evidence before assertions. The same conventions the parallel-plan-executor's review agents follow.
---

# cys:check

Two disciplines in one skill: reviewing someone else's change
adversarially, and verifying your own claims before you make them.

**Announce at start:** "Using cys:check to review/verify this work."

## Reviewing a change

Treat the implementer's report as unverified claims — verify against the
diff, never against the narrative. Read the actual change once, fully.

Structure every review as two independent verdicts:

1. **Spec compliance** — verdict `PASS` or `FAIL`.
   Findings categorized as Missing / Extra / Misunderstood, each with
   `file:line`.
2. **Code quality** — verdict `APPROVED` or `NEEDS_FIXES`.
   Findings categorized as Critical (must fix) / Important (should fix) /
   Minor (nice to have), each with `file:line`.

Both verdicts are always required; a beautiful implementation of the
wrong thing FAILs, an ugly implementation of the right thing may PASS
with NEEDS_FIXES.

For a whole-branch (cross-task) review, structure it as:
Strengths / Issues (Critical, Important, Minor — each with file:line) /
Recommendations / Assessment ("Ready to merge? yes/no" with reasoning).
Look specifically for cross-boundary defects a per-task review cannot
see: interface mismatches, duplicated logic, contract drift.

## Verifying before claiming

Never state "done", "fixed", "passing" or "works" without having run the
verification in the same session and read its output:

- Run the project's own test/lint command — not a guess. Show the result.
- If you changed generated artifacts, regenerate and diff — confirm sync.
- If the change has a runtime surface, exercise it end-to-end once.
- Report outcomes faithfully: failing tests are reported as failing,
  skipped steps as skipped. Evidence precedes assertions, always.

## Red flags

- Reviewing the report instead of the diff.
- A single merged verdict ("looks good") — the two axes exist because
  they fail independently.
- "Should work now" — run it; then say it works.
- Findings without file:line — unactionable review is noise.
```

- [ ] **Step 2: Verify structure**

Run: `node --test tests/skills.test.js`
Expected: PASS. (Skip if Task 1 has not merged in your worktree.)

- [ ] **Step 3: Commit**

```bash
git add skills/check
```

```bash
git commit -m "feat(cys): add cys:check skill (adversarial review + verification)"
```

---

### Task 6: `cys:guide` — the index skill

**Files:**
- Create: `skills/guide/SKILL.md`

**Interfaces:**
- Consumes: `skills/ship/SKILL.md`, `skills/design/SKILL.md`, `skills/plan/SKILL.md`, `skills/check/SKILL.md`
- Produces: `skills/guide/SKILL.md` — the cys:guide index skill.

- [ ] **Step 1: Read the four sibling skills**

Read `skills/design/SKILL.md`, `skills/plan/SKILL.md`, `skills/check/SKILL.md` and `skills/ship/SKILL.md` (they are already merged — this task depends on them). Verify the one-line summaries below match what each actually does; adjust wording if a sibling changed during review.

- [ ] **Step 2: Write the skill**

Create `skills/guide/SKILL.md` with exactly this content (adjusted per Step 1 if needed):

```markdown
---
name: guide
description: Use when starting work with the cys plugin or unsure which cys skill applies — the index of the cys flow (design → plan → run → check → ship) and the rules for moving between stages.
---

# cys:guide

cys is a development methodology with parallel execution at its core.
Five stages, five skills — each stage's output is the next stage's input.

## The flow

| Stage | Skill | In → Out |
|---|---|---|
| 1. Design | `cys:design` | idea → approved spec (`docs/cys/specs/`) |
| 2. Plan | `cys:plan` | spec → parser-ready plan (`docs/cys/plans/`) |
| 3. Run | `cys:run` — the parallel-plan-executor Workflow (`/cys-run`) | plan → implemented, reviewed, merged task branches |
| 4. Check | `cys:check` | change → verdicts (spec PASS/FAIL + quality APPROVED/NEEDS_FIXES) |
| 5. Ship | `cys:ship` | working tree → Conventional Commit, SemVer bump, PR |

Stage 3 is what makes cys different: independent plan tasks execute in
PARALLEL via a dependency DAG inferred from each task's Consumes/Produces
block — not one at a time. Stage 4 runs automatically inside stage 3 for
every task (adversarial review, one fix round); invoke it standalone for
ad-hoc reviews. Stage 5's PR merge is always a human gate — agents never
merge PRs.

## Rules

- If a cys skill applies to what you are about to do, invoke it BEFORE
  responding or acting — including before clarifying questions.
- Enter the flow at the stage matching what already exists: no spec →
  design; spec → plan; plan → run; implemented change → check; reviewed
  change → ship.
- Never skip forward: code without an approved spec and plan is how cys
  work does not happen.
- Branch topology: `main` ← `develop` ← `feature/<plan>` (integration
  branch) ← `task-N` (one per plan task). Agents never touch `main` or
  `develop` directly.

## What cys does not do

- No sequential plan execution mode — the executor's DAG already
  serializes what must be serial (shared files, Consumes/Produces
  dependencies) and parallelizes the rest.
- No agent-performed PR merges, ever.
```

- [ ] **Step 3: Verify structure**

Run: `node --test tests/skills.test.js`
Expected: PASS — all five skills now satisfy the frontmatter rules.

- [ ] **Step 4: Commit**

```bash
git add skills/guide
```

```bash
git commit -m "feat(cys): add cys:guide index skill"
```

---

### Task 7: Docs, changelog, expected-skills test, version bump

**Files:**
- Modify: `tests/skills.test.js`
- Modify: `README.md`
- Modify: `README.es.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: `skills/guide/SKILL.md`, `tests/skills.test.js`
- Produces: None (documentation and final assertions only).

- [ ] **Step 1: Pin the expected skill set in the structure test**

Add to `tests/skills.test.js` (the file exists — Task 1 created it):

```js
test('el set de skills v1 del plugin está completo', () => {
  const expected = ['check', 'design', 'guide', 'plan', 'ship'];
  const actual = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  assert.deepEqual(actual, expected);
});
```

Run: `node --test tests/skills.test.js`
Expected: PASS (all five skill directories exist on the integration branch by now).

- [ ] **Step 2: Update `README.md` and `README.es.md`**

Apply to both (English in `README.md`, Spanish in `README.es.md`):

1. Add a new section **"The cys plugin"** (ES: **"El plugin cys"**) right after the "What kind of thing is this?" section, containing:
   - cys is this repo's skill plugin — five skills covering the flow design → plan → run → check → ship, named after the author's twin daughters, **Cielo y Sophia**.
   - Install:
     ```
     /plugin marketplace add bacsystem/parallel-plan-executor
     /plugin install cys@bacsystem
     ```
   - The skills table: `cys:design` (idea → spec), `cys:plan` (spec → plan), `cys:run` (the Workflow in this repo, launched via `/cys-run` or `commands/run-plan.md`), `cys:check` (adversarial review/verification), `cys:ship` (commit/SemVer/PR), `cys:guide` (index).
   - Note: installing the plugin also exposes this repo's `commands/run-plan.md` as `/cys:run-plan`.
2. In the requirements section: an external plugin is now needed **only** if you author plans with an external plan-writing skill instead of `cys:plan`; the engine and the cys skills have no external plugin dependency.

- [ ] **Step 3: Update `CHANGELOG.md` and bump the version**

Add at the top of `CHANGELOG.md`:

```markdown
## 0.6.1 — 2026-07-16

New (cys F2 — see `docs/cys/specs/2026-07-16-cys-ecosystem-design.md`):

- The **cys plugin**: `.claude-plugin/plugin.json` + self-hosted marketplace
  (`/plugin marketplace add bacsystem/parallel-plan-executor`, then
  `/plugin install cys@bacsystem`).
- Five skills under `skills/`: `cys:ship` (migrated from the author's
  git-flow skill), `cys:design`, `cys:plan`, `cys:check`, `cys:guide`
  (written from scratch, English).
- `tests/skills.test.js` guards manifests and SKILL.md frontmatter.
- Docs: plugin install section (EN/ES); the external plan-authoring
  dependency demoted from hard requirement to optional (plan-authoring only).
```

In `package.json`, change `"version": "0.6.0"` to `"version": "0.6.1"` (0.x rules: `feat` without breaking change → patch).

Also update `"version"` in `.claude-plugin/plugin.json` to `"0.6.1"` if it differs.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — everything, including the new expected-skills assertion.

- [ ] **Step 5: Commit**

```bash
git add tests/skills.test.js README.md README.es.md CHANGELOG.md package.json .claude-plugin/plugin.json
```

```bash
git commit -m "docs(cys): plugin install docs, expected-skills test and 0.6.1 bump"
```
