# cys Pending Tracker Implementation Plan

> **For agentic workers:** execute this plan with the
> parallel-plan-executor Workflow (cys:run / the /cys:run-plan command).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** add a durable per-repo pendientes log (`.cys/pending.md`) that
`cys:guide` reminds the user about, and that `cys:check` and the
Workflow's Handoff agent write to automatically when a review finding is
left unresolved.

**Architecture:** two independent, disjoint-file tasks — skill
documentation (`cys:guide` + `cys:check`) and the Handoff agent's
prompt/schema in the Workflow template — both implementing the approved
design at `docs/cys/specs/2026-07-17-cys-pending-tracker-design.md`.

**Tech Stack:** Markdown (skills), template-string edits (Workflow
script), Node's built-in test runner (`node --test`).

## Global Constraints

- Never hand-edit `workflows/parallel-plan-executor.js` — only
  `workflows-src/parallel-plan-executor.template.js`, then `npm run build`.
- `.cys/pending.md`'s three sections are always, in this exact order:
  `## Bugs`, `## Gaps`, `## Tareas`.
- Commit messages: Conventional Commits, in English.

---

### Task 1: Document `.cys/pending.md` in cys:guide and cys:check

**Files:**
- Modify: `skills/guide/SKILL.md`
- Modify: `skills/check/SKILL.md`
- Test: `tests/skills.test.js`

**Interfaces:**
- Consumes: None
- Produces: the `.cys/pending.md` convention (three fixed sections
  `Bugs`/`Gaps`/`Tareas`), documented in prose for `cys:guide`'s reminder
  behavior and `cys:check`'s deferred-finding behavior.

- [ ] **Step 1: Write the failing tests**

Append to the end of `tests/skills.test.js`:

```js
test('guide documenta la convención .cys/pending.md y sus tres secciones fijas', () => {
  const guide = readFileSync(path.join(skillsDir, 'guide', 'SKILL.md'), 'utf8');
  assert.ok(
    guide.includes('.cys/pending.md') &&
      guide.includes('## Bugs') &&
      guide.includes('## Gaps') &&
      guide.includes('## Tareas'),
    'cys:guide debe documentar el archivo de pendientes y sus tres secciones fijas'
  );
});

test('check documenta que un hallazgo diferido se registra en .cys/pending.md', () => {
  const check = readFileSync(path.join(skillsDir, 'check', 'SKILL.md'), 'utf8');
  assert.ok(
    check.includes('.cys/pending.md'),
    'cys:check debe anotar en .cys/pending.md los hallazgos que el usuario decide no corregir ahora'
  );
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test tests/skills.test.js`
Expected: FAIL on both new tests — neither `SKILL.md` mentions
`.cys/pending.md` yet.

- [ ] **Step 3: Update `skills/guide/SKILL.md`**

Insert this new section right after the existing `## Rules` section ends
and before `## What cys does not do`:

```markdown
## Pendientes (`.cys/pending.md`)

An optional, freeform file at `<repo>/.cys/pending.md` for tracking bugs,
gaps, and pending tasks across sessions instead of letting them evaporate
from chat. Three fixed sections, always in this order:

    # Pendientes

    ## Bugs
    - [ ] broken or incorrect behavior

    ## Gaps
    - [ ] scope left out of a design/spec/review, on purpose or by omission

    ## Tareas
    - [ ] anything else pending

Anyone adds a line (`- [ ]`) or checks one off (`- [x]`) by editing the
file directly — no special tooling, and `cys:guide` never creates it. On
invocation, `cys:guide` is the only place that reads it to remind the
user: if the file exists and has unchecked items, list them grouped by
section before presenting the flow table (skip a section with nothing
open). `cys:run`'s Handoff agent and `cys:check` write to it when a
review finding is left unresolved — see `cys:check`.
```

- [ ] **Step 4: Update `skills/check/SKILL.md`**

Insert this new subsection right after `## Reviewing a change` ends
(its last line today is `... interface mismatches, duplicated logic,
contract drift.`) and before `## Verifying before claiming`:

```markdown
### Deferring a finding

When the user responds to a finding with anything other than fixing it
now (e.g. "later", "not now", "leave it") — whether from a per-task
review, a whole-branch review, or a standalone `cys:check` run — append
it to `<repo>/.cys/pending.md`: under `## Bugs` for broken/incorrect
behavior, or `## Gaps` for missing/deferred scope. Create the file with
the standard skeleton first if it doesn't exist yet:

    # Pendientes

    ## Bugs

    ## Gaps

    ## Tareas

