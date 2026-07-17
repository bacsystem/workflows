# parallel-plan-executor Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable, technology-agnostic Claude Code Workflow script that executes
a `writing-plans`-formatted implementation plan, running independent tasks in parallel via
a dependency DAG inferred from each task's `Consumes`/`Produces` block, instead of one
task at a time.

**Architecture:** A plain Node.js package with three pure, fully-unit-tested modules
(plan parser, dependency-graph builder, generic DAG scheduler) plus a CLI that ties them
together. A build script embeds the tested scheduler source into a Workflow-script
template (the Workflow tool's sandbox has no filesystem/import access, so the final
artifact must be one self-contained file) producing `workflows/parallel-plan-executor.js`
— the actual file passed to the `Workflow` tool.

**Tech Stack:** Node.js 20+ (built-in `node:test`/`node:assert/strict`, ESM modules,
`node:fs`, `node:child_process`), zero runtime dependencies.

## Global Constraints

- Plain JavaScript everywhere — no TypeScript, no build/transpile step beyond the one
  script-assembly step described above.
- `src/*.js` modules use `export`/`import` (real Node ESM) and are directly unit-tested
  with `node --test` — they never run inside the Workflow sandbox directly.
- The final `workflows/parallel-plan-executor.js` (and its `.template.js` source) must
  NOT use `import` statements, `Date.now()`, `Math.random()`, or argless `new Date()` —
  the Workflow tool's sandbox forbids all of these (no filesystem/Node API access, and
  non-determinism breaks resume). The **only** permitted `export` is the required
  `export const meta = {...}` literal header the Workflow tool mandates; any other
  `export` (e.g. `src/scheduler.js`'s own `export async function runDag`) is invalid
  mid-script and must be stripped before embedding.
- `meta` in the workflow template must be a pure literal (no variables/spreads).
- No runtime dependencies (YAGNI) — only Node's built-ins, matching the zero-dependency
  precedent already set by `git-flow`'s `next-version.sh`.
- Every parser/graph/scheduler module is tested against both a synthetic fixture AND a
  real excerpt of `business-core`'s actual plan (`D:\github\business-core\docs\plans\2026-07-04-core-implementation.md`), per the design spec's requirement to validate against a real plan, not only synthetic ones.

---

### Task 1: Repo scaffolding + version smoke test

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `src/version.js`
- Test: `tests/version.test.js`

**Interfaces:**
- Consumes: (none — first task)
- Produces: nothing later tasks consume by name; this task's only deliverable is the
  scaffolding itself (verified by the `VERSION` smoke test) and the `node:fs`-relative-to-
  `import.meta.url` module resolution pattern later modules follow.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "parallel-plan-executor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "test": "node --test tests/",
    "build": "node scripts/build-workflow.js"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
*.log
```

- [ ] **Step 3: Write the failing test**

`tests/version.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/version.js';

test('VERSION matches semver and package.json', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test tests/version.test.js`
Expected: FAIL — `Cannot find module '../src/version.js'`

- [ ] **Step 5: Write minimal implementation**

`src/version.js`:
```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'));

export const VERSION = pkg.version;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tests/version.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore src/version.js tests/version.test.js
git commit -m "chore: scaffold repo with Node test runner"
```

---

### Task 2: Plan parser

**Files:**
- Create: `src/plan-parser.js`
- Create: `tests/fixtures/sample-plan.md`
- Create: `tests/fixtures/business-core-excerpt.md`
- Test: `tests/plan-parser.test.js`

**Interfaces:**
- Consumes: (none)
- Produces: `parsePlan(planText: string) => Array<{ id: number, title: string, files: { create: string[], modify: string[], test: string[] }, interfaces: { consumes: string[], produces: string[] } }>` — used by Task 3 (`buildGraph`) and Task 5 (CLI).

- [ ] **Step 1: Create the synthetic fixture**

`tests/fixtures/sample-plan.md`:
```markdown
# Sample Implementation Plan

### Task 1: Widget core

**Files:**
- Create: `src/widget.js`
- Test: `tests/widget.test.js`

**Interfaces:**
- Consumes:
- Produces: `createWidget(name)`

- [ ] **Step 1: Write the failing test**

### Task 2: Gadget core

**Files:**
- Create: `src/gadget.js`
- Test: `tests/gadget.test.js`

**Interfaces:**
- Consumes:
- Produces: `createGadget(name)`

- [ ] **Step 1: Write the failing test**

### Task 3: Widget-Gadget bridge

**Files:**
- Create: `src/bridge.js`
- Modify: `src/widget.js`
- Test: `tests/bridge.test.js`

**Interfaces:**
- Consumes: `createWidget`, `createGadget`
- Produces: `bridge(widget, gadget)`

- [ ] **Step 1: Write the failing test**
```

- [ ] **Step 2: Create the real-plan excerpt fixture**

Copy the first two task blocks (Task 1 and Task 3, which really do declare
`Produces: httpserver.NewRouter() *chi.Mux` and consume it) from
`D:\github\business-core\docs\plans\2026-07-04-core-implementation.md`
into `tests/fixtures/business-core-excerpt.md` verbatim (same `**Files:**`/`**Interfaces:**`
structure, real project, not invented) — read the source file and copy Task 1's full
block plus Task 5's `**Interfaces:**` block (which consumes `module.Module` produced
conceptually by the contract) to have a second, independently-sourced fixture.

- [ ] **Step 3: Write the failing test**

`tests/plan-parser.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parsePlan } from '../src/plan-parser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const samplePlan = readFileSync(path.join(here, 'fixtures/sample-plan.md'), 'utf8');

test('parses task id, title, files, and interfaces', () => {
  const tasks = parsePlan(samplePlan);
  assert.equal(tasks.length, 3);

  assert.deepEqual(tasks[0], {
    id: 1,
    title: 'Widget core',
    files: { create: ['src/widget.js'], modify: [], test: ['tests/widget.test.js'] },
    interfaces: { consumes: [], produces: ['createWidget'] },
  });

  assert.deepEqual(tasks[2].files, {
    create: ['src/bridge.js'],
    modify: ['src/widget.js'],
    test: ['tests/bridge.test.js'],
  });
  assert.deepEqual(tasks[2].interfaces.consumes.sort(), ['createGadget', 'createWidget']);
});

test('strips line-range suffixes from Modify paths', () => {
  const text = [
    '### Task 1: X',
    '',
    '**Files:**',
    '- Modify: `src/existing.py:123-145`',
    '',
    '**Interfaces:**',
    '- Consumes:',
    '- Produces:',
    '',
    '- [ ] **Step 1: x**',
  ].join('\n');
  const [task] = parsePlan(text);
  assert.deepEqual(task.files.modify, ['src/existing.py']);
});

test('handles a real excerpt from the business-core plan without throwing', () => {
  const excerpt = readFileSync(path.join(here, 'fixtures/business-core-excerpt.md'), 'utf8');
  const tasks = parsePlan(excerpt);
  assert.ok(tasks.length >= 1);
  assert.ok(tasks[0].title.length > 0);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test tests/plan-parser.test.js`
Expected: FAIL — `Cannot find module '../src/plan-parser.js'`

- [ ] **Step 5: Write minimal implementation**

`src/plan-parser.js`:
```js
const TASK_HEADER_RE = /^### Task (\d+): (.+)$/m;

export function parsePlan(planText) {
  const parts = planText.split(TASK_HEADER_RE);
  const tasks = [];
  // parts = [preamble, id1, title1, body1, id2, title2, body2, ...]
  for (let i = 1; i < parts.length; i += 3) {
    const id = Number(parts[i]);
    const title = parts[i + 1].trim();
    const body = parts[i + 2];
    tasks.push({
      id,
      title,
      files: parseFiles(body),
      interfaces: parseInterfaces(body),
    });
  }
  return tasks;
}

function extractSection(body, name) {
  const re = new RegExp(`\\*\\*${name}:\\*\\*\\n([\\s\\S]*?)(?=\\n\\*\\*[A-Z][a-zA-Z]*:\\*\\*|\\n- \\[ \\]|$)`);
  const match = body.match(re);
  return match ? match[1] : '';
}

function parseFiles(body) {
  const section = extractSection(body, 'Files');
  const files = { create: [], modify: [], test: [] };
  for (const line of section.split('\n')) {
    const m = line.match(/^-\s*(Create|Modify|Test):\s*`([^`]+)`/);
    if (!m) continue;
    const kind = m[1].toLowerCase();
    const filePath = m[2].split(':')[0]; // strip trailing ":123-145" line ranges
    files[kind].push(filePath);
  }
  return files;
}

// Heuristic: pulls bare identifiers (dotted names, optional call parens) out of the
// Consumes/Produces prose. Known limitation: a value that wraps onto a second line is
// not captured (Consumes/Produces are matched line-by-line, see below) — a missed
// dependency here fails safe via the scheduler's "possibly blocked, retry" path
// (design spec §6), not a silent incorrect ordering.
const IDENTIFIER_RE = /`?([A-Za-z_][A-Za-z0-9_.]*)\(?/g;

function extractSymbols(line) {
  const symbols = [];
  let m;
  IDENTIFIER_RE.lastIndex = 0;
  while ((m = IDENTIFIER_RE.exec(line))) {
    if (m[1].length > 1) symbols.push(m[1]);
  }
  return symbols;
}

function parseInterfaces(body) {
  const section = extractSection(body, 'Interfaces');
  const interfaces = { consumes: [], produces: [] };
  for (const line of section.split('\n')) {
    const consumes = line.match(/^-\s*Consumes:\s*(.*)$/);
    const produces = line.match(/^-\s*Produces:\s*(.*)$/);
    if (consumes && consumes[1].trim()) interfaces.consumes.push(...extractSymbols(consumes[1]));
    if (produces && produces[1].trim()) interfaces.produces.push(...extractSymbols(produces[1]));
  }
  return interfaces;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tests/plan-parser.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/plan-parser.js tests/plan-parser.test.js tests/fixtures/sample-plan.md tests/fixtures/business-core-excerpt.md
git commit -m "feat: parse writing-plans task blocks into structured data"
```

---

### Task 3: Dependency graph builder

**Files:**
- Create: `src/graph-builder.js`
- Test: `tests/graph-builder.test.js`

**Interfaces:**
- Consumes: `parsePlan` (Task 2) — the test file parses fixtures to get real task arrays; `buildGraph` itself takes the already-parsed `tasks` array as its parameter, not plan text.
- Produces: `buildGraph(tasks: ReturnType<typeof parsePlan>) => Record<number, number[]>` — used by Task 5 (CLI) and Task 6 (workflow template, via `args.graph`).

- [ ] **Step 1: Write the failing test**

`tests/graph-builder.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parsePlan } from '../src/plan-parser.js';
import { buildGraph } from '../src/graph-builder.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('infers dependencies from Produces/Consumes symbols', () => {
  const plan = readFileSync(path.join(here, 'fixtures/sample-plan.md'), 'utf8');
  const tasks = parsePlan(plan);
  const graph = buildGraph(tasks);

  assert.deepEqual(graph[1], []);
  assert.deepEqual(graph[2], []);
  assert.deepEqual(graph[3], [1, 2]);
});

test('infers a dependency from overlapping Files even without a matching symbol', () => {
  const tasks = [
    { id: 1, title: 'A', files: { create: ['src/shared.js'], modify: [], test: [] }, interfaces: { consumes: [], produces: [] } },
    { id: 2, title: 'B', files: { create: [], modify: ['src/shared.js'], test: [] }, interfaces: { consumes: [], produces: [] } },
  ];
  const graph = buildGraph(tasks);
  assert.deepEqual(graph[2], [1]);
});

test('throws on a cyclic dependency', () => {
  const tasks = [
    { id: 1, title: 'A', files: { create: [], modify: [], test: [] }, interfaces: { consumes: ['b'], produces: ['a'] } },
    { id: 2, title: 'B', files: { create: [], modify: [], test: [] }, interfaces: { consumes: ['a'], produces: ['b'] } },
  ];
  assert.throws(() => buildGraph(tasks), /Cycle detected/);
});

test('builds a real graph from a business-core plan excerpt', () => {
  const excerpt = readFileSync(path.join(here, 'fixtures/business-core-excerpt.md'), 'utf8');
  const tasks = parsePlan(excerpt);
  const graph = buildGraph(tasks);
  assert.equal(Object.keys(graph).length, tasks.length);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/graph-builder.test.js`
Expected: FAIL — `Cannot find module '../src/graph-builder.js'`

- [ ] **Step 3: Write minimal implementation**

`src/graph-builder.js`:
```js
export function buildGraph(tasks) {
  const producedBy = new Map(); // symbol -> taskId
  for (const task of tasks) {
    for (const symbol of task.interfaces.produces) {
      if (!producedBy.has(symbol)) producedBy.set(symbol, task.id);
    }
  }

  const deps = new Map(tasks.map((t) => [t.id, new Set()]));
  const fileOwner = new Map(); // filePath -> first taskId to touch it

  for (const task of tasks) {
    for (const symbol of task.interfaces.consumes) {
      const producerId = producedBy.get(symbol);
      if (producerId !== undefined && producerId !== task.id) {
        deps.get(task.id).add(producerId);
      }
    }

    const touchedFiles = [...task.files.create, ...task.files.modify, ...task.files.test];
    for (const file of touchedFiles) {
      const owner = fileOwner.get(file);
      if (owner === undefined) {
        fileOwner.set(file, task.id);
      } else if (owner !== task.id) {
        deps.get(task.id).add(owner);
      }
    }
  }

  const graph = {};
  for (const [taskId, depSet] of deps) {
    graph[taskId] = [...depSet].sort((a, b) => a - b);
  }

  assertAcyclic(graph);
  return graph;
}

function assertAcyclic(graph) {
  const UNVISITED = 0;
  const VISITING = 1;
  const DONE = 2;
  const state = new Map();

  function visit(id, chain) {
    const current = state.get(id) ?? UNVISITED;
    if (current === DONE) return;
    if (current === VISITING) {
      throw new Error(`Cycle detected in plan dependency graph: ${[...chain, id].join(' -> ')}`);
    }
    state.set(id, VISITING);
    for (const dep of graph[id] ?? []) {
      visit(dep, [...chain, id]);
    }
    state.set(id, DONE);
  }

  for (const id of Object.keys(graph).map(Number)) {
    visit(id, []);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/graph-builder.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/graph-builder.js tests/graph-builder.test.js
git commit -m "feat: infer task dependency graph from Produces/Consumes and file overlap"
```

---

### Task 4: Generic DAG scheduler

**Files:**
- Create: `src/scheduler.js`
- Test: `tests/scheduler.test.js`

**Interfaces:**
- Consumes: `buildGraph` (Task 3) — the test constructs graphs directly (plain objects), doesn't need the parser.
- Produces: `runDag(graph: Record<number, number[]>, taskFn: (id: number) => Promise<any>) => Promise<Map<number, { status: 'done'|'failed'|'skipped', result?: any, error?: Error, reason?: string }>>` — used by Task 6 (workflow template, with `taskFn` implemented via `agent()`).

- [ ] **Step 1: Write the failing test**

`tests/scheduler.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDag } from '../src/scheduler.js';

function delay(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

test('runs independent tasks concurrently, dependents after their deps', async () => {
  const graph = { 1: [], 2: [], 3: [1, 2] };
  const order = [];

  const results = await runDag(graph, async (id) => {
    order.push(`start-${id}`);
    await delay(id === 3 ? 5 : 20);
    order.push(`end-${id}`);
    return id * 10;
  });

  assert.equal(results.get(1).status, 'done');
  assert.equal(results.get(1).result, 10);
  assert.equal(results.get(3).result, 30);

  // both independent tasks must have started before either finished
  assert.ok(order.indexOf('start-2') < order.indexOf('end-1'));
  // the dependent task must not start until both deps have ended
  assert.ok(order.indexOf('start-3') > order.indexOf('end-1'));
  assert.ok(order.indexOf('start-3') > order.indexOf('end-2'));
});

test('marks a task failed and its dependents skipped', async () => {
  const graph = { 1: [], 2: [1] };

  const results = await runDag(graph, async (id) => {
    if (id === 1) throw new Error('boom');
    return id;
  });

  assert.equal(results.get(1).status, 'failed');
  assert.equal(results.get(1).error.message, 'boom');
  assert.equal(results.get(2).status, 'skipped');
});

test('independent branches keep running even if one branch fails', async () => {
  const graph = { 1: [], 2: [], 3: [1] };

  const results = await runDag(graph, async (id) => {
    if (id === 1) throw new Error('boom');
    await delay(5);
    return id;
  });

  assert.equal(results.get(2).status, 'done');
  assert.equal(results.get(3).status, 'skipped');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scheduler.test.js`
Expected: FAIL — `Cannot find module '../src/scheduler.js'`

- [ ] **Step 3: Write minimal implementation**

`src/scheduler.js`:
```js
export async function runDag(graph, taskFn) {
  const results = new Map();
  const started = new Map();

  function run(taskId) {
    if (started.has(taskId)) return started.get(taskId);

    const promise = (async () => {
      const deps = graph[taskId] ?? [];
      try {
        await Promise.all(deps.map(run));
      } catch {
        results.set(taskId, { status: 'skipped', reason: 'blocked by a failed dependency' });
        return;
      }

      try {
        const result = await taskFn(taskId);
        results.set(taskId, { status: 'done', result });
      } catch (error) {
        results.set(taskId, { status: 'failed', error });
        throw error;
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

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scheduler.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.js tests/scheduler.test.js
git commit -m "feat: add fine-grained DAG scheduler with skip-on-failed-dependency semantics"
```

---

### Task 5: CLI tool (`bin/parse-plan.js`)

**Files:**
- Create: `bin/parse-plan.js`
- Test: `tests/parse-plan-cli.test.js`

**Interfaces:**
- Consumes: `parsePlan` (Task 2), `buildGraph` (Task 3)
- Produces: a CLI invoked as `node bin/parse-plan.js <plan.md>`, printing `{ tasks, graph }` JSON to stdout — this is what the orchestrating agent runs (via Bash) before invoking the `Workflow` tool, to compute `args.tasks`/`args.graph`.

- [ ] **Step 1: Write the failing test**

`tests/parse-plan-cli.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const cliPath = path.join(root, 'bin', 'parse-plan.js');
const fixturePath = path.join(here, 'fixtures', 'sample-plan.md');

test('CLI prints parsed tasks and graph as JSON', () => {
  const output = execFileSync('node', [cliPath, fixturePath], { encoding: 'utf8' });
  const parsed = JSON.parse(output);

  assert.equal(parsed.tasks.length, 3);
  assert.deepEqual(parsed.graph['3'], [1, 2]);
});

test('CLI exits non-zero with a usage message when no path is given', () => {
  assert.throws(() => execFileSync('node', [cliPath], { encoding: 'utf8' }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/parse-plan-cli.test.js`
Expected: FAIL — `bin/parse-plan.js` does not exist

- [ ] **Step 3: Write minimal implementation**

`bin/parse-plan.js`:
```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parsePlan } from '../src/plan-parser.js';
import { buildGraph } from '../src/graph-builder.js';

const [, , planPath] = process.argv;
if (!planPath) {
  console.error('Usage: node bin/parse-plan.js <path-to-plan.md>');
  process.exit(1);
}

const planText = readFileSync(planPath, 'utf8');
const tasks = parsePlan(planText);
const graph = buildGraph(tasks);

console.log(JSON.stringify({ tasks, graph }, null, 2));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/parse-plan-cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add bin/parse-plan.js tests/parse-plan-cli.test.js
git commit -m "feat: add parse-plan CLI to compute a plan's task graph as JSON"
```

---

### Task 6: Workflow script assembly (template + build step)

**Files:**
- Create: `workflows/parallel-plan-executor.template.js`
- Create: `scripts/build-workflow.js`
- Test: `tests/build-workflow.test.js`

**Interfaces:**
- Consumes: `runDag` (Task 4, embedded by source-text substitution, not import) — the build script reads `src/scheduler.js`'s text and splices it into the template.
- Produces: `workflows/parallel-plan-executor.js` — the file path passed to the `Workflow` tool's `scriptPath`. Consumed by end users per Task 7's README, not by another task in this plan.

- [ ] **Step 1: Write the failing test**

`tests/build-workflow.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

test('build script embeds the scheduler source and strips its export, keeping only the meta export', () => {
  execFileSync('node', [path.join(root, 'scripts', 'build-workflow.js')]);
  const output = readFileSync(path.join(root, 'workflows', 'parallel-plan-executor.js'), 'utf8');

  assert.ok(output.includes('async function runDag('));
  assert.ok(!output.includes('__SCHEDULER_SOURCE__'));
  assert.ok(!output.includes('export async function runDag'));
  assert.equal((output.match(/^export\s/gm) ?? []).length, 1); // only "export const meta"
  assert.ok(output.includes("name: 'parallel-plan-executor'"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/build-workflow.test.js`
Expected: FAIL — `scripts/build-workflow.js` does not exist

- [ ] **Step 3: Write minimal implementation**

This reuses real task-orchestration machinery from an external skill plugin available
at the time (not an ad-hoc reimplementation): each task-agent runs that skill's own
`scripts/task-brief` and `scripts/review-package` via Bash, and the implementer/reviewer
prompts are condensed versions of that skill's `implementer-prompt.md`/
`task-reviewer-prompt.md` templates —
same two-verdict review contract, same DONE/DONE_WITH_CONCERNS/BLOCKED/NEEDS_CONTEXT
status contract, same progress ledger. Two adaptations, because a `Workflow` cannot pause
mid-run for a human the way the main loop does:

- **NEEDS_CONTEXT / BLOCKED:** there's no live controller to answer a question mid-run,
  so both statuses are treated as "blocked" — recorded in the ledger and surfaced in the
  final report for you to resolve afterward, not paused-and-asked.
- **Parallel dispatch:** the skill's own Red Flag against dispatching multiple
  implementers in parallel assumes a shared working tree; `isolation: 'worktree'` on each
  implementer call is what makes it safe here (see design spec §4.3).

`workflows/parallel-plan-executor.template.js`:
```js
export const meta = {
  name: 'parallel-plan-executor',
  description: 'Execute an implementation plan with independent tasks run in parallel via a dependency DAG, reusing task-brief/review-package/ledger machinery',
  phases: [
    { title: 'Implement' },
    { title: 'Review' },
    { title: 'Merge' },
    { title: 'Final review' },
  ],
}

/* __SCHEDULER_SOURCE__ */

const { graph, tasks, planPath, repoPath } = args;
const tasksById = new Map(tasks.map((t) => [t.id, t]));

const FIND_SDD_SCRIPTS =
  'Locate an external plugin\'s task-orchestration scripts directory — search ' +
  'under the Claude Code plugin cache for a path ending in ' +
  '"scripts" that contains task-brief and review-package.';

const IMPLEMENTER_SCHEMA = {
  type: 'object',
  properties: {
    status: { enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT'] },
    branch: { type: 'string' },
    baseSha: { type: 'string' },
    headSha: { type: 'string' },
    commitSummary: { type: 'string' },
    testSummary: { type: 'string' },
    reportFile: { type: 'string' },
    concerns: { type: 'string' },
    startedAt: { type: 'string', description: 'HH:MM:SS wall-clock time when work began (from `date +%H:%M:%S`)' },
    finishedAt: { type: 'string', description: 'HH:MM:SS wall-clock time right before reporting' },
  },
  required: ['status', 'branch', 'baseSha', 'headSha', 'reportFile', 'startedAt', 'finishedAt'],
};

// The Workflow sandbox forbids Date.now()/new Date() (resume determinism), so wall-clock
// times come from the agents themselves (they run `date`); the script only does string
// arithmetic on HH:MM:SS values it was handed.
function hhmmssToSeconds(t) {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function formatDuration(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return 'duration unknown';
  let secs = hhmmssToSeconds(finishedAt) - hhmmssToSeconds(startedAt);
  if (secs < 0) secs += 24 * 3600; // crossed midnight
  return `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}s`;
}

const REVIEWER_SCHEMA = {
  type: 'object',
  properties: {
    specVerdict: { enum: ['PASS', 'FAIL'] },
    qualityVerdict: { enum: ['APPROVED', 'NEEDS_FIXES'] },
    findings: { type: 'string' },
  },
  required: ['specVerdict', 'qualityVerdict', 'findings'],
};

function appendLedger(line) {
  return agent(
    `In repo ${repoPath}, append this exact line to the run's progress ledger ` +
    `(create the file and its directory if missing): "${line}"`,
    { label: 'ledger', phase: 'Merge' }
  );
}

let mergeQueueTail = Promise.resolve();
function enqueueMerge(fn) {
  const next = mergeQueueTail.then(fn, fn);
  mergeQueueTail = next.catch(() => {});
  return next;
}

// Textual progress bar, emitted via log() after every task settles so the user
// sees advancement in the narrator lines without opening /workflows.
let settledCount = 0;
function progressBar() {
  const total = tasks.length;
  const filled = Math.round((settledCount / total) * 20);
  return `[${'#'.repeat(filled)}${'-'.repeat(20 - filled)}] ${settledCount}/${total} tasks settled`;
}

async function implement(task) {
  return agent(
    `You are implementing Task ${task.id}: "${task.title}", from the plan at ${planPath}, ` +
    `in repo ${repoPath}.\n\n` +
    `${FIND_SDD_SCRIPTS} Run: task-brief ${planPath} ${task.id} — it prints your brief ` +
    `file path. Read ONLY that brief file for your requirements, not the whole plan.\n\n` +
    `Read the "## Global Constraints" section from ${planPath} yourself — it binds this task.\n\n` +
    `Your very first action: run \`date +%H:%M:%S\` and report that value as startedAt; run ` +
    `it again right before reporting and use it as finishedAt.\n\n` +
    `Before starting: create and switch to branch task-${task.id} (a fixed, predictable ` +
    `name so a later fix round can find it), then record its parent commit SHA as baseSha.\n\n` +
    `Follow strict test-driven development for every code change. Implement exactly ` +
    `what the brief specifies, write tests, verify RED then GREEN, commit, then self-review ` +
    `(completeness, quality, YAGNI discipline, test hygiene) before reporting.\n\n` +
    `Write your full report (what you built, TDD evidence, files changed, self-review ` +
    `findings) to the run's report path for this task in repo ${repoPath}, then ` +
    `record HEAD's SHA as headSha and report back via the required fields. Use BLOCKED or ` +
    `NEEDS_CONTEXT if you cannot proceed — there is no one to ask mid-run, so describe ` +
    `exactly what's missing in "concerns"; it will be resolved after this run, not now.`,
    { label: `implement-${task.id}`, phase: 'Implement', isolation: 'worktree', schema: IMPLEMENTER_SCHEMA }
  );
}

async function review(task, impl) {
  return agent(
    `You are reviewing Task ${task.id}: "${task.title}" from the plan at ${planPath}. This ` +
    `is a task-scoped gate (spec compliance + code quality), not a merge review.\n\n` +
    `${FIND_SDD_SCRIPTS} Run: review-package ${impl.baseSha} ${impl.headSha} — it prints a ` +
    `diff package file. Read that file once; it is your view of the change, do not re-run git.\n\n` +
    `Read the task brief already written at the run's brief path for this task and the ` +
    `implementer's report at ${impl.reportFile}. Treat the report as unverified claims — ` +
    `verify against the diff.\n\n` +
    `Read the "## Global Constraints" section from ${planPath} yourself — it binds this task.\n\n` +
    `Report: Part 1 spec compliance (Missing/Extra/Misunderstood, file:line) — verdict PASS ` +
    `or FAIL. Part 2 code quality (Critical/Important/Minor findings, file:line) — verdict ` +
    `APPROVED or NEEDS_FIXES. Findings text goes in "findings"; both verdicts are required ` +
    `fields.`,
    { label: `review-${task.id}`, phase: 'Review', schema: REVIEWER_SCHEMA }
  );
}

async function fix(task, impl, findings) {
  return agent(
    `On branch task-${task.id} in repo ${repoPath} (do not create a new worktree — check out ` +
    `that existing branch), fix these review findings for Task ${task.id}: ${findings}\n\n` +
    `Run \`date +%H:%M:%S\` first (startedAt) and again before reporting (finishedAt).\n\n` +
    `Re-run the tests covering your change and append the results to ` +
    `${impl.reportFile}. Report back the new HEAD SHA as headSha (baseSha and branch stay ` +
    `the same).`,
    { label: `fix-${task.id}`, phase: 'Implement', schema: IMPLEMENTER_SCHEMA }
  );
}

async function runTask(taskId) {
  const task = tasksById.get(taskId);
  let impl;
  try {
    impl = await implement(task);
  } catch (error) {
    settledCount += 1;
    log(`${progressBar()} — Task ${taskId} FAILED`);
    throw error;
  }

  if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
    await appendLedger(`Task ${taskId}: ${impl.status} — ${impl.concerns ?? 'no detail given'}`);
    settledCount += 1;
    log(`${progressBar()} — Task ${taskId} ${impl.status}`);
    throw new Error(`Task ${taskId} ${impl.status}: ${impl.concerns ?? 'no detail given'}`);
  }

  let verdict = await review(task, impl);
  if (verdict.qualityVerdict === 'NEEDS_FIXES' || verdict.specVerdict === 'FAIL') {
    log(`Task ${taskId}: review found issues, fixing once`);
    impl = await fix(task, impl, verdict.findings);
    verdict = await review(task, impl);
    if (verdict.qualityVerdict === 'NEEDS_FIXES' || verdict.specVerdict === 'FAIL') {
      await appendLedger(`Task ${taskId}: blocked — review still failing after one fix round`);
      throw new Error(`Task ${taskId}: review still failing after one fix round: ${verdict.findings}`);
    }
  }

  await enqueueMerge(() =>
    agent(
      `Merge branch task-${taskId} into the integration branch of repo ${repoPath}. If there ` +
      `is a real merge conflict, stop and report it — do not resolve it automatically.`,
      { label: `merge-${taskId}`, phase: 'Merge' }
    )
  );
  await appendLedger(
    `Task ${taskId}: complete ${impl.startedAt}..${impl.finishedAt} ` +
    `(${formatDuration(impl.startedAt, impl.finishedAt)}, commits ` +
    `${impl.baseSha.slice(0, 7)}..${impl.headSha.slice(0, 7)}, review clean)`
  );
  settledCount += 1;
  log(`${progressBar()} — Task ${taskId} done in ${formatDuration(impl.startedAt, impl.finishedAt)}`);
  return impl;
}

const results = await runDag(graph, runTask);

const mergedCount = [...results.values()].filter((r) => r.status === 'done').length;
let finalReview = null;
if (mergedCount > 0) {
  finalReview = await agent(
    `Do a broad whole-branch review of repo ${repoPath}'s integration branch against the ` +
    `full plan at ${planPath} (use a code-reviewer ` +
    `template). Check cross-task consistency the per-task reviews couldn't see.`,
    { label: 'final-review', phase: 'Final review', effort: 'high' }
  );
}

const summaryLines = [...results.entries()].map(([id, r]) => {
  if (r.status === 'done') {
    const impl = r.result;
    return `Task ${id}: done in ${formatDuration(impl?.startedAt, impl?.finishedAt)} (${impl?.startedAt}..${impl?.finishedAt})`;
  }
  if (r.status === 'failed') return `Task ${id}: FAILED — ${r.error?.message ?? 'unknown error'}`;
  return `Task ${id}: skipped — ${r.reason}`;
});
log(summaryLines.join('\n'));
if (finalReview) log(`Final whole-branch review:\n${finalReview}`);

return { results: Object.fromEntries(results), finalReview };
```

`scripts/build-workflow.js`:
```js
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const schedulerSource = readFileSync(path.join(root, 'src', 'scheduler.js'), 'utf8')
  .replace(/^export\s+/m, '');

const templatePath = path.join(root, 'workflows', 'parallel-plan-executor.template.js');
const template = readFileSync(templatePath, 'utf8');

const PLACEHOLDER = '/* __SCHEDULER_SOURCE__ */';
if (!template.includes(PLACEHOLDER)) {
  throw new Error(`Template is missing the ${PLACEHOLDER} placeholder`);
}

const output = template.replace(PLACEHOLDER, schedulerSource);

const outputPath = path.join(root, 'workflows', 'parallel-plan-executor.js');
writeFileSync(outputPath, output);
console.log(`Built ${outputPath}`);
```

**Note:** the template's own `export const meta = {...}` line is intentionally left
as-is (the `Workflow` tool's script format requires exactly that literal export — see
the Workflow tool's own documentation of `meta`), only `src/scheduler.js`'s `export` is
stripped since that one gets spliced into the middle of the script, where `export` isn't
valid.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/build-workflow.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workflows/parallel-plan-executor.template.js scripts/build-workflow.js workflows/parallel-plan-executor.js tests/build-workflow.test.js
git commit -m "feat: assemble the final Workflow script from the tested scheduler source"
```

---

### Task 7: README + usage docs

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: `bin/parse-plan.js` (Task 5), `workflows/parallel-plan-executor.js` (Task 6) — documents how to invoke both.
- Produces: (none — terminal task, documentation only)

- [ ] **Step 1: Write the README**

`README.md`:
```markdown
# parallel-plan-executor

A technology-agnostic Claude Code `Workflow` that executes a plan-writing skill's
implementation plan, running independent tasks in parallel via a dependency DAG inferred
from each task's `Consumes`/`Produces` block — instead of one task at a time like a
sequential task-execution skill does by default.

Design spec: `docs/cys/specs/2026-07-04-parallel-plan-executor-design.md`.

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
5. You get a single report at the end. This workflow does **not** open a PR — hand off
   to the `git-flow` skill (`bacsystem/skills`) once you've reviewed the result and
   decided it's ready to ship.

## Usage

```bash
npm install    # no dependencies, just wires up npm scripts
npm test       # run the unit tests
npm run build  # regenerate workflows/parallel-plan-executor.js after any src/ change

# 1. Compute the task graph for your plan
node bin/parse-plan.js /path/to/your-plan.md > /tmp/plan-graph.json

# 2. Ask Claude Code to invoke the Workflow tool with:
#    scriptPath: "<this repo>/workflows/parallel-plan-executor.js"
#    args: { tasks: <the "tasks" field of plan-graph.json>,
#            graph: <the "graph" field of plan-graph.json>,
#            planPath: "/path/to/your-plan.md",
#            repoPath: "/path/to/your/project" }
```

## Known limitations (v1)

- The `Consumes`/`Produces` parser reads one line at a time — a value that wraps onto a
  second line in the plan's prose won't be captured. A missed dependency fails safe: the
  scheduler's "possibly blocked, retry" path (see design spec §6) catches most cases, but
  isn't a substitute for keeping `Consumes`/`Produces` on one line per entry.
- No speculative re-execution of an abnormally slow task (evaluated and deferred, see
  design spec §7) — right-sizing tasks in the plan itself is the current mitigation.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add usage instructions and known limitations"
```
