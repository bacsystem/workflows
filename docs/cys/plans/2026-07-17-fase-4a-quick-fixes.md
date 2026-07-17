# Fase 4a Quick Fixes Implementation Plan

> **For agentic workers:** execute this plan with the
> parallel-plan-executor Workflow (cys:run / the /cys:run-plan command).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs found during the cys independence-proof smoke test: `/cys:flow` and `/cys:run-plan` never create the integration branch before launching, and `cys:parallel-plan-executor` appears duplicated in the installed plugin's skill listing.

**Architecture:** Two independent fixes touching disjoint files — a command-prompt-only fix (insert a branch-creation step in both entry commands) and a repo-layout fix (move the workflow template out of `workflows/`, the directory Claude Code appears to scan for `Workflow`-tool `meta` blocks, into a new `workflows-src/`).

**Tech Stack:** Markdown (commands), Node >= 20 (`node --test`, zero runtime dependencies).

## Global Constraints

- Node >= 20, `"type": "module"`, zero runtime dependencies.
- **Never edit `workflows/parallel-plan-executor.js` by hand** — it is generated. After this plan, its source lives at `workflows-src/parallel-plan-executor.template.js`; change that (or the inlined `src/` modules) and run `npm run build`, then commit both.
- All tests must pass: `npm test`.
- Commit messages follow Conventional Commits, in English.
- Do not chain shell commands with `&&`; one atomic command per invocation. Use `git -C <path>` instead of `cd`.

---

### Task 1: Create the integration branch before launching

**Files:**
- Modify: `commands/flow.md`
- Modify: `commands/run-plan.md`
- Test: `tests/skills.test.js`

**Interfaces:**
- Consumes: None
- Produces: None (command-prompt text only; verified via content assertions in the test file).

- [ ] **Step 1: Write the failing test**

Add to `tests/skills.test.js` (reuse the existing `readFileSync`/`path` imports and `root` constant already in the file):

```js
test('los comandos crean la integrationBranch desde develop si no existe antes de lanzar (Fase 4a fix 1)', () => {
  const flow = readFileSync(path.join(root, 'commands', 'flow.md'), 'utf8');
  const runPlan = readFileSync(path.join(root, 'commands', 'run-plan.md'), 'utf8');
  for (const [name, content] of [['flow.md', flow], ['run-plan.md', runPlan]]) {
    assert.ok(
      content.includes('create it from `develop`'),
      `commands/${name} debe crear la rama de integración desde develop si no existe (antes solo cubría el caso "ya existe")`
    );
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/skills.test.js`
Expected: FAIL — neither file contains that phrase yet.

- [ ] **Step 3: Edit `commands/flow.md`**

Find this block (the transition from step 7 to step 8):

```
7. **Summarize and confirm**: plan path, repo, task count, parallelism
   the graph shows, integration branch, PR settings, authorization text.
   Re-check the working tree is still clean; if the integration branch
   already exists, ask whether to continue on it or pick another name.

8. **Launch** the `Workflow` tool with:
```

Replace it with (a new step 8 inserted, renumbering the old 8 and 9 to 9 and 10):

```
7. **Summarize and confirm**: plan path, repo, task count, parallelism
   the graph shows, integration branch, PR settings, authorization text.
   Re-check the working tree is still clean; if the integration branch
   already exists, ask whether to continue on it or pick another name.

8. **Create the integration branch if it doesn't exist**: run
   `git -C <repo-path> show-ref --verify --quiet
   refs/heads/<integrationBranch>`. If it exits non-zero, create it from
   `develop`: `git -C <repo-path> branch <integrationBranch> develop`. If
   it exits 0, the branch already exists — step 7 already handled
   confirming that with the user, nothing more to do here.

9. **Launch** the `Workflow` tool with:
```

Then find the old step 9 (now needs renumbering to 10):

```
9. **After launching**: tell the user it runs in the background, that
```

Replace its leading number with `10`:

```
10. **After launching**: tell the user it runs in the background, that
```

- [ ] **Step 4: Edit `commands/run-plan.md`**

Find this block (the transition from step 5 to step 6):

```
5. **Summarize before launching**: plan path, repo, task count, integration branch,
   openPr/PR settings, and confirm the authorization text with the user. This is a real
   run against their repo — don't skip the confirmation.

6. **Launch**: invoke the `Workflow` tool with:
```

Replace it with (a new step 6 inserted, renumbering the old 6 and 7 to 7 and 8):

```
5. **Summarize before launching**: plan path, repo, task count, integration branch,
   openPr/PR settings, and confirm the authorization text with the user. This is a real
   run against their repo — don't skip the confirmation.

6. **Create the integration branch if it doesn't exist**: run
   `git -C <repo-path> show-ref --verify --quiet
   refs/heads/<integration-branch>`. If it exits non-zero, create it from
   `develop`: `git -C <repo-path> branch <integration-branch> develop`. If
   it exits 0, the branch already exists — step 2's sanity check already
   covers its naming, nothing more to do here.

7. **Launch**: invoke the `Workflow` tool with:
```

Then find the old step 7 (now needs renumbering to 8):

```
7. **After launching**: tell the user it's running in the background, mention they can
```

Replace its leading number with `8`:

```
8. **After launching**: tell the user it's running in the background, mention they can
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/skills.test.js`
Expected: PASS, including the new test.

- [ ] **Step 6: Commit**

```bash
git add commands/flow.md commands/run-plan.md tests/skills.test.js
```

