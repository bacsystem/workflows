# cys F1 — Engine Independence Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the engine's runtime dependency on an external plugin: own `task-brief`/`review-package` scripts invoked by exact path via a new `executorPath` arg, `.cys/` as the run-record directory, and no `FIND_SDD_SCRIPTS` filesystem scanning.

**Architecture:** Two new pure-Node CLIs in `bin/` (reusing the tested plan parser), one new required workflow arg validated in `src/validate-args.js`, and a prompt rewrite in `workflows/parallel-plan-executor.template.js` (regenerated with `npm run build`). Docs and the `/run-plan` command follow.

**Tech Stack:** Node >= 20, ESM, zero runtime dependencies, `node --test`.

## Global Constraints

- Node >= 20, `"type": "module"`, zero runtime dependencies — stdlib (`node:fs`, `node:path`, `node:child_process`) only.
- **Never edit `workflows/parallel-plan-executor.js` by hand** — it is generated. Change `workflows/parallel-plan-executor.template.js` (or the inlined `src/` modules) and run `npm run build`, then commit BOTH files.
- All tests must pass: `npm test`.
- Commit messages follow Conventional Commits.
- Code comments follow the repo's style: Spanish for the "why" comments, matching the surrounding files.
- The design spec for this work is `docs/cys/specs/2026-07-16-cys-ecosystem-design.md` (§5, fase F1).
- Do not chain shell commands with `&&`; one atomic command per invocation. Use `git -C <path>` instead of `cd`.

---

### Task 1: `extractTaskBlock` + `bin/task-brief.js`

**Files:**
- Modify: `src/plan-parser.js`
- Create: `bin/task-brief.js`
- Test: `tests/task-brief.test.js`

**Interfaces:**
- Consumes: None
- Produces: `extractTaskBlock(planText, taskId)` — exported from `src/plan-parser.js`; returns the full `### Task N:` block (header + body, trailing `---` separator trimmed) or `null` if the task id does not exist.
- Produces: the CLI `bin/task-brief.js` — usage `node bin/task-brief.js <planPath> <taskId> <outDir>`; writes `<outDir>/task-<id>-brief.md` (creating `outDir` recursively) and prints that file's absolute path to stdout; exits 1 with a message on missing args, non-integer taskId, or task not found.

- [ ] **Step 1: Write the failing tests**

Create `tests/task-brief.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTaskBlock } from '../src/plan-parser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'bin', 'task-brief.js');

const PLAN = [
  '# Some Plan',
  '',
  '## Global Constraints',
  '',
  '- Node >= 20.',
  '',
  '---',
  '',
  '### Task 1: First thing',
  '',
  '**Files:**',
  '- Create: `src/a.js`',
  '',
  'Body of task one.',
  '',
  '---',
  '',
  '### Task 2: Second thing',
  '',
  '**Files:**',
  '- Create: `src/b.js`',
  '',
  'Body of task two.',
  '',
].join('\n');

test('extractTaskBlock devuelve el bloque completo de una tarea intermedia, sin el separador final', () => {
  const block = extractTaskBlock(PLAN, 1);
  assert.ok(block.startsWith('### Task 1: First thing'));
  assert.ok(block.includes('Body of task one.'));
  assert.ok(!block.includes('### Task 2'), 'no debe arrastrar la tarea siguiente');
  assert.ok(!/\n---\s*$/.test(block), 'el separador --- final no es parte de la tarea');
});

test('extractTaskBlock devuelve la última tarea (hasta EOF) y null para un id inexistente', () => {
  const block = extractTaskBlock(PLAN, 2);
  assert.ok(block.startsWith('### Task 2: Second thing'));
  assert.ok(block.includes('Body of task two.'));
  assert.equal(extractTaskBlock(PLAN, 99), null);
});

test('extractTaskBlock normaliza CRLF igual que el parser', () => {
  const block = extractTaskBlock(PLAN.replace(/\n/g, '\r\n'), 1);
  assert.ok(block.startsWith('### Task 1: First thing'));
});

test('el CLI escribe el brief en outDir (creándolo), imprime su ruta absoluta y no incluye otras tareas', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'task-brief-'));
  const planPath = path.join(dir, 'plan.md');
  writeFileSync(planPath, PLAN);
  const outDir = path.join(dir, 'nested', '.cys');

  const stdout = execFileSync('node', [cli, planPath, '2', outDir], { encoding: 'utf8' }).trim();

  assert.equal(stdout, path.resolve(outDir, 'task-2-brief.md'));
  assert.ok(existsSync(stdout));
  const content = readFileSync(stdout, 'utf8');
  assert.ok(content.startsWith('### Task 2: Second thing'));
  assert.ok(!content.includes('### Task 1'));
});

test('el CLI falla ruidosamente: sin args, taskId no entero, o tarea inexistente', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'task-brief-err-'));
  const planPath = path.join(dir, 'plan.md');
  writeFileSync(planPath, PLAN);

  assert.throws(() => execFileSync('node', [cli], { encoding: 'utf8', stdio: 'pipe' }));
  assert.throws(() => execFileSync('node', [cli, planPath, 'two', dir], { encoding: 'utf8', stdio: 'pipe' }));
  assert.throws(() => execFileSync('node', [cli, planPath, '99', dir], { encoding: 'utf8', stdio: 'pipe' }));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/task-brief.test.js`