Keep the finding's own wording and `file:line`. Never touch `## Tareas`
— that section is free-form user/agent notes, not review output.
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `node --test tests/skills.test.js`
Expected: PASS — all tests, including the two new ones.

- [ ] **Step 6: Commit**

```bash
git add skills/guide/SKILL.md skills/check/SKILL.md tests/skills.test.js
git commit -m "docs(cys): document .cys/pending.md convention in guide and check skills"
```

---

### Task 2: Handoff agent auto-registers unresolved findings to `.cys/pending.md`

**Files:**
- Modify: `workflows-src/parallel-plan-executor.template.js`
- Modify: `workflows/parallel-plan-executor.js` (regenerated via
  `npm run build` — never hand-edit)
- Test: `tests/build-workflow.test.js`

**Interfaces:**
- Consumes: None — no runtime dependency on Task 1's files. This task
  hardcodes the pending.md skeleton independently (same convention from
  the approved design spec), matching the existing pattern where the
  Handoff agent duplicates conventions because the sandboxed Workflow
  can't invoke the `Skill` tool.
- Produces: `HANDOFF_SCHEMA.pendingLogged` — a number reporting how many
  items the Handoff agent appended at runtime, surfaced in the run's
  final log line.

- [ ] **Step 1: Write the failing test**

Append to the end of `tests/build-workflow.test.js`:

```js
test('built workflow appends unresolved final-review findings to .cys/pending.md via the Handoff agent (cys pending tracker)', () => {
  assert.ok(
    output.includes('.cys/pending.md'),
    'el prompt de handoff debe instruir escribir en .cys/pending.md'
  );
  assert.ok(
    output.includes('## Bugs') && output.includes('## Gaps') && output.includes('## Tareas'),
    'el esqueleto de pending.md debe tener las tres secciones fijas'
  );
  assert.ok(
    output.includes('pendingLogged'),
    'el agente debe reportar cuántos ítems agregó, para poder mostrarlo en el log final'
  );
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test tests/build-workflow.test.js`
Expected: FAIL — the current build has no mention of `.cys/pending.md`.

- [ ] **Step 3: Update `HANDOFF_SCHEMA`**

In `workflows-src/parallel-plan-executor.template.js`, find:

```js
const HANDOFF_SCHEMA = {
  type: 'object',
  properties: {
    handoffFile: { type: 'string' },
    versionBump: { type: 'string', description: 'proposed SemVer bump per git-flow rules, e.g. "patch -> 1.2.4" or "minor (0.x breaking) -> 0.5.0"' },
    prUrl: { type: 'string', description: 'URL of the created PR, only when openPr was requested and succeeded' },
    detail: { type: 'string' },
  },
  required: ['handoffFile'],
};
```

Replace with:

```js
const HANDOFF_SCHEMA = {
  type: 'object',
  properties: {
    handoffFile: { type: 'string' },
    versionBump: { type: 'string', description: 'proposed SemVer bump per git-flow rules, e.g. "patch -> 1.2.4" or "minor (0.x breaking) -> 0.5.0"' },
    prUrl: { type: 'string', description: 'URL of the created PR, only when openPr was requested and succeeded' },
    pendingLogged: { type: 'number', description: 'count of unresolved review findings appended to .cys/pending.md' },
    detail: { type: 'string' },
  },
  required: ['handoffFile'],
};
```

- [ ] **Step 4: Update the `handoff()` prompt**

In the same file, find the `handoff()` function body (the template
literal passed to `agent(...)`) and replace the whole function with:

```js
async function handoff(finalReview) {
  const prArgs = pr ?? {};
  const wantPr = openPr === true;
  return agent(
    `In repo ${repoPath}, prepare the git-flow handoff for branch ${integrationBranch}.\n\n` +
    `1. Inspect the run's work: \`git log --oneline ${integrationBranch}\` — the task-N merge ` +
    `commits and the commits they brought in. Derive the dominant Conventional ` +
    `Commit type and propose a SemVer bump per git-flow rules (>=1.0: feat=minor, fix=patch, ` +
    `BREAKING=major; 0.x: BREAKING=minor, everything else=patch). Report it as versionBump.\n\n` +
    `2. Write ${repoPath}/.cys/handoff.md containing: a suggested PR title ` +
    `(Conventional Commit subject covering the run), a PR body with Summary / Type of change / ` +
    `Main changes (one bullet per task) / Version / Checklist sections, the final review ` +
    `verdict quoted below, and a post-run cleanup checklist (merged task-N branches to delete, ` +
    `what to do with ${integrationBranch} after the PR merges). Report its path as handoffFile.\n\n` +
    `3. Classify every finding in the final review above that is still unresolved (Minor ` +
    `findings are expected to stay open; also include any Important/Critical finding the user ` +
    `explicitly chose not to fix). For each: append one line to ${repoPath}/.cys/pending.md, ` +
    `under "## Bugs" for broken/incorrect behavior or "## Gaps" for missing/deferred scope — ` +
    `create the file first with this exact skeleton if it does not exist yet:\n` +
    `"# Pendientes\\n\\n## Bugs\\n\\n## Gaps\\n\\n## Tareas\\n". Keep the finding's own wording ` +
    `and file:line reference; never touch "## Tareas". Report how many items you appended as ` +
    `pendingLogged (0 if every finding was already resolved).\n\n` +
    (wantPr
      ? `4. Push ${integrationBranch} to the remote and create the pull request: ` +
        `\`gh pr create --base ${prArgs.base ?? 'develop'} --head ${integrationBranch}\` with the ` +
        `title and body from handoff.md, applying these fields when present: ` +
        `${JSON.stringify(prArgs)} (assignees, labels, milestone; put "Closes #<closes>" in the ` +
        `body when closes is set). Do NOT merge the PR — that gate is human. Report its URL as ` +
        `prUrl. If there is no remote or gh fails, do not retry destructively: explain in "detail".\n\n`
      : `4. Do NOT push and do NOT create any PR (openPr was not requested). Note in "detail" ` +
        `that the branch is ready for a manual git-flow handoff.\n\n`) +
    `Final whole-branch review verdict:\n<review>${finalReview ?? 'final review was not run'}</review>`,
    { label: 'handoff', phase: 'Handoff', schema: HANDOFF_SCHEMA }
  );
}
```

- [ ] **Step 5: Surface `pendingLogged` in the final log line**

In the same file, find:

```js
  handoffResult = await handoff(finalReview);
  if (handoffResult) {
    log(`Handoff listo: ${handoffResult.handoffFile}` +
      (handoffResult.versionBump ? ` — bump propuesto: ${handoffResult.versionBump}` : '') +
      (handoffResult.prUrl ? ` — PR: ${handoffResult.prUrl}` : ''));
  } else {
```

Replace with:

```js
  handoffResult = await handoff(finalReview);
  if (handoffResult) {
    log(`Handoff listo: ${handoffResult.handoffFile}` +
      (handoffResult.versionBump ? ` — bump propuesto: ${handoffResult.versionBump}` : '') +
      (handoffResult.prUrl ? ` — PR: ${handoffResult.prUrl}` : '') +
      (handoffResult.pendingLogged ? ` — ${handoffResult.pendingLogged} pendiente(s) agregado(s) a .cys/pending.md` : ''));
  } else {
```

- [ ] **Step 6: Rebuild**

Run: `npm run build`
Expected: regenerates `workflows/parallel-plan-executor.js` with no
errors.

- [ ] **Step 7: Run test, verify it passes**

Run: `node --test tests/build-workflow.test.js`
Expected: PASS — all tests, including the new one.

- [ ] **Step 8: Commit**

```bash
git add workflows-src/parallel-plan-executor.template.js workflows/parallel-plan-executor.js tests/build-workflow.test.js
git commit -m "feat(cys): auto-register unresolved review findings to .cys/pending.md via Handoff agent"
```

---

## Self-review

- **Spec coverage:** guide's reminder (Task 1) ✓, check's deferred-finding
  docs (Task 1) ✓, Handoff agent auto-registration + `pendingLogged`
  (Task 2) ✓. Out-of-scope items from the design (design/plan self-review
  writes, item metadata, Fase 4c) intentionally left untouched.
- **Placeholder scan:** none — every step has complete text/code.
- **Type consistency:** `## Bugs`/`## Gaps`/`## Tareas` spelled
  identically across both tasks and both `SKILL.md` files.
- **Parser dry-run:** Task 1 and Task 2 touch disjoint files (no shared
  file, no Consumes/Produces symbol overlap) — the executor should infer
  graph `{"1": [], "2": []}`, full parallelism.
