# Engine Limits Implementation Plan

> **For agentic workers:** execute this plan with the
> parallel-plan-executor Workflow (cys:run / the /cys:run-plan command).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** add an optional concurrency ceiling to `runDag`, warn on a
consumed symbol nobody produces, and make `assertAcyclic` iterative —
per the approved design at
`docs/cys/specs/2026-07-19-engine-limits-design.md`. No default behavior
changes for any existing plan.

**Architecture:** four independent tasks (different files, run in
parallel) plus one final wiring task that consumes what the first two
produce.

**Tech Stack:** JavaScript (ESM, Node's built-in test runner), no new
runtime dependencies.

## Global Constraints

- `workflows/parallel-plan-executor.js` is generated — never hand-edit;
  after touching the template, run `npm run build` and commit both.
- No new runtime dependencies. Node >= 20.
- Commit messages: Conventional Commits, in English.
- Every new warning/validation stays a warning or a validation error,
  never changes exit behavior for a plan that was valid before this plan.

---

### Task 1: Optional `maxConcurrency` in `runDag`

**Files:**
- Modify: `src/scheduler.js`
- Test: `tests/scheduler.test.js`

**Interfaces:**
- Consumes: None
- Produces: `runDag(graph, taskFn, options)` — third param `options.maxConcurrency` (default `Infinity`)

- [ ] **Step 1: Write the failing tests**

Append to `tests/scheduler.test.js`:

```js
test('caps concurrency at maxConcurrency', async () => {
  const graph = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  let running = 0;
  let peak = 0;

  await runDag(graph, async (id) => {
    running++;
    peak = Math.max(peak, running);
    await delay(10);
    running--;
    return id;
  }, { maxConcurrency: 2 });

  assert.equal(peak, 2);
});

test('maxConcurrency: 1 over a chain preserves topological order', async () => {
  const graph = { 1: [], 2: [1], 3: [2] };
  const order = [];

  await runDag(graph, async (id) => {
    order.push(id);
    await delay(5);
  }, { maxConcurrency: 1 });

  assert.deepEqual(order, [1, 2, 3]);
});

test('no options means unlimited concurrency, same as before this change', async () => {
  const graph = { 1: [], 2: [], 3: [] };
  let running = 0;
  let peak = 0;

  await runDag(graph, async () => {
    running++;
    peak = Math.max(peak, running);
    await delay(10);
    running--;
  });

  assert.equal(peak, 3);
});

test('a diamond completes without deadlock under maxConcurrency: 2', async () => {
  const graph = { 1: [], 2: [], 3: [1, 2] };

  const results = await runDag(graph, async (id) => {
    await delay(5);
    return id;
  }, { maxConcurrency: 2 });

  assert.equal(results.get(3).status, 'done');
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test tests/scheduler.test.js`
Expected: FAIL — `runDag` doesn't accept a third argument yet, so
`maxConcurrency: 2` has no effect and the peak-concurrency tests fail
their assertion.

- [ ] **Step 3: Write the minimal implementation**

Replace the full contents of `src/scheduler.js`:

```js
export async function runDag(graph, taskFn, options = {}) {
  const { maxConcurrency = Infinity } = options;
  const results = new Map();
  const started = new Map();

  let available = maxConcurrency;
  const waiters = [];
  const acquire = () => (available > 0
    ? (available--, Promise.resolve())
    : new Promise((resolve) => waiters.push(resolve)));
  const release = () => {
    const next = waiters.shift();
    if (next) next();
    else available++;
  };

  function run(taskId) {
    if (started.has(taskId)) return started.get(taskId);

    const promise = (async () => {
      const deps = graph[taskId] ?? [];
      const depOutcomes = await Promise.allSettled(deps.map(run));
      const blockedIndex = depOutcomes.findIndex((outcome) => outcome.status === 'rejected');
      if (blockedIndex !== -1) {
        const blockedBy = deps[blockedIndex];
        // El bloqueador pudo haber fallado él mismo o haber sido skipped por su propia
        // dependencia; el motivo distingue ambos casos y propaga la causa raíz original,
        // no el eslabón intermedio de la cascada.
        const blocker = results.get(blockedBy);
        const rootCauseId = blocker?.status === 'skipped' ? blocker.rootCauseId : blockedBy;
        const reason = blocker?.status === 'skipped'
          ? `blocked by a skipped dependency (task ${blockedBy}); root cause: task ${rootCauseId} failed`
          : `blocked by a failed dependency (task ${blockedBy})`;
        results.set(taskId, { status: 'skipped', reason, rootCauseId });
        throw new Error(`task ${taskId} skipped: ${reason}`);
      }

      // El slot de concurrencia se toma acá, después de resolver dependencias — nunca
      // alrededor del await de arriba. Gatear la espera de dependencias dejaría una tarea
      // bloqueada ocupando un slot que sus propias dependencias podrían necesitar: deadlock.
      await acquire();
      try {
        const result = await taskFn(taskId);
        results.set(taskId, { status: 'done', result });
      } catch (error) {
        results.set(taskId, { status: 'failed', error });
        throw error;
      } finally {
        release();
      }
    })();

    started.set(taskId, promise);
    return promise;
  }

  const allIds = Object.keys(graph).map(Number);
  await Promise.allSettled(allIds.map(run));
  return results;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test tests/scheduler.test.js`
Expected: PASS — all tests, including the 5 pre-existing ones (unchanged
behavior with no `options`) and the 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.js tests/scheduler.test.js
git commit -m "feat(scheduler): add optional maxConcurrency limit to runDag"
```

---

### Task 2: Warn when a consumed symbol has no producer

**Files:**
- Modify: `src/graph-builder.js`
- Test: `tests/graph-builder.test.js`

**Interfaces:**
- Consumes: None
- Produces: None

- [ ] **Step 1: Write the failing tests**

Append to `tests/graph-builder.test.js`:

```js
test('advierte cuando una tarea consume un símbolo que nadie produce', () => {
  const tasks = [{
    id: 1, title: 'A',
    files: { create: [], modify: [], test: [] },
    interfaces: { consumes: ['noExiste'], produces: [] },
  }];
  const { warnings } = buildGraphWithDiagnostics(tasks);
  assert.match(warnings.join('\n'), /task 1.*noExiste.*no task produces it/i);
});

test('no advierte cuando el símbolo consumido sí tiene productor', () => {
  const tasks = [
    { id: 1, title: 'A', files: { create: [], modify: [], test: [] }, interfaces: { consumes: [], produces: ['foo'] } },
    { id: 2, title: 'B', files: { create: [], modify: [], test: [] }, interfaces: { consumes: ['foo'], produces: [] } },
  ];
  const { warnings } = buildGraphWithDiagnostics(tasks);
  assert.equal(warnings.filter((w) => /produces it/i.test(w)).length, 0);
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test tests/graph-builder.test.js`
Expected: FAIL — no warning is pushed today for an unproduced consumed
symbol, so `warnings.join('\n')` won't match.

- [ ] **Step 3: Write the minimal implementation**

In `src/graph-builder.js`, inside `buildGraphWithDiagnostics`, replace:

```js
    for (const symbol of task.interfaces.consumes) {
      const producerId = producedBy.get(symbol);
      if (producerId !== undefined && producerId !== task.id) {
        deps.get(task.id).add(producerId);
      }
    }
```

with:

```js
    for (const symbol of task.interfaces.consumes) {
      const producerId = producedBy.get(symbol);
      if (producerId === undefined) {
        // Igual de silencioso que un typo hasta ahora: la tarea sigue sin esa dependencia
        // y nadie se entera. No es error — un símbolo ya presente en el repo antes del
        // plan es un consumo legítimo sin productor — pero merece el mismo aviso que ya
        // existe para un productor duplicado o un valor vacío.
        warnings.push(
          `Task ${task.id} consumes \`${symbol}\` but no task produces it — ` +
          `likely a typo or a missing producer task; no dependency was created`
        );
        continue;
      }
      if (producerId !== task.id) {
        deps.get(task.id).add(producerId);
      }
    }
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test tests/graph-builder.test.js`
Expected: PASS — all tests, including the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/graph-builder.js tests/graph-builder.test.js
git commit -m "feat(graph): warn when a consumed symbol has no producer"
```

---

### Task 3: Iterative `assertAcyclic`

**Files:**
- Modify: `src/graph-builder.js`
- Test: `tests/graph-builder.test.js`

**Interfaces:**
- Consumes: None
- Produces: None

Same file as Task 2 — the executor serializes this after Task 2 even
without an explicit `Consumes`/`Produces` link.

- [ ] **Step 1: Write the test**

Append to `tests/graph-builder.test.js`:

```js
test('assertAcyclic maneja una cadena lineal larga sin fallar (guarda de regresión, no reproduce un desborde real hoy: ni 8M de tareas encadenadas revienta la pila recursiva en este entorno — igual se adopta la versión iterativa como defensa en profundidad para entornos con stack más chico)', () => {
  const LENGTH = 50000;
  const graph = {};
  graph[0] = [];
  for (let i = 1; i < LENGTH; i++) graph[i] = [i - 1];

  assert.doesNotThrow(() => assertAcyclic(graph));
});
```

- [ ] **Step 2: Confirm this doesn't reproduce a crash today (verified, not assumed)**

Empirically checked before writing this plan: the *current* recursive
`assertAcyclic` does not overflow the stack even at chains up to 8
million tasks in this environment (this V8 build appears to optimize
this particular recursive shape well beyond what a naive stack-depth
estimate would predict). So there is no real RED step here — the test
above passes against both the old and new implementation. This item is
included anyway on the user's explicit call, as defense-in-depth for a
platform/environment with a smaller stack (a constrained container, a
different OS), not because a failure was reproduced. Run
`node --test tests/graph-builder.test.js` now to confirm it passes
before touching `assertAcyclic` — this is the baseline, not a red bar.

- [ ] **Step 3: Write the minimal implementation**

Replace the full contents of `assertAcyclic` in `src/graph-builder.js`:

```js
export function assertAcyclic(graph) {
  const UNVISITED = 0;
  const VISITING = 1;
  const DONE = 2;
  const state = new Map();

  for (const startId of Object.keys(graph).map(Number)) {
    if (state.get(startId) === DONE) continue;

    // Pila explícita en vez de recursión: cada frame lleva el id y un cursor sobre sus
    // dependencias, para poder "volver" a la mitad de un nodo sin usar la pila de
    // llamadas de JS — una cadena de miles de tareas encadenadas no debe reventarla.
    const stack = [{ id: startId, depIndex: 0, chain: [] }];
    state.set(startId, VISITING);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const deps = graph[frame.id] ?? [];

      if (frame.depIndex >= deps.length) {
        state.set(frame.id, DONE);
        stack.pop();
        continue;
      }

      const dep = deps[frame.depIndex];
      frame.depIndex++;

      const depState = state.get(dep) ?? UNVISITED;
      if (depState === DONE) continue;
      if (depState === VISITING) {
        throw new Error(`Cycle detected in plan dependency graph: ${[...frame.chain, frame.id, dep].join(' -> ')}`);
      }

      state.set(dep, VISITING);
      stack.push({ id: dep, depIndex: 0, chain: [...frame.chain, frame.id] });
    }
  }
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test tests/graph-builder.test.js`
Expected: PASS — all tests, including the two pre-existing cycle tests
(`assertAcyclic detecta un ciclo...`, `assertAcyclic acepta un DAG
válido...`) and the new long-chain test.

- [ ] **Step 5: Commit**

```bash
git add src/graph-builder.js tests/graph-builder.test.js
git commit -m "refactor(graph): make assertAcyclic iterative to avoid stack depth limits on long chains"
```

---

### Task 4: `maxConcurrency` validation in `validateWorkflowArgs`

**Files:**
- Modify: `src/validate-args.js`
- Test: `tests/validate-args.test.js`

**Interfaces:**
- Consumes: None
- Produces: `validateWorkflowArgs` accepts and validates `args.maxConcurrency`

- [ ] **Step 1: Write the failing tests**

Append to `tests/validate-args.test.js`:

```js
test('acepta maxConcurrency ausente, Infinity, o un entero positivo', () => {
  const tasks = [{ id: 1, title: 'A' }];
  const graph = { 1: [] };
  assert.doesNotThrow(() => validateWorkflowArgs({ tasks, graph, ...BRANCH }));
  assert.doesNotThrow(() => validateWorkflowArgs({ tasks, graph, ...BRANCH, maxConcurrency: Infinity }));
  assert.doesNotThrow(() => validateWorkflowArgs({ tasks, graph, ...BRANCH, maxConcurrency: 3 }));
});

test('rechaza maxConcurrency inválido', () => {
  const tasks = [{ id: 1, title: 'A' }];
  const graph = { 1: [] };
  assert.throws(() => validateWorkflowArgs({ tasks, graph, ...BRANCH, maxConcurrency: 0 }), /maxConcurrency/);
  assert.throws(() => validateWorkflowArgs({ tasks, graph, ...BRANCH, maxConcurrency: -1 }), /maxConcurrency/);
  assert.throws(() => validateWorkflowArgs({ tasks, graph, ...BRANCH, maxConcurrency: 2.5 }), /maxConcurrency/);
  assert.throws(() => validateWorkflowArgs({ tasks, graph, ...BRANCH, maxConcurrency: 'a lot' }), /maxConcurrency/);
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test tests/validate-args.test.js`
Expected: FAIL — `validateWorkflowArgs` doesn't destructure or validate
`maxConcurrency` yet, so the reject cases don't throw.

- [ ] **Step 3: Write the minimal implementation**

In `src/validate-args.js`, add `maxConcurrency` to the destructured
parameter list:

```js
export function validateWorkflowArgs({ tasks, graph, integrationBranch, executorPath, openPr, pr, mergeAuthorization, finishOnly, maxConcurrency }) {
```

and add this check right after the existing `mergeAuthorization` check:

```js
  if (
    maxConcurrency !== undefined &&
    maxConcurrency !== Infinity &&
    (!Number.isInteger(maxConcurrency) || maxConcurrency < 1)
  ) {
    // Un tope inválido (0, negativo, no entero, no numérico) dejaría el semáforo de
    // runDag en un estado que nunca libera slots o que nunca los otorga — mejor fallar
    // rápido acá que deadlockear después de haber lanzado agentes.
    throw new Error('args.maxConcurrency must be Infinity or a positive integer when present');
  }
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test tests/validate-args.test.js`
Expected: PASS — all tests, including the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/validate-args.js tests/validate-args.test.js
git commit -m "feat(validate-args): validate optional maxConcurrency"
```

---

### Task 5: Wire `maxConcurrency` through the template and document it

**Files:**
- Modify: `workflows-src/parallel-plan-executor.template.js`
- Modify: `workflows/parallel-plan-executor.js` (generated — via `npm run build` only)
- Modify: `README.md`
- Modify: `README.es.md`
- Test: `tests/build-workflow.test.js`

**Interfaces:**
- Consumes: `runDag(graph, taskFn, options)` from Task 1, `validateWorkflowArgs` accepting `maxConcurrency` from Task 4
- Produces: None

- [ ] **Step 1: Write the failing test**

Append to `tests/build-workflow.test.js`:

```js
test('el template pasa args.maxConcurrency a runDag', () => {
  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  assert.match(
    template,
    /runDag\(graph, runTask, \{\s*maxConcurrency: args\.maxConcurrency\s*\}\)/,
    'runDag debe recibir el maxConcurrency del usuario, no ignorarlo'
  );
});
```

(If `TEMPLATE_PATH` isn't already a constant in this file, use whatever
existing constant/helper the file already uses to read the template —
confirmed at implementation time by checking the file's top imports.)

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test tests/build-workflow.test.js`
Expected: FAIL — the template still calls `runDag(graph, runTask)` with
no third argument.

- [ ] **Step 3: Wire the template**

In `workflows-src/parallel-plan-executor.template.js`, line 24, add
`maxConcurrency` to the destructured `resolvedArgs`:

```js
const { graph, tasks, planPath, repoPath, integrationBranch, executorPath, openPr, pr, mergeAuthorization, finishOnly, maxConcurrency } = resolvedArgs;
```

and add it to the `validateWorkflowArgs` call right below:

```js
validateWorkflowArgs({ tasks, graph, integrationBranch, executorPath, openPr, pr, mergeAuthorization, finishOnly, maxConcurrency }); // falla rápido y claro, nunca deadlock
```

Then replace the `runDag` call:

```js
  results = await runDag(graph, runTask);
```

with:

```js
  results = await runDag(graph, runTask, { maxConcurrency: args.maxConcurrency });
```

- [ ] **Step 4: Regenerate the built workflow**

Run: `npm run build`
Expected: `workflows/parallel-plan-executor.js` is regenerated with the
scheduler/graph-builder/validate-args changes from Tasks 1–4 and the
template wiring from this step, all inlined.

- [ ] **Step 5: Document it in both READMEs**

Add to `README.md`, in the args table/section that documents
`mergeAuthorization`/`openPr` (confirmed exact heading at implementation
time — insert alongside the other optional `args` fields):

```markdown
- `maxConcurrency` (optional, default unlimited): caps how many tasks
  `cys:run` executes at once within a DAG layer. The Claude Code
  `Workflow` tool already queues excess `agent()` calls beyond its own
  `min(16, cores-2)` cap, so this is mainly useful to go *lower* than
  that — e.g. to avoid many simultaneous local git worktrees on your own
  machine for a plan with a wide layer of independent tasks.
```

Add the equivalent to `README.es.md`:

```markdown
- `maxConcurrency` (opcional, default ilimitado): acota cuántas tareas
  ejecuta `cys:run` a la vez dentro de una capa del DAG. La tool
  `Workflow` de Claude Code ya encola las llamadas a `agent()` que
  exceden su propio tope de `min(16, cores-2)`, así que esto sirve
  sobre todo para ir *más abajo* de ese default — por ejemplo, para
  evitar muchos worktrees locales simultáneos en tu propia máquina
  cuando un plan tiene una capa ancha de tareas independientes.
```

- [ ] **Step 6: Run the template test, expect PASS**

Run: `node --test tests/build-workflow.test.js`
Expected: PASS — all tests, including the new one.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS — no regressions.

- [ ] **Step 8: Verify the generated file is committed and in sync**

Run: `git diff --exit-code workflows/parallel-plan-executor.js`
Expected: no output before staging (confirms Step 4's `npm run build`
already produced the file that's about to be committed — this is the
same check CI runs).

- [ ] **Step 9: Commit**

```bash
git add workflows-src/parallel-plan-executor.template.js workflows/parallel-plan-executor.js README.md README.es.md tests/build-workflow.test.js
git commit -m "feat(workflow): expose maxConcurrency as an optional arg"
```

---

## Self-review

- **Spec coverage:** A1 (maxConcurrency in `runDag` ✓, validated ✓, wired
  ✓, documented ✓), A2 (orphan-consumer warning ✓), A3 (iterative
  `assertAcyclic` ✓) — every item from the design spec maps to a task.
- **Placeholder scan:** none — every step's content is complete. Step 1
  of Task 5 has one explicit "confirmed at implementation time" note for
  a constant name that depends on `tests/build-workflow.test.js`'s
  current internals, not a placeholder for missing logic.
- **Type consistency:** `runDag`'s new third parameter (Task 1) and the
  template's call site (Task 5) use the identical shape,
  `{ maxConcurrency }`; `validateWorkflowArgs`'s new parameter name
  (Task 4) matches what the template destructures and forwards (Task 5).
- **Version/toolchain enforcement:** not applicable — no language/runtime
  version pinned beyond the existing Node >= 20 `engines` field.
- **Exhaustive-coverage claims:** none of this plan's language claims
  full table/enumeration coverage, so no per-row test obligation applies.
- **Parser dry-run:** ran `node bin/parse-plan.js
  docs/cys/plans/2026-07-19-engine-limits.md` — see result below.