Expected: FAIL — `extractTaskBlock` is not exported and `bin/task-brief.js` does not exist.

- [ ] **Step 3: Implement `extractTaskBlock` in `src/plan-parser.js`**

Add at the end of `src/plan-parser.js` (it reuses the module-level `TASK_HEADER_RE` already defined at the top):

```js
// Devuelve el bloque completo de una tarea ("### Task N: <título>" + cuerpo hasta el
// próximo header de tarea o EOF), o null si el id no existe. Es la fuente del
// task-brief: el implementador lee SOLO su tarea, nunca el plan entero.
export function extractTaskBlock(planText, taskId) {
  planText = planText.replace(/\r\n/g, '\n');
  const parts = planText.split(TASK_HEADER_RE);
  // parts = [preámbulo, id1, título1, cuerpo1, id2, título2, cuerpo2, ...]
  for (let i = 1; i < parts.length; i += 3) {
    if (Number(parts[i]) !== taskId) continue;
    // El separador "---" entre tareas pertenece al plan, no a la tarea.
    const body = parts[i + 2].replace(/\n---\s*$/, '\n');
    return `### Task ${parts[i]}: ${parts[i + 1]}${body}`;
  }
  return null;
}
```

- [ ] **Step 4: Implement `bin/task-brief.js`**

Create `bin/task-brief.js`:

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractTaskBlock } from '../src/plan-parser.js';

const [, , planPath, taskIdRaw, outDir] = process.argv;
if (!planPath || !taskIdRaw || !outDir) {
  console.error('Usage: node bin/task-brief.js <path-to-plan.md> <taskId> <outDir>');
  process.exit(1);
}

const taskId = Number(taskIdRaw);
if (!Number.isInteger(taskId) || taskId < 1) {
  console.error(`taskId must be a positive integer, got "${taskIdRaw}"`);
  process.exit(1);
}

const planText = readFileSync(planPath, 'utf8');
const block = extractTaskBlock(planText, taskId);
if (block === null) {
  console.error(`Task ${taskId} not found in ${planPath}`);
  process.exit(1);
}

// Escribe directo en el outDir final (el .cys/ del repo destino): así el brief queda
// donde el reviewer lo va a leer, sin el paso frágil de "copialo si quedó en otro lado"
// que necesitaba an external plugin's script (piloto, hallazgo F4).
mkdirSync(outDir, { recursive: true });
const briefPath = resolve(outDir, `task-${taskId}-brief.md`);
writeFileSync(briefPath, block);
console.log(briefPath);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/task-brief.test.js`
Expected: PASS (5 tests).

Run: `npm test`
Expected: all tests PASS (no regressions in the parser suite).

- [ ] **Step 6: Commit**

```bash
git add src/plan-parser.js bin/task-brief.js tests/task-brief.test.js
```

```bash
git commit -m "feat(cys): add own task-brief CLI, replacing an external plugin's script"
```

---

### Task 2: `bin/review-package.js`

**Files:**
- Create: `bin/review-package.js`
- Test: `tests/review-package.test.js`

**Interfaces:**
- Consumes: None
- Produces: the CLI `bin/review-package.js` — usage `node bin/review-package.js <repoPath> <baseSha> <headSha> <outDir>`; writes `<outDir>/review-<base7>..<head7>.diff` (creating `outDir` recursively) containing a header, the commit list, `--stat`, and the full diff for `baseSha..headSha`; prints that file's absolute path to stdout; exits 1 with git's stderr on bad SHAs or a non-repo path.

- [ ] **Step 1: Write the failing test**

