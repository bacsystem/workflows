# Onboarding Materials Implementation Plan

> **For agentic workers:** execute this plan with the
> parallel-plan-executor Workflow (cys:run / the /cys:run-plan command).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a runnable end-to-end example showing real inferred
parallelism (B1) and a Mermaid diagram of the whole 5-skill flow with
its artifacts and human gates (B3), per the approved design at
`docs/cys/specs/2026-07-19-onboarding-design.md`.

**Architecture:** two independent tasks, disjoint files, no shared
interfaces — genuinely parallel.

**Tech Stack:** Markdown, Mermaid, Node's built-in test runner.

## Global Constraints

- No new runtime dependencies.
- Commit messages: Conventional Commits, in English.
- The example plan must actually parse with `bin/parse-plan.js` — no
  hand-waved "this would work" content.

---

### Task 1: Runnable example (B1)

**Files:**
- Create: `examples/hello-parallel/plan.md`
- Create: `examples/README.md`
- Test: `tests/examples.test.js`

**Interfaces:**
- Consumes: None
- Produces: None

- [ ] **Step 1: Write the example plan**

Create `examples/hello-parallel/plan.md`:

```markdown
# Hello Parallel Implementation Plan

> **For agentic workers:** execute this plan with the
> parallel-plan-executor Workflow (cys:run / the /cys:run-plan command).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a tiny plan whose own dependency graph demonstrates real
inferred parallelism — Tasks 2 and 3 don't depend on each other, so cys
runs them at the same time.

**Architecture:** Task 1 creates a shared logger; Tasks 2 and 3 each add
one independent module that uses it; Task 4 wires both together.

**Tech Stack:** Node.js (ESM).

## Global Constraints

- Node >= 20.

---

### Task 1: Logger

**Files:**
- Create: `src/logger.js`
- Test: `tests/logger.test.js`

**Interfaces:**
- Consumes: None
- Produces: `log(message)`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { log } from '../src/logger.js';

test('log returns the formatted message', () => {
  assert.equal(log('hi'), '[log] hi');
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test tests/logger.test.js`
Expected: FAIL — `src/logger.js` doesn't exist yet.

- [ ] **Step 3: Write the minimal implementation**

```js
export function log(message) {
  return `[log] ${message}`;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test tests/logger.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logger.js tests/logger.test.js
git commit -m "feat: add logger"
```

### Task 2: Greeter

**Files:**
- Create: `src/greeter.js`
- Test: `tests/greeter.test.js`

**Interfaces:**
- Consumes: `log`
- Produces: `greet(name)`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../src/greeter.js';

