# Fase 4b State Recovery Implementation Plan

> **For agentic workers:** execute this plan with the
> parallel-plan-executor Workflow (cys:run / the /cys:run-plan command).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the engine a structured `.cys/state.json` run record and a deterministic script to compute what's left of an interrupted run, then wire both entry commands to detect and offer to resume it.

**Architecture:** The engine writes a full per-task status snapshot to `.cys/state.json` at start and after every task settles, and deletes it only if the script reaches its own natural end. A new pure-Node CLI (`bin/plan-remainder.js`) reduces a plan + that state file to "only what's left," reusing the existing plan parser. `commands/flow.md` and `commands/run-plan.md` check for that file and offer to resume instead of starting over.

**Tech Stack:** Node >= 20 (`node --test`), Markdown commands.

## Global Constraints

- Node >= 20, `"type": "module"`, zero runtime dependencies.
- **Never edit `workflows/parallel-plan-executor.js` by hand** — it is generated from `workflows-src/parallel-plan-executor.template.js` via `npm run build`. Change the template, rebuild, commit both.
- All tests must pass: `npm test`.
- Commit messages follow Conventional Commits, in English.
- Do not chain shell commands with `&&`; one atomic command per invocation. Use `git -C <path>` instead of `cd`.
- `.cys/state.json`'s per-task `status` is only ever written as `pending`, `done`, or `failed` during a live run — `skipped` is never persisted mid-run (the DAG only knows a task is skipped once it fully resolves, which is also when the whole file gets deleted); a resumed run's own scheduler figures out anew whether a `pending`/`failed` task is skippable.

---

### Task 1: `bin/plan-remainder.js`

**Files:**
- Create: `bin/plan-remainder.js`
- Test: `tests/plan-remainder.test.js`

**Interfaces:**
- Consumes: `parsePlanWithDiagnostics` (from `src/plan-parser.js`), `buildGraphWithDiagnostics` (from `src/graph-builder.js`).
- Produces: the CLI `bin/plan-remainder.js` — usage `node bin/plan-remainder.js <planPath> <stateJsonPath>`; prints `{ tasks, graph, warnings }` JSON to stdout (same shape as `bin/parse-plan.js`), with every task whose `state.json` status is `done` removed from `tasks` and dropped from every remaining task's dependency list. Exits 1 with a clear message if `state.json`'s `planPath` doesn't match the `planPath` argument, or if args are missing.

- [ ] **Step 1: Write the failing tests**