Create `tests/review-package.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'bin', 'review-package.js');

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function makeRepoWithTwoCommits() {
  const repo = mkdtempSync(path.join(tmpdir(), 'review-package-'));
  execFileSync('git', ['init', repo], { encoding: 'utf8' });
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  writeFileSync(path.join(repo, 'a.txt'), 'first\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-m', 'feat: first');
  const baseSha = git(repo, 'rev-parse', 'HEAD');
  writeFileSync(path.join(repo, 'a.txt'), 'first\nsecond\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-m', 'feat: second');
  const headSha = git(repo, 'rev-parse', 'HEAD');
  return { repo, baseSha, headSha };
}

test('escribe el paquete de review con commits, stat y diff, e imprime su ruta', () => {
  const { repo, baseSha, headSha } = makeRepoWithTwoCommits();
  const outDir = path.join(repo, '.cys');

  const stdout = execFileSync('node', [cli, repo, baseSha, headSha, outDir], { encoding: 'utf8' }).trim();

  const expected = path.resolve(outDir, `review-${baseSha.slice(0, 7)}..${headSha.slice(0, 7)}.diff`);
  assert.equal(stdout, expected);
  assert.ok(existsSync(stdout));
  const content = readFileSync(stdout, 'utf8');
  assert.ok(content.includes('feat: second'), 'la lista de commits del rango debe estar');
  assert.ok(!content.includes('feat: first'), 'el commit base queda fuera del rango base..head');
  assert.ok(content.includes('a.txt'), 'el stat debe nombrar el archivo tocado');
  assert.ok(content.includes('+second'), 'el diff completo debe estar incluido');
});

test('falla ruidosamente con SHAs inválidos o args faltantes', () => {
  const { repo } = makeRepoWithTwoCommits();
  assert.throws(() => execFileSync('node', [cli], { encoding: 'utf8', stdio: 'pipe' }));
  assert.throws(() =>
    execFileSync('node', [cli, repo, 'deadbeef', 'cafebabe', path.join(repo, '.cys')], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/review-package.test.js`
Expected: FAIL — `bin/review-package.js` does not exist.

- [ ] **Step 3: Implement `bin/review-package.js`**

Create `bin/review-package.js`:

```js
#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const [, , repoPath, baseSha, headSha, outDir] = process.argv;
if (!repoPath || !baseSha || !headSha || !outDir) {
  console.error('Usage: node bin/review-package.js <repoPath> <baseSha> <headSha> <outDir>');
  process.exit(1);
}

// execFile (sin shell) con -C: los SHAs y rutas llegan de otros agentes — nada se
// interpola en una línea de shell.
function git(...args) {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' });
}

let commits, stat, diff;
try {
  commits = git('log', '--oneline', `${baseSha}..${headSha}`);
  stat = git('diff', '--stat', `${baseSha}..${headSha}`);
  diff = git('diff', `${baseSha}..${headSha}`);
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const pkgPath = resolve(outDir, `review-${baseSha.slice(0, 7)}..${headSha.slice(0, 7)}.diff`);
writeFileSync(
  pkgPath,
  [
    `# Review package: ${baseSha} -> ${headSha}`,
    '',
    '## Commits',
    '',
    commits.trimEnd(),
    '',
    '## Stat',
    '',
    stat.trimEnd(),
    '',
    '## Diff',
    '',
    diff,
  ].join('\n')
);
console.log(pkgPath);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/review-package.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add bin/review-package.js tests/review-package.test.js
```

```bash
git commit -m "feat(cys): add own review-package CLI, replacing an external plugin's script"
```

---

### Task 3: `executorPath` required in args validation

**Files:**
- Modify: `src/validate-args.js`
- Test: `tests/validate-args.test.js`

**Interfaces:**
- Consumes: None
- Produces: `validateWorkflowArgs` now requires `executorPath` — a non-empty string; missing/empty/non-string throws `args.executorPath must be the absolute path of the parallel-plan-executor clone (its bin/ scripts are invoked by exact path)`.

- [ ] **Step 1: Write the failing tests**

In `tests/validate-args.test.js`, first add `executorPath: 'D:/tools/parallel-plan-executor'` to the valid-args fixture used by the existing passing test (find the object literal passed in the test named `acepta args válidos con un DAG consistente` and every other test that expects validation to pass beyond the field under test, and add the field). Then add this test:

```js
test('rechaza un executorPath ausente o vacío: los prompts invocan bin/ por ruta exacta', () => {
  const base = {
    tasks: [{ id: 1 }],
    graph: { 1: [] },
    integrationBranch: 'feature/x',
  };
  assert.throws(() => validateWorkflowArgs({ ...base }), /executorPath/);
  assert.throws(() => validateWorkflowArgs({ ...base, executorPath: '' }), /executorPath/);
  assert.throws(() => validateWorkflowArgs({ ...base, executorPath: 42 }), /executorPath/);
  assert.doesNotThrow(() =>
    validateWorkflowArgs({ ...base, executorPath: 'D:/tools/parallel-plan-executor' })
  );
});
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `node --test tests/validate-args.test.js`
Expected: FAIL — the new test throws nothing for a missing `executorPath`.