```bash
git commit -m "fix(cys): create the integration branch from develop if it doesn't exist

Both /cys:flow and /cys:run-plan assumed integrationBranch already
existed — neither created it. When missing, the first task's merge
agent failed with a confusing 'not a valid object name' error disguised
as a merge conflict (found live during the cys independence-proof smoke
test). Both commands now create it from develop right before launching
if it isn't there yet."
```

---

### Task 2: Move the workflow template out of `workflows/`

**Files:**
- Create: `workflows-src/parallel-plan-executor.template.js`
- Modify: `scripts/build-workflow.js`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `README.es.md`
- Test: `tests/build-workflow.test.js`

**Interfaces:**
- Consumes: None
- Produces: `workflows-src/parallel-plan-executor.template.js` — the template's new location; `workflows/` now contains only the generated `parallel-plan-executor.js`.

- [ ] **Step 1: Write the failing test**

Add to `tests/build-workflow.test.js`. First add `existsSync` to its existing `node:fs` import (currently `import { readFileSync } from 'node:fs';` — change to `import { readFileSync, existsSync } from 'node:fs';`), then add:

```js
test('el template vive fuera de workflows/, para no duplicarse en el listado de skills del plugin (Fase 4a fix 2)', () => {
  assert.ok(
    existsSync(path.join(root, 'workflows-src', 'parallel-plan-executor.template.js')),
    'el template debe existir en workflows-src/'
  );
  assert.ok(
    !existsSync(path.join(root, 'workflows', 'parallel-plan-executor.template.js')),
    'workflows/ no debe tener ningún archivo con export const meta además del generado — causa raíz confirmada del duplicado cys:parallel-plan-executor en el listado de skills'
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/build-workflow.test.js`
Expected: FAIL — `workflows-src/` does not exist yet, the template is still under `workflows/`.

- [ ] **Step 3: Move the template and update the build script**

Move the file with git (preserves history as a rename):

```bash
git mv workflows/parallel-plan-executor.template.js workflows-src/parallel-plan-executor.template.js
```

In `scripts/build-workflow.js`, find:

```js
const templatePath = path.join(root, 'workflows', 'parallel-plan-executor.template.js');
```

Replace with:

```js
const templatePath = path.join(root, 'workflows-src', 'parallel-plan-executor.template.js');
```

- [ ] **Step 4: Update `CLAUDE.md`**

Find (line 29):

```
   - `workflows/parallel-plan-executor.js` is **generated** — never edit it by hand. It is built by `scripts/build-workflow.js`, which inlines `src/scheduler.js`, `src/graph-builder.js` + `src/validate-args.js`, and `src/time.js` into `workflows/parallel-plan-executor.template.js` at the `/* __SCHEDULER_SOURCE__ */`, `/* __VALIDATION_SOURCE__ */` and `/* __TIME_SOURCE__ */` placeholders. After changing any of those inlined modules or the template, run `npm run build` and commit both the source and the regenerated file.
```

Replace with:

```
   - `workflows/parallel-plan-executor.js` is **generated** — never edit it by hand. It is built by `scripts/build-workflow.js`, which inlines `src/scheduler.js`, `src/graph-builder.js` + `src/validate-args.js`, and `src/time.js` into `workflows-src/parallel-plan-executor.template.js` at the `/* __SCHEDULER_SOURCE__ */`, `/* __VALIDATION_SOURCE__ */` and `/* __TIME_SOURCE__ */` placeholders. The template lives in `workflows-src/`, not `workflows/`, so the plugin's skill auto-discovery never finds two files carrying the same `meta` block (Fase 4a fix — see `docs/cys/specs/2026-07-17-fase-4a-quick-fixes-design.md`). After changing any of those inlined modules or the template, run `npm run build` and commit both the source and the regenerated file.
```

- [ ] **Step 5: Update `README.md`**

Find:

```
2. `workflows/parallel-plan-executor.js` (built from `workflows/parallel-plan-executor.template.js`
   via `npm run build`) takes that graph and runs each task in its own git worktree via
```

Replace with:

```
2. `workflows/parallel-plan-executor.js` (built from `workflows-src/parallel-plan-executor.template.js`
   via `npm run build`) takes that graph and runs each task in its own git worktree via
```

- [ ] **Step 6: Update `README.es.md`**

Find:

```
2. `workflows/parallel-plan-executor.js` (generado a partir de
   `workflows/parallel-plan-executor.template.js` con `npm run build`) toma ese grafo y
```

Replace with:

```
2. `workflows/parallel-plan-executor.js` (generado a partir de
   `workflows-src/parallel-plan-executor.template.js` con `npm run build`) toma ese grafo y
```

- [ ] **Step 7: Rebuild and run the full suite**

Run: `npm run build`
Expected: `Built <repo>/workflows/parallel-plan-executor.js`

Run: `git status --short workflows/parallel-plan-executor.js`
Expected: no output (the regenerated file is byte-identical to what was already committed — moving the template must not change the build's output).

Run: `npm test`
Expected: PASS — everything, including the two new tests from this plan.

- [ ] **Step 8: Commit**

```bash
git add workflows-src/parallel-plan-executor.template.js scripts/build-workflow.js CLAUDE.md README.md README.es.md tests/build-workflow.test.js
```

```bash
git commit -m "fix(cys): move the workflow template out of workflows/ to stop duplicate skill registration

cys:parallel-plan-executor appeared twice in the installed plugin's
skill listing. workflows/ is not a documented Claude Code plugin
auto-discovery directory, but the platform appears to scan it anyway
for any file carrying the Workflow tool's meta block — and both
parallel-plan-executor.template.js and the generated
parallel-plan-executor.js carried an identical one, so both got
registered. The template now lives in workflows-src/; workflows/
contains only the generated file, the sole meta-carrying file in any
directory the platform might scan."
```