Create `tests/plan-remainder.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'bin', 'plan-remainder.js');

const PLAN = [
  '# Some Plan',
  '',
  '---',
  '',
  '### Task 1: First',
  '',
  '**Files:**',
  '- Create: `src/a.js`',
  '',
  '**Interfaces:**',
  '- Produces: `a()`',
  '',
  '---',
  '',
  '### Task 2: Second',
  '',
  '**Files:**',
  '- Create: `src/b.js`',
  '',
  '**Interfaces:**',
  '- Consumes: `a()`',
  '- Produces: `b()`',
  '',
  '---',
  '',
  '### Task 3: Third',
  '',
  '**Files:**',
  '- Create: `src/c.js`',
  '',
  '**Interfaces:**',
  '- Consumes: `b()`',
  '',
].join('\n');

function makeFixtures() {
  const dir = mkdtempSync(path.join(tmpdir(), 'plan-remainder-'));
  const planPath = path.join(dir, 'plan.md');
  writeFileSync(planPath, PLAN);
  return { dir, planPath };
}

function writeState(dir, planPath, tasks) {
  const statePath = path.join(dir, 'state.json');
  writeFileSync(statePath, JSON.stringify({ planPath, tasks }));
  return statePath;
}

test('descarta las tareas done y las dependencias ya satisfechas', () => {
  const { dir, planPath } = makeFixtures();
  const statePath = writeState(dir, planPath, {
    1: { status: 'done' },
    2: { status: 'failed' },
    3: { status: 'pending' },
  });

  const stdout = execFileSync('node', [cli, planPath, statePath], { encoding: 'utf8' });
  const result = JSON.parse(stdout);

  assert.deepEqual(result.tasks.map((t) => t.id), [2, 3]);
  assert.deepEqual(result.graph, { 2: [], 3: [2] });
});

test('si ninguna tarea está done, devuelve el plan completo sin cambios', () => {
  const { dir, planPath } = makeFixtures();
  const statePath = writeState(dir, planPath, {
    1: { status: 'pending' },
    2: { status: 'pending' },
    3: { status: 'pending' },
  });

  const stdout = execFileSync('node', [cli, planPath, statePath], { encoding: 'utf8' });
  const result = JSON.parse(stdout);

  assert.deepEqual(result.tasks.map((t) => t.id), [1, 2, 3]);
  assert.deepEqual(result.graph, { 1: [], 2: [1], 3: [2] });
});

test('si todas las tareas están done, devuelve listas vacías', () => {
  const { dir, planPath } = makeFixtures();
  const statePath = writeState(dir, planPath, {
    1: { status: 'done' },
    2: { status: 'done' },
    3: { status: 'done' },
  });

  const stdout = execFileSync('node', [cli, planPath, statePath], { encoding: 'utf8' });
  const result = JSON.parse(stdout);

  assert.deepEqual(result.tasks, []);
  assert.deepEqual(result.graph, {});
});

test('falla ruidosamente si el planPath de state.json no coincide', () => {
  const { dir, planPath } = makeFixtures();
  const statePath = writeState(dir, '/otro/plan.md', {});

  assert.throws(() =>
    execFileSync('node', [cli, planPath, statePath], { encoding: 'utf8', stdio: 'pipe' })
  );
});

test('falla ruidosamente sin args', () => {
  assert.throws(() => execFileSync('node', [cli], { encoding: 'utf8', stdio: 'pipe' }));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/plan-remainder.test.js`
Expected: FAIL — `bin/plan-remainder.js` does not exist.

- [ ] **Step 3: Implement `bin/plan-remainder.js`**

Create `bin/plan-remainder.js`:

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parsePlanWithDiagnostics } from '../src/plan-parser.js';
import { buildGraphWithDiagnostics } from '../src/graph-builder.js';

const [, , planPath, stateJsonPath] = process.argv;
if (!planPath || !stateJsonPath) {
  console.error('Usage: node bin/plan-remainder.js <path-to-plan.md> <path-to-state.json>');
  process.exit(1);
}

const planText = readFileSync(planPath, 'utf8');
const { tasks, warnings: parseWarnings } = parsePlanWithDiagnostics(planText);
const { graph, warnings: graphWarnings } = buildGraphWithDiagnostics(tasks);

const state = JSON.parse(readFileSync(stateJsonPath, 'utf8'));
if (state.planPath !== planPath) {
  console.error(`state.json is for a different plan ("${state.planPath}"), not "${planPath}"`);
  process.exit(1);
}

// Solo "done" sale del remanente: una tarea failed/pending/skipped todavía necesita
// que el scheduler la vuelva a intentar (o decida de nuevo si corresponde saltearla).
const doneIds = new Set(
  Object.entries(state.tasks ?? {})
    .filter(([, entry]) => entry.status === 'done')
    .map(([id]) => Number(id))
);

const remainingTasks = tasks.filter((t) => !doneIds.has(t.id));
const remainingGraph = {};
for (const task of remainingTasks) {
  remainingGraph[task.id] = (graph[task.id] ?? []).filter((depId) => !doneIds.has(depId));
}

const warnings = [...parseWarnings, ...graphWarnings];
for (const warning of warnings) {
  console.error(`WARNING: ${warning}`);
}
console.log(JSON.stringify({ tasks: remainingTasks, graph: remainingGraph, warnings }, null, 2));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/plan-remainder.test.js`
Expected: PASS (5 tests).

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add bin/plan-remainder.js tests/plan-remainder.test.js
```