- [ ] **Step 3: Implement the validation**

In `src/validate-args.js`, add `executorPath` to the destructured parameter of `validateWorkflowArgs`:

```js
export function validateWorkflowArgs({ tasks, graph, integrationBranch, executorPath, openPr, pr, mergeAuthorization }) {
```

and add this check right after the `integrationBranch` check:

```js
  if (typeof executorPath !== 'string' || executorPath.trim() === '') {
    // Los prompts corren bin/task-brief.js y bin/review-package.js por ruta exacta; sin
    // ella cada agente tendría que escanear el disco buscando scripts (hallazgo F7).
    throw new Error('args.executorPath must be the absolute path of the parallel-plan-executor clone (its bin/ scripts are invoked by exact path)');
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/validate-args.test.js`
Expected: PASS, including all pre-existing tests (fixtures updated in Step 1).

- [ ] **Step 5: Commit**

```bash
git add src/validate-args.js tests/validate-args.test.js
```

```bash
git commit -m "feat(cys): require executorPath in workflow args"
```

---

### Task 4: Template prompt rewrite — exact-path scripts, `.cys/`, no external-plugin references

**Files:**
- Modify: `workflows/parallel-plan-executor.template.js`
- Modify: `workflows/parallel-plan-executor.js` (generated — via `npm run build` only)
- Test: `tests/build-workflow.test.js`

**Interfaces:**
- Consumes: the CLI `bin/task-brief.js` (from Task 1), the CLI `bin/review-package.js` (from Task 2), `validateWorkflowArgs` with required `executorPath` (from Task 3).
- Produces: the regenerated `workflows/parallel-plan-executor.js` with zero external-plugin references.

- [ ] **Step 1: Update the build tests (failing first)**

In `tests/build-workflow.test.js`:

**(a) Replace** the test `built workflow scopes the SDD-scripts search instead of scanning the whole filesystem first (pilot 8, F7)` entirely with:

```js
test('built workflow has zero external-plugin references and never scans the filesystem (cys F1)', () => {
  assert.ok(
    !output.includes('subagent-driven-development'),
    'ni skills, ni scripts, ni rutas del plugin externo deben sobrevivir a F1'
  );
  assert.ok(
    !output.includes('find ~') && !output.includes('FIND_SDD_SCRIPTS'),
    'los scripts se invocan por ruta exacta; el escaneo de disco (F7) muere de raíz'
  );
  assert.ok(
    output.includes('node ${executorPath}/bin/task-brief.js ${planPath} ${task.id} ${repoPath}/.cys'),
    'el implementador corre task-brief propio por ruta exacta, escribiendo directo en .cys del repo destino'
  );
  assert.ok(
    output.includes('node ${executorPath}/bin/review-package.js ${repoPath} ${impl.baseSha} ${impl.headSha} ${repoPath}/.cys'),
    'el reviewer corre review-package propio por ruta exacta'
  );
});
```

**(b) Replace** the test `built workflow makes sure the task brief lands in the target repo (pilot F4)` entirely with:

```js
test('built workflow records the run under .cys/ in the target repo (cys F1)', () => {
  assert.ok(output.includes('.cys/progress.md'), 'el ledger vive en .cys');
  assert.ok(output.includes('.cys/task-${task.id}-brief.md'), 'el brief se lee desde .cys');
  assert.ok(output.includes('.cys/task-${task.id}-report.md'), 'el reporte del implementador va a .cys');
  assert.ok(output.includes('.cys/handoff.md'), 'el handoff va a .cys');
});
```

**(c) Update** the test `build script embeds the args validation and the template invokes it before any agent`: change the expected invocation string to

```js
  const validateIndex = output.indexOf('validateWorkflowArgs({ tasks, graph, integrationBranch, executorPath, openPr, pr, mergeAuthorization })');
```

**(d) Update** the test `built workflow names the integration branch explicitly instead of letting agents guess`: change the destructuring assertion to

