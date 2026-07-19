# Run Summary Stats Implementation Plan

> **For agentic workers:** execute this plan with the
> parallel-plan-executor Workflow (cys:run / the /cys:run-plan command).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** surface real run stats (task outcomes, inferred parallel
width, sequential-equivalent work vs. wall-clock window) in cys:run's
final summary, per the approved design at
`docs/cys/specs/2026-07-19-run-summary-design.md`.

**Architecture:** one pure function (`computeParallelWidth`) plus its
template wiring — two tasks, second depends on the first.

**Tech Stack:** JavaScript (ESM, Node's built-in test runner).

## Global Constraints

- `workflows/parallel-plan-executor.js` is generated — never hand-edit;
  after touching the template, run `npm run build` and commit both.
- No fabricated "speedup" number — present sequential-equivalent work
  and wall-clock window side by side, nothing computed from them.
- Node >= 20. No new runtime dependencies.
- Commit messages: Conventional Commits, in English.

---

### Task 1: `computeParallelWidth(graph)`

**Files:**
- Modify: `src/graph-builder.js`
- Test: `tests/graph-builder.test.js`

**Interfaces:**
- Consumes: None
- Produces: `computeParallelWidth(graph)`

- [ ] **Step 1: Write the failing tests**

Append to `tests/graph-builder.test.js`:

```js
test('computeParallelWidth: tres tareas independientes da ancho 3', () => {
  assert.equal(computeParallelWidth({ 1: [], 2: [], 3: [] }), 3);
});

test('computeParallelWidth: una cadena lineal da ancho 1', () => {
  assert.equal(computeParallelWidth({ 1: [], 2: [1], 3: [2] }), 1);
});

test('computeParallelWidth: un diamante (2 base + 1 dependiente) da ancho 2', () => {
  assert.equal(computeParallelWidth({ 1: [], 2: [], 3: [1, 2] }), 2);
});

test('computeParallelWidth: grafo vacío da ancho 0', () => {
  assert.equal(computeParallelWidth({}), 0);
});
```

Also add `computeParallelWidth` to the existing import line at the top
of the file (`import { buildGraph, buildGraphWithDiagnostics,
assertAcyclic } from '../src/graph-builder.js';` becomes `import {
buildGraph, buildGraphWithDiagnostics, assertAcyclic,
computeParallelWidth } from '../src/graph-builder.js';`).

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test tests/graph-builder.test.js`
Expected: FAIL — `computeParallelWidth` doesn't exist yet.

- [ ] **Step 3: Write the minimal implementation**

Append to `src/graph-builder.js`:

```js
export function computeParallelWidth(graph) {
  const layer = new Map();
  function layerOf(id) {
    if (layer.has(id)) return layer.get(id);
    const deps = graph[id] ?? [];
    const value = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(layerOf));
    layer.set(id, value);
    return value;
  }
  const counts = new Map();
  for (const id of Object.keys(graph).map(Number)) {
    const l = layerOf(id);
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test tests/graph-builder.test.js`
Expected: PASS — all tests, including the 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/graph-builder.js tests/graph-builder.test.js
git commit -m "feat(graph): add computeParallelWidth, the plan's inferred max concurrent layer size"
```

---

### Task 2: Wire the summary into the template

**Files:**
- Modify: `workflows-src/parallel-plan-executor.template.js`
- Modify: `workflows/parallel-plan-executor.js` (generated — via `npm run build` only)
- Test: `tests/build-workflow.test.js`

**Interfaces:**
- Consumes: `computeParallelWidth(graph)` from Task 1
- Produces: None

- [ ] **Step 1: Write the failing test**

Append to `tests/build-workflow.test.js`:

```js
test('el resumen final incluye conteos de resultado, ancho de paralelismo y trabajo secuencial vs. ventana de pared', () => {
  assert.ok(
    output.includes('computeParallelWidth(graph)'),
    'el resumen debe calcular el ancho de paralelismo inferido del plan'
  );
  assert.ok(
    output.includes('Sequential-equivalent') || output.includes('secuencial'),
    'el resumen debe mostrar el trabajo secuencial equivalente'
  );
  assert.ok(
    !output.includes('speedup') && !output.includes('Nx faster') && !output.includes('veces más rápido'),
    'el resumen no debe inventar un número de speedup — solo mostrar los datos'
  );
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test tests/build-workflow.test.js`
Expected: FAIL — the template doesn't call `computeParallelWidth` or
report duration aggregates yet.

- [ ] **Step 3: Wire the summary**

In `workflows-src/parallel-plan-executor.template.js`, right before the
existing line `log(summaryLines.join('\n'));`, insert:

```js
const doneResults = [...results.values()].filter((r) => r.status === 'done');
const outcomeCounts = {
  done: doneResults.length,
  failed: [...results.values()].filter((r) => r.status === 'failed').length,
  skipped: [...results.values()].filter((r) => r.status === 'skipped').length,
};
const statsLines = [
  `Tasks: ${results.size} total — ${outcomeCounts.done} done, ${outcomeCounts.failed} failed, ${outcomeCounts.skipped} skipped`,
  `Plan's inferred parallel width: ${computeParallelWidth(graph)} (largest set of tasks with no dependency between them)`,
];
if (doneResults.length > 0) {
  const durations = doneResults
    .map((r) => hhmmssToSeconds(r.result?.finishedAt) - hhmmssToSeconds(r.result?.startedAt))
    .map((secs) => (secs < 0 ? secs + 24 * 3600 : secs))
    .filter((secs) => Number.isFinite(secs));
  const sequentialEquivalentSecs = durations.reduce((sum, secs) => sum + secs, 0);
  const starts = doneResults.map((r) => hhmmssToSeconds(r.result?.startedAt)).filter((s) => s !== null);
  const ends = doneResults.map((r) => hhmmssToSeconds(r.result?.finishedAt)).filter((s) => s !== null);
  if (starts.length > 0 && ends.length > 0) {
    let wallClockSecs = Math.max(...ends) - Math.min(...starts);
    if (wallClockSecs < 0) wallClockSecs += 24 * 3600;
    statsLines.push(
      `Sequential-equivalent work (sum of each done task's own duration): ` +
      `${Math.floor(sequentialEquivalentSecs / 60)}m${String(sequentialEquivalentSecs % 60).padStart(2, '0')}s — ` +
      `vs. wall-clock window (first start to last finish): ` +
      `${Math.floor(wallClockSecs / 60)}m${String(wallClockSecs % 60).padStart(2, '0')}s`
    );
  }
}
log(statsLines.join('\n'));
```

- [ ] **Step 4: Regenerate the built workflow**

Run: `npm run build`
Expected: `workflows/parallel-plan-executor.js` is regenerated with
`computeParallelWidth` inlined (already present via the graph-builder
inlining this repo's build already does) and the new summary wiring.

- [ ] **Step 5: Run the test, expect PASS**

Run: `node --test tests/build-workflow.test.js`
Expected: PASS — all tests, including the new one.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — no regressions.

- [ ] **Step 7: Verify the generated file is in sync**

Run: `git diff --exit-code workflows/parallel-plan-executor.js`
Expected: no output before staging (confirms Step 4's build already
produced what's about to be committed).

- [ ] **Step 8: Commit**

```bash
git add workflows-src/parallel-plan-executor.template.js workflows/parallel-plan-executor.js tests/build-workflow.test.js
git commit -m "feat(workflow): summarize run stats (parallel width, task outcomes, sequential-equivalent work vs wall-clock) at the end"
```

---

## Self-review

- **Spec coverage:** `computeParallelWidth` ✓ (tested against 4 known
  graphs), summary wiring ✓ (outcome counts, parallel width, duration
  aggregates, no fabricated speedup — tested for its absence). Both
  design items covered.
- **Placeholder scan:** none — every step's content is complete and
  ready to paste.
- **Type consistency:** `computeParallelWidth`'s signature
  (`(graph) => number`) matches exactly how Task 2 calls it
  (`computeParallelWidth(graph)`, the same `graph` variable already in
  scope in the template).
- **Version/toolchain enforcement:** not applicable — no pinned
  language/runtime version beyond the existing Node >= 20 `engines`
  field.
- **Parser dry-run:** ran `node bin/parse-plan.js
  docs/cys/plans/2026-07-19-run-summary.md` — see result below.