```bash
git commit -m "feat(cys): add bin/plan-remainder.js — compute what's left of an interrupted run"
```

---

### Task 2: Engine — write and clear `.cys/state.json`

**Files:**
- Modify: `workflows-src/parallel-plan-executor.template.js`
- Modify: `workflows/parallel-plan-executor.js` (generated — via `npm run build` only)
- Test: `tests/build-workflow.test.js`

**Interfaces:**
- Consumes: None
- Produces: the regenerated `workflows/parallel-plan-executor.js`, which now writes `.cys/state.json` at start, updates it on every task settle, and deletes it before its own final `return`.

- [ ] **Step 1: Write the failing test**

Add to `tests/build-workflow.test.js`:

```js
test('built workflow writes .cys/state.json at start, updates it per settle, and deletes it before the final return (Fase 4b)', () => {
  assert.ok(
    output.includes('const taskStates = new Map('),
    'debe existir un registro en memoria del estado de cada tarea'
  );
  assert.ok(
    output.includes('.cys/state.json'),
    'el motor debe escribir/borrar .cys/state.json'
  );
  assert.ok(
    output.includes('async function settle('),
    'settle() debe ser async para poder escribir el estado antes de continuar'
  );
  const deleteIndex = output.indexOf('delete .cys/state.json');
  const returnIndex = output.indexOf('return { results: serializableResults, finalReview, handoff: handoffResult };');
  assert.ok(deleteIndex >= 0, 'debe existir la instrucción de borrar el estado');
  assert.ok(
    deleteIndex < returnIndex,
    'el borrado debe ocurrir antes del return final, para que solo quede el archivo si el script se cortó antes de llegar ahí'
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/build-workflow.test.js`
Expected: FAIL — none of this exists in the template yet.

- [ ] **Step 3: Add the state-tracking map and read/write helpers**

In `workflows-src/parallel-plan-executor.template.js`, find:

```js
const tasksById = new Map(tasks.map((t) => [t.id, t]));
```

Replace with (adds the in-memory state map right after it, initialized to `pending` for every task):

```js
const tasksById = new Map(tasks.map((t) => [t.id, t]));

// Fase 4b: snapshot completo del estado de cada tarea, para que una sesión futura (no
// solo el caché same-session de resumeFromRunId) pueda detectar una corrida cortada y
// recuperar solo lo pendiente. Arranca en 'pending' para todas; se actualiza en cada
// settle() y el archivo se borra al llegar al final natural del script.
const taskStates = new Map(tasks.map((t) => [t.id, { status: 'pending' }]));

function stateJson() {
  const tasksObj = {};
  for (const [id, entry] of taskStates) tasksObj[id] = entry;
  return JSON.stringify({ planPath, repoPath, integrationBranch, tasks: tasksObj }, null, 2);
}

function writeState() {
  return enqueueMainRepo(() => agent(
    `In repo ${repoPath}, write exactly this content to .cys/state.json (create the file ` +
    `and its directory if missing), overwriting anything already there. Write only the ` +
    `content between the <content> tags below, without the tags:\n<content>${stateJson()}</content>`,
    { label: 'state', phase: 'Merge' }
  ));
}

function deleteState() {
  return enqueueMainRepo(() => agent(
    `In repo ${repoPath}, delete .cys/state.json if it exists (the run finished naturally; ` +
    `no incomplete state to report). It's fine if it doesn't exist already.`,
    { label: 'state-clear', phase: 'Handoff' }
  ));
}
```

- [ ] **Step 4: Make `settle()` async, write state on every call**

Find:

```js
const settledTasks = new Set();
function settle(taskId, label) {
  if (settledTasks.has(taskId)) return;
  settledTasks.add(taskId);
  settledCount += 1;
  log(`${progressBar()} — Task ${taskId} (branch task-${taskId}) ${label}`);
}
```

Replace with:

```js
const settledTasks = new Set();
async function settle(taskId, status, label, extra = {}) {
  if (settledTasks.has(taskId)) return;
  settledTasks.add(taskId);
  settledCount += 1;
  taskStates.set(taskId, { status, ...extra });
  log(`${progressBar()} — Task ${taskId} (branch task-${taskId}) ${label}`);
  await writeState();
}
```

- [ ] **Step 5: Update every `settle()` call site to pass a status and `await`**

Find (in `assertNotBlocked`):

```js
  await appendLedger(`Task ${taskId}: ${impl.status} — ${detail}`);
  settle(taskId, impl.status);
  throw new Error(`Task ${taskId} ${impl.status}: ${detail}`);
```

Replace with:

```js
  await appendLedger(`Task ${taskId}: ${impl.status} — ${detail}`);
  await settle(taskId, 'failed', impl.status, { reason: detail });
  throw new Error(`Task ${taskId} ${impl.status}: ${detail}`);
```

Find (in `runTask`'s catch block):

```js
  } catch (error) {
    // Red de seguridad: cualquier salida de executeTask — también las no previstas —
    // cuenta en la barra de progreso; settle es idempotente, así que las ramas que ya
    // settlearon con una etiqueta específica no se cuentan dos veces.
    settle(taskId, 'FAILED');
    throw error;
  }
```

Replace with:

```js
  } catch (error) {
    // Red de seguridad: cualquier salida de executeTask — también las no previstas —
    // cuenta en la barra de progreso; settle es idempotente, así que las ramas que ya
    // settlearon con una etiqueta específica no se cuentan dos veces.
    await settle(taskId, 'failed', 'FAILED', { reason: error?.message ?? String(error) });
    throw error;
  }
```

Find (review still failing after fix round):

```js
      await appendLedger(`Task ${taskId}: blocked — review still failing after one fix round`);
      settle(taskId, 'FAILED (review)');
      throw new Error(`Task ${taskId}: review still failing after one fix round: ${verdict.findings}`);
```

Replace with:

```js
      await appendLedger(`Task ${taskId}: blocked — review still failing after one fix round`);
      await settle(taskId, 'failed', 'FAILED (review)', { reason: verdict.findings });
      throw new Error(`Task ${taskId}: review still failing after one fix round: ${verdict.findings}`);
```

Find (merge conflict):

```js
  if (mergeResult.mergeStatus === 'CONFLICT') {
    await appendLedger(`Task ${taskId}: merge CONFLICT — ${mergeResult.detail ?? 'no detail given'}`);
    settle(taskId, 'FAILED (merge conflict)');
    throw new Error(`Task ${taskId} merge CONFLICT: ${mergeResult.detail ?? 'no detail given'}`);
  }
```

Replace with:

```js
  if (mergeResult.mergeStatus === 'CONFLICT') {
    await appendLedger(`Task ${taskId}: merge CONFLICT — ${mergeResult.detail ?? 'no detail given'}`);
    await settle(taskId, 'failed', 'FAILED (merge conflict)', { reason: mergeResult.detail ?? 'no detail given' });
    throw new Error(`Task ${taskId} merge CONFLICT: ${mergeResult.detail ?? 'no detail given'}`);
  }
```

Find (success path):

```js
  settle(taskId, `done in ${duration}`);
  return impl;
```

Replace with:

```js
  await settle(taskId, 'done', `done in ${duration}`, { branch: `task-${taskId}`, headSha: impl.headSha });
  return impl;
```

- [ ] **Step 6: Write the initial state at the very start, and delete it at the very end**

Find:

```js
const results = await runDag(graph, runTask);
```

Replace with (adds the initial write right before the DAG starts):

```js
await writeState();
const results = await runDag(graph, runTask);
```

Find the final line of the file:

```js
return { results: serializableResults, finalReview, handoff: handoffResult };
```

Replace with:

```js
await deleteState();
return { results: serializableResults, finalReview, handoff: handoffResult };
```

- [ ] **Step 7: Rebuild and run the full suite**

Run: `npm run build`
Expected: `Built <repo>/workflows/parallel-plan-executor.js`

Run: `npm test`
Expected: PASS — everything, including the new test from Step 1.

- [ ] **Step 8: Commit**

```bash
git add workflows-src/parallel-plan-executor.template.js workflows/parallel-plan-executor.js tests/build-workflow.test.js
```

```bash
git commit -m "feat(engine): write .cys/state.json per task, clear it only on natural completion

Presence of .cys/state.json now means specifically 'the script itself
got cut off before finishing' — a task ending failed/skipped through
its own normal flow is not the same as an interrupted run, so the file
is only deleted right before the script's own final return, regardless
of whether every task succeeded. Lays the groundwork for cross-session
recovery (bin/plan-remainder.js, command-side detection)."
```

---

### Task 3: Detect leftover state in `/cys:flow` and `/cys:run-plan`

**Files:**
- Modify: `commands/flow.md`
- Modify: `commands/run-plan.md`
- Test: `tests/skills.test.js`

**Interfaces:**
- Consumes: `bin/plan-remainder.js` (from Task 1), `.cys/state.json` (written by the engine per Task 2).
- Produces: None (command-prompt text only).

- [ ] **Step 1: Write the failing test**

Add to `tests/skills.test.js`:

```js
test('los comandos detectan .cys/state.json de una corrida interrumpida (Fase 4b)', () => {
  const flow = readFileSync(path.join(root, 'commands', 'flow.md'), 'utf8');
  const runPlan = readFileSync(path.join(root, 'commands', 'run-plan.md'), 'utf8');
  assert.ok(
    flow.includes('.cys/state.json'),
    'commands/flow.md debe chequear si hay estado de una corrida interrumpida'
  );
  assert.ok(
    runPlan.includes('.cys/state.json') && runPlan.includes('bin/plan-remainder.js'),
    'commands/run-plan.md debe chequear el estado y ofrecer bin/plan-remainder.js para reanudar'
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/skills.test.js`
Expected: FAIL — neither file mentions `.cys/state.json` yet.

- [ ] **Step 3: Edit `commands/flow.md`**

Find:

```
2. **Sanity-check before designing anything**:
   - `repo-path` exists and is a git repo with a clean working tree
     (`git -C <repo-path> status`). If dirty, tell the user and stop —
     the design/plan stages create commits of their own.
   - If the repo has no `develop` branch, ask the user which branch the
     eventual PR should target before continuing.

3. **Design**: invoke the `cys:design` skill, working against
   `repo-path` (explore ITS files, write the spec under ITS
   `docs/cys/specs/`), not against the session's cwd. The user approving
   the written spec is the gate — if they don't approve, stop; nothing
   launches.

4. **Plan**: invoke the `cys:plan` skill against the approved spec; the
   plan lands under `<repo-path>/docs/cys/plans/`. Commit spec and plan
   in `repo-path` per each skill's own instructions.

5. **Parse the plan**: run `node REPO/bin/parse-plan.js <plan-path>`,
   capturing stdout as JSON (`{ tasks, graph, warnings }`). Show any
   warnings to the user. If parsing errors or the graph is empty, report
   the exact error and stop — don't work around it silently.

6. **Ask what's still missing**, one question at a time:
```

Replace with (inserts a new step 3, renumbers everything from the old step 3 onward by one):

```
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
```

Then find the remaining old steps 7-10 (now needing +1 renumbering to 8-11):

```
7. **Summarize and confirm**: plan path, repo, task count, parallelism
   the graph shows, integration branch, PR settings, authorization text.
   Re-check the working tree is still clean; if the integration branch
   already exists, ask whether to continue on it or pick another name.

8. **Create the integration branch if it doesn't exist**: run
   `git -C <repo-path> show-ref --verify --quiet
   refs/heads/<integration-branch>`. If it exits non-zero, create it from `develop`:
   `git -C <repo-path> branch <integration-branch> develop`. If
   it exits 0, the branch already exists — step 7 already handled
   confirming that with the user, nothing more to do here.

9. **Launch** the `Workflow` tool with:
   - `scriptPath`: `REPO/workflows/parallel-plan-executor.js`
   - `args`: `{ tasks, graph, planPath, repoPath, integrationBranch,
     executorPath: REPO, openPr, pr, mergeAuthorization }` (omit the
     optional ones not provided).

10. **After launching**: tell the user it runs in the background, that
   they can ask "how's the workflow going?" or open `/workflows`, and
   that merges may pause for their permission dialog — a click there is
   expected, not a failure.
```

Replace with:

```
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
```

- [ ] **Step 4: Edit `commands/run-plan.md`**

Find:

```
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
```

Replace with (inserts a new step 2, renumbers everything from the old step 2 onward by one, and step 3 "Parse the plan" becomes conditional):

```
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
   stdout as JSON (`{ tasks, graph, warnings }`). Show any warnings to
   the user — in particular a duplicate-producer warning or an empty
   graph is worth surfacing before launching, not after.

5. **Ask what's still missing**, in plain language, one question at a time:
```

Then find the remaining old steps 5-8 (now needing +1 renumbering to 6-9):

```
5. **Summarize before launching**: plan path, repo, task count, integration branch,
   openPr/PR settings, and confirm the authorization text with the user. This is a real
   run against their repo — don't skip the confirmation.

6. **Create the integration branch if it doesn't exist**: run
   `git -C <repo-path> show-ref --verify --quiet
   refs/heads/<integration-branch>`. If it exits non-zero, create it from `develop`:
   `git -C <repo-path> branch <integration-branch> develop`. If
   it exits 0, the branch already exists — step 2's sanity check already
   covers its naming, nothing more to do here.

7. **Launch**: invoke the `Workflow` tool with:
   - `scriptPath`: `<REPO>/workflows/parallel-plan-executor.js`
   - `args`: `{ tasks, graph, planPath, repoPath, integrationBranch, executorPath: <REPO>, openPr, pr, mergeAuthorization }`
     (executorPath is REPO — the workflow invokes REPO/bin scripts by exact path;
     omit `openPr`/`pr`/`mergeAuthorization` if not provided)

8. **After launching**: tell the user it's running in the background, mention they can
   ask "how's the workflow going?" any time or open `/workflows`, and that you'll report
   back when it finishes or if a merge needs authorization.
```

Replace with:

```
6. **Summarize before launching**: plan path, repo, task count, integration branch,
   openPr/PR settings, and confirm the authorization text with the user. This is a real
   run against their repo — don't skip the confirmation.

7. **Create the integration branch if it doesn't exist**: run
   `git -C <repo-path> show-ref --verify --quiet
   refs/heads/<integration-branch>`. If it exits non-zero, create it from `develop`:
   `git -C <repo-path> branch <integration-branch> develop`. If
   it exits 0, the branch already exists — step 3's sanity check already
   covers its naming, nothing more to do here.

8. **Launch**: invoke the `Workflow` tool with:
   - `scriptPath`: `<REPO>/workflows/parallel-plan-executor.js`
   - `args`: `{ tasks, graph, planPath, repoPath, integrationBranch, executorPath: <REPO>, openPr, pr, mergeAuthorization }`
     (executorPath is REPO — the workflow invokes REPO/bin scripts by exact path;
     omit `openPr`/`pr`/`mergeAuthorization` if not provided)

9. **After launching**: tell the user it's running in the background, mention they can
   ask "how's the workflow going?" any time or open `/workflows`, and that you'll report
   back when it finishes or if a merge needs authorization.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/skills.test.js`
Expected: PASS, including the new test.

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add commands/flow.md commands/run-plan.md tests/skills.test.js
```

```bash
git commit -m "feat(cys): detect leftover .cys/state.json and offer to resume

/cys:run-plan compares the leftover state's planPath against the plan
it's about to run — on a match, it offers bin/plan-remainder.js instead
of starting over. /cys:flow always generates a fresh, uniquely-named
plan, so a match can never happen there; it only surfaces an early
warning before the user re-does design work for what might be the same
interrupted feature."
```