```js
  assert.ok(
    output.includes('integrationBranch, executorPath, openPr, pr, mergeAuthorization } = resolvedArgs'),
    'integrationBranch y executorPath deben venir de los args resueltos (objeto o string parseado)'
  );
```

**(e) Update** the test for the Handoff phase (`built workflow ships a Handoff phase...`): change the assertion `output.includes('external-plugin-path/handoff.md')` to `output.includes('.cys/handoff.md')`.

- [ ] **Step 2: Run the build tests to verify they fail**

Run: `node --test tests/build-workflow.test.js`
Expected: FAIL — the template still references the external plugin and its run-record path.

- [ ] **Step 3: Rewrite the template**

In `workflows/parallel-plan-executor.template.js`, make exactly these changes:

**(a) Meta description** (line 3) — replace with:

```js
  description: 'Execute an implementation plan with independent tasks run in parallel via a dependency DAG: per-task briefs, adversarial review, serialized merges, git-flow handoff',
```

**(b) Args destructuring and validation** (lines 22-24) — replace with:

```js
const resolvedArgs = typeof args === 'string' ? JSON.parse(args) : args;
const { graph, tasks, planPath, repoPath, integrationBranch, executorPath, openPr, pr, mergeAuthorization } = resolvedArgs;
validateWorkflowArgs({ tasks, graph, integrationBranch, executorPath, openPr, pr, mergeAuthorization }); // falla rápido y claro, nunca deadlock
```

**(c) Delete the `FIND_SDD_SCRIPTS` constant entirely** (the comment block about F7 at lines 27-31 and the const at lines 32-38). The F7 story moves to the exact-path invocations below.

**(d) Ledger** — in `appendLedger`, replace the external plugin's `progress.md` path with `.cys/progress.md`.

**(e) Implement prompt** — replace the two paragraphs

```
`${FIND_SDD_SCRIPTS} Run: task-brief ${planPath} ${task.id} — it prints your brief ` +
`file path. Read ONLY that brief file for your requirements, not the whole plan. If ` +
`that brief file is not already under ${repoPath}/.cys-legacy/, copy it to ` +
`${repoPath}/.cys-legacy/task-${task.id}-brief.md — the reviewer reads it from there.\n\n` +
```