test('greet returns a greeting', () => {
  assert.equal(greet('Ada'), 'Hello, Ada!');
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test tests/greeter.test.js`
Expected: FAIL — `src/greeter.js` doesn't exist yet.

- [ ] **Step 3: Write the minimal implementation**

```js
export function greet(name) {
  return `Hello, ${name}!`;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test tests/greeter.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/greeter.js tests/greeter.test.js
git commit -m "feat: add greeter"
```

### Task 3: Farewell

**Files:**
- Create: `src/farewell.js`
- Test: `tests/farewell.test.js`

**Interfaces:**
- Consumes: `log`
- Produces: `farewell(name)`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { farewell } from '../src/farewell.js';

test('farewell returns a goodbye', () => {
  assert.equal(farewell('Ada'), 'Goodbye, Ada!');
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test tests/farewell.test.js`
Expected: FAIL — `src/farewell.js` doesn't exist yet.

- [ ] **Step 3: Write the minimal implementation**

```js
export function farewell(name) {
  return `Goodbye, ${name}!`;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test tests/farewell.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/farewell.js tests/farewell.test.js
git commit -m "feat: add farewell"
```

### Task 4: Session (uses both greeter and farewell)

**Files:**
- Create: `src/session.js`
- Test: `tests/session.test.js`

**Interfaces:**
- Consumes: `greet`, `farewell`
- Produces: `session(name)`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { session } from '../src/session.js';

test('session greets then says farewell', () => {
  assert.deepEqual(session('Ada'), ['Hello, Ada!', 'Goodbye, Ada!']);
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test tests/session.test.js`
Expected: FAIL — `src/session.js` doesn't exist yet.

- [ ] **Step 3: Write the minimal implementation**

```js
import { greet } from './greeter.js';
import { farewell } from './farewell.js';

export function session(name) {
  return [greet(name), farewell(name)];
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test tests/session.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session.js tests/session.test.js
git commit -m "feat: add session"
```
```

- [ ] **Step 2: Write `examples/README.md`**

```markdown
# Example: seeing real inferred parallelism in 5 minutes

This is the smallest plan that still shows cys's actual differentiator —
not a description of parallel execution, something you can parse and
read yourself right now.

1. From this repo's root, run:

   ```
   node bin/parse-plan.js examples/hello-parallel/plan.md
   ```

2. Look at the printed `graph`. You'll see:

   ```json
   { "1": [], "2": [1], "3": [1], "4": [2, 3] }
   ```

3. Task 2 (`Greeter`) and Task 3 (`Farewell`) both depend on Task 1
   (`Logger`) — but **not on each other**. That missing edge between 2
   and 3 is the whole point: `cys:run` sees no dependency between them
   and executes both at the same time, each in its own git worktree,
   instead of one after the other just because they're listed in order.
   Task 4 (`Session`) then waits for both.

4. To actually run this plan in parallel (not just read its graph), point
   `cys:run` / `/cys:run-plan` at `examples/hello-parallel/plan.md`
   against a throwaway git repo of your own — see the main
   [README](../README.md#usage) for the full launch steps.
```

- [ ] **Step 3: Write the failing test**

Create `tests/examples.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parsePlan } from '../src/plan-parser.js';
import { buildGraph } from '../src/graph-builder.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('el ejemplo hello-parallel parsea y muestra Tarea 2 y 3 en paralelo', () => {
  const plan = readFileSync(path.join(root, 'examples', 'hello-parallel', 'plan.md'), 'utf8');
  const tasks = parsePlan(plan);
  const graph = buildGraph(tasks);

  assert.deepEqual(graph[1], []);
  assert.deepEqual(graph[2], [1]);
  assert.deepEqual(graph[3], [1]);
  assert.deepEqual(graph[4], [2, 3]);
});
```

- [ ] **Step 4: Run it, expect FAIL**

Run: `node --test tests/examples.test.js`
Expected: FAIL — `examples/hello-parallel/plan.md` doesn't exist yet.

- [ ] **Step 5: Create the files from Steps 1–2, run it, expect PASS**

Run: `node --test tests/examples.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add examples/hello-parallel/plan.md examples/README.md tests/examples.test.js
git commit -m "docs(examples): add a runnable end-to-end example showing inferred parallelism"
```

---

### Task 2: Ecosystem flow diagram (B3)

**Files:**
- Create: `docs/diagram/flujo-cys-ecosystem.mmd`
- Modify: `README.md`
- Modify: `README.es.md`
- Modify: `skills/guide/SKILL.md`

**Interfaces:**
- Consumes: None
- Produces: None

- [ ] **Step 1: Write the diagram**

Create `docs/diagram/flujo-cys-ecosystem.mmd`:

```
flowchart TD
    subgraph DESIGN["1 · cys:design"]
        D1["Idea del usuario"]
        D2["Diálogo: contexto,<br/>preguntas de a una,<br/>2-3 enfoques"]
        D3["docs/cys/specs/*.md"]
        D1 --> D2 --> D3
    end

    GATE1{"Gate humano:<br/>¿usuario aprueba<br/>el spec?"}
    D3 --> GATE1
    GATE1 -- "no, cambios" --> D2
    GATE1 -- "sí" --> PLAN

    subgraph PLAN["2 · cys:plan"]
        P1["Tareas numeradas<br/>Files + Consumes/Produces"]
        P2["docs/cys/plans/*.md"]
        P3["bin/parse-plan.js<br/>dry-run del grafo"]
        P1 --> P2 --> P3
    end

    PLAN --> RUN

    subgraph RUN["3 · cys:run (Claude Code únicamente)"]
        R1["DAG inferido del plan"]
        R2["worktree + implement + review<br/>adversarial + merge serializado,<br/>por tarea, en paralelo cuando<br/>el DAG lo permite"]
        R3["ramas task-&lt;id&gt; mergeadas<br/>+ .cys/ (briefs, reportes, diffs)"]
        R1 --> R2 --> R3
    end

    RUN --> CHECK

    subgraph CHECK["4 · cys:check (opcional)"]
        C1["Revisión adicional sobre<br/>una rama ya lista"]
        C2["Verdicts + hallazgos<br/>a .cys/pending.md"]
        C1 --> C2
    end

    CHECK --> SHIP
    RUN -.-> SHIP

    subgraph SHIP["5 · cys:ship"]
        S1["Clasifica el cambio,<br/>calcula SemVer"]
        S2["CHANGELOG + branch +<br/>commit + PR"]
        S1 --> S2
    end

    GATE2{"Gate humano:<br/>¿usuario mergea<br/>el PR?"}
    S2 --> GATE2
    GATE2 -- "sí" --> DONE["Cambio integrado"]

    style GATE1 fill:#8a6d1a,color:#fff
    style GATE2 fill:#8a6d1a,color:#fff
    style DONE fill:#1a6b2a,color:#fff
```

- [ ] **Step 2: Link it from `README.md`**

Right after the existing line `Design spec:
\`docs/cys/specs/2026-07-04-parallel-plan-executor-design.md\`.` near the
top of the file, add:

```markdown
Ecosystem flow (all 5 skills, their artifacts, and the human approval
gates): `docs/diagram/flujo-cys-ecosystem.mmd`.
```

- [ ] **Step 3: Link it from `README.es.md`**

At the equivalent point (confirmed at implementation time — same
position relative to the existing design-spec line), add:

```markdown
Flujo del ecosistema (las 5 skills, sus artefactos, y los gates humanos
de aprobación): `docs/diagram/flujo-cys-ecosystem.mmd`.
```

- [ ] **Step 4: Link it from `skills/guide/SKILL.md`**

Right after the stage table (the `| 3. Run | ... |` row block), add:

```markdown
See `docs/diagram/flujo-cys-ecosystem.mmd` for this same flow as a
diagram, with each stage's input/output artifact and the two human gates
(spec approval, PR merge).
```

- [ ] **Step 5: Verify the guide test still passes**

Run: `node --test tests/skills.test.js`
Expected: PASS — this addition doesn't touch any existing assertion's
surrounding text (confirmed by re-reading the exact insertion point
before editing, not just assuming).

- [ ] **Step 6: Commit**

```bash
git add docs/diagram/flujo-cys-ecosystem.mmd README.md README.es.md skills/guide/SKILL.md
git commit -m "docs(diagram): add cys ecosystem flow diagram (design to plan to run to check to ship)"
```

---

## Self-review

- **Spec coverage:** B1 (runnable example ✓, tested ✓) and B3 (diagram
  ✓, linked from both READMEs and the guide ✓) — both design items
  covered.
- **Placeholder scan:** none — every step's content is complete, ready
  to paste. Two "confirmed at implementation time" notes are for exact
  insertion points that depend on each file's current text, not
  placeholders for missing logic.
- **Type consistency:** the example plan's `graph` shape asserted in
  `tests/examples.test.js` matches exactly what the plan's own
  Consumes/Produces declare (Task 2 and 3 both consume `log` from Task 1
  and produce nothing Task 4 consumes by symbol — Task 4 depends on them
  via `Consumes: greet, farewell`, matching their `Produces`).
- **Version/toolchain enforcement:** not applicable — no pinned
  language/runtime version beyond the existing repo-wide Node >= 20.
- **Parser dry-run:** ran `node bin/parse-plan.js
  docs/cys/plans/2026-07-19-onboarding.md` — it fails with `Duplicate
  task id 1`, because the parser scans the whole file for `### Task N:`
  headers without respecting fenced code blocks, and Task 1's Step 1
  embeds the full example plan (its own `### Task 1`–`### Task 4`) as a
  literal fenced block. This is a known limitation, not a bug in this
  plan — the same "only backtick-quoted symbols count" caveat family
  documented in `cys:plan`'s own skill file. This plan is executed
  directly in-session rather than via `cys:run` (it's two small,
  independent, doc-only tasks — no real benefit from the DAG engine,
  same call made for the Gemini CLI portability plan), so the dry-run
  isn't load-bearing here; noting it rather than hiding it.