with (the exact-path invocation kills F7 — no filesystem scanning — and writing straight into the target repo's `.cys/` kills the F4 copy step):

```
`Run: \`node ${executorPath}/bin/task-brief.js ${planPath} ${task.id} ${repoPath}/.cys\` — ` +
`it prints your brief file path, already inside the target repo where the reviewer will ` +
`read it. Read ONLY that brief file for your requirements, not the whole plan.\n\n` +
```

**(f) TDD instruction** in the implement prompt — replace

```
`Follow strict test-driven development for every code change. Implement exactly ` +
```

with:

```
`Follow strict test-driven development for every code change: write the failing test ` +
`first, run it and verify it fails, implement minimally, verify it passes. Implement exactly ` +
```

**(g) Implementer report path** — replace the external plugin's report path with `.cys/task-${task.id}-report.md`.

**(h) Review prompt** — replace

```
`${FIND_SDD_SCRIPTS} Run: review-package ${impl.baseSha} ${impl.headSha} — it prints a ` +
`diff package file. Read that file once; it is your view of the change, do not re-run git.\n\n` +
```

with:

```
`Run: \`node ${executorPath}/bin/review-package.js ${repoPath} ${impl.baseSha} ${impl.headSha} ${repoPath}/.cys\` — ` +
`it prints a diff package file. Read that file once; it is your view ` +
`of the change, do not re-run git.\n\n` +
```

(The invocation must stay in ONE contiguous template literal — the build test asserts on that exact contiguous source text.)

and replace the external plugin's brief path with `.cys/task-${task.id}-brief.md` in the same prompt.

**(i) Handoff prompt** — replace the external plugin's handoff path with `${repoPath}/.cys/handoff.md`.

**(j) Final review prompt** — replace

```
`full plan at ${planPath} (use a code-reviewer ` +
`template). Check cross-task consistency the per-task reviews couldn't see.`,
```

with:

```
`full plan at ${planPath}. Structure it as: Strengths / Issues (Critical, Important, ` +
`Minor — each with file:line) / Recommendations / Assessment ("Ready to merge? yes/no" ` +
`with reasoning). Check cross-task consistency the per-task reviews couldn't see.`,
```

- [ ] **Step 4: Regenerate the built workflow**

Run: `npm run build`
Expected: `Built D:\github\workflows\workflows\parallel-plan-executor.js`

- [ ] **Step 5: Run the full suite to verify everything passes**

Run: `npm test`
Expected: PASS — including the rewritten build tests; zero external-plugin references in the built output.

If the zero-external-plugin-reference assertion fails because a Spanish "why" comment in an inlined `src/` module mentions it, reword that comment (keep its meaning, drop the word) and re-run `npm run build` — comments are part of the built output.

- [ ] **Step 6: Commit**

```bash
git add workflows/parallel-plan-executor.template.js workflows/parallel-plan-executor.js tests/build-workflow.test.js
```

```bash
git commit -m "feat(cys)!: run own bin/ scripts by exact path and record runs under .cys/

BREAKING CHANGE: args.executorPath is now required; the run-record
directory moved from the external plugin's convention to .cys/. The engine no longer
locates or runs an external plugin's task-brief/review-package scripts."
```

---

### Task 5: Command, docs, changelog, version bump

**Files:**
- Modify: `commands/run-plan.md`
- Modify: `README.md`
- Modify: `README.es.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: the regenerated `workflows/parallel-plan-executor.js` (from Task 4 — its args contract is what the docs describe).
- Produces: None (documentation only).

- [ ] **Step 1: Update `commands/run-plan.md`**

In the launch step (step 6, "Launch"), the `args` list currently reads `{ tasks, graph, planPath, repoPath, integrationBranch, openPr, pr, mergeAuthorization }`. Add `executorPath` so it reads:

```
   - `args`: `{ tasks, graph, planPath, repoPath, integrationBranch, executorPath: <REPO>, openPr, pr, mergeAuthorization }`
     (executorPath is REPO — the workflow invokes REPO/bin scripts by exact path;
     omit `openPr`/`pr`/`mergeAuthorization` if not provided)
```

- [ ] **Step 2: Update `README.md` and `README.es.md`**

Apply the same three edits to both files (English wording in `README.md`, Spanish in `README.es.md`):

1. Replace every occurrence of the external plugin's run-record paths with `.cys/handoff.md` / `.cys/` respectively.
2. In the "Uso" / "Usage" args example, add after the `integrationBranch` line:
   ```
   #            executorPath: "<este-repo>",              # ruta absoluta de este clon: el workflow
   #                                                      # corre sus scripts bin/ por ruta exacta (obligatorio)
   ```
   (English: `# absolute path of this clone: the workflow runs its bin/ scripts by exact path (required)`.)
3. In the requirements section, soften the external-plugin-dependency bullet: it is no longer needed by the *engine* (the workflow now ships its own `task-brief`/`review-package` in `bin/` and records runs under `.cys/`); it is still required today for **writing plans** (the external plan-writing skill) until cys ships its own design/plan skills (see the cys design spec, fase F2). Keep the rest of the bullet.

- [ ] **Step 3: Update `CHANGELOG.md` and bump the version**

Add at the top of `CHANGELOG.md`:

```markdown
## 0.6.0 — 2026-07-16

**BREAKING** (0.x → minor per git-flow rules):

- `args.executorPath` is now required: the absolute path of this clone. The
  implement/review prompts invoke `bin/task-brief.js` and `bin/review-package.js`
  by exact path — no more locating an external plugin's scripts by scanning the
  filesystem (kills pilot finding F7 at the root; F4's copy step is gone too,
  the brief is written straight into the target repo).
- The run record moved from the external plugin's convention to `.cys/` (progress.md ledger,
  task briefs/reports, review packages, handoff.md).
- The engine no longer depends on any external plugin at runtime.
  An external plan-writing skill is still the plan format source until cys F2.

New (cys F1 — see `docs/cys/specs/2026-07-16-cys-ecosystem-design.md`):

- `bin/task-brief.js <plan> <taskId> <outDir>` — extracts one task's block.
- `bin/review-package.js <repo> <base> <head> <outDir>` — commit list + stat + diff.
```

In `package.json`, change `"version": "0.5.2"` to `"version": "0.6.0"`.

- [ ] **Step 4: Run the full suite one last time**

Run: `npm test`
Expected: PASS — `tests/version.test.js` picks the bump up from `package.json` automatically.

- [ ] **Step 5: Commit**

```bash
git add commands/run-plan.md README.md README.es.md CHANGELOG.md package.json
```

```bash
git commit -m "docs(cys): document executorPath, .cys/ run dir and the 0.6.0 breaking change"
```
