# cys F3 — Flow Command and Code Standards Implementation Plan

> **For agentic workers:** execute this plan with the
> parallel-plan-executor Workflow (cys:run / the /cys:run-plan command).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/cys:flow` (the all-in-one command: idea → design → plan → parallel run), a clean-code standards reference that implementer agents read before writing code, and the pilot-9 bitácora.

**Architecture:** `commands/flow.md` is a plugin command (auto-namespaced `/cys:flow`, zero-config via `${CLAUDE_PLUGIN_ROOT}`). The standards doc lives in `skills/check/references/` and the engine's implement prompt points agents at it by exact path via `executorPath`. Docs and version close the fase.

**Tech Stack:** Markdown (command + reference doc), JavaScript template edit + `npm run build`, Node >= 20 tests.

## Global Constraints

- Node >= 20, `"type": "module"`, zero runtime dependencies.
- **Never edit `workflows/parallel-plan-executor.js` by hand** — change the template, run `npm run build`, commit BOTH files.
- All tests must pass: `npm test`.
- Commit messages follow Conventional Commits, in English.
- Command and reference content in English; only the bitácora entry is in Spanish (it joins an existing Spanish document).
- The word "superpowers" must not be introduced anywhere.
- Do not chain shell commands with `&&`; one atomic command per invocation. Use `git -C <path>` instead of `cd`.

---

### Task 1: `/cys:flow` — the all-in-one command

**Files:**
- Create: `commands/flow.md`
- Test: `tests/skills.test.js`

**Interfaces:**
- Consumes: None
- Produces: `commands/flow.md` — the /cys:flow plugin command.
- Produces: a commands-frontmatter test in `tests/skills.test.js`.

- [ ] **Step 1: Write the failing test**

Add to `tests/skills.test.js` (reuse the existing imports and `parseFrontmatter` helper; add this test at the end of the file):

```js
test('cada comando del plugin tiene frontmatter con description', () => {
  const commandsDir = path.join(root, 'commands');
  const files = readdirSync(commandsDir).filter((f) => f.endsWith('.md'));
  assert.ok(files.includes('flow.md'), 'el comando /cys:flow debe existir');
  assert.ok(files.includes('run-plan.md'), 'el comando /cys:run-plan debe existir');
  for (const file of files) {
    const fm = parseFrontmatter(readFileSync(path.join(commandsDir, file), 'utf8'));
    assert.ok(fm, `commands/${file} necesita frontmatter ---`);
    assert.ok(fm.description && fm.description.length >= 20, `commands/${file}: la description guía la invocación`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/skills.test.js`
Expected: FAIL — `el comando /cys:flow debe existir`.

- [ ] **Step 3: Write the command**

Create `commands/flow.md` with exactly this content:

```markdown
---
description: Run the full cys flow end to end — take an idea for a target repo through cys:design and cys:plan, then launch the parallel-plan-executor Workflow. The all-in-one entry point; use /cys:run-plan instead when an approved plan already exists.
argument-hint: [repo-path] [idea...]
---

## What this command does

Takes an idea from zero to a running parallel execution: design spec →
implementation plan → parallel-plan-executor Workflow, with the user's
approval gates at every stage. Invoking /cys:flow IS the choice of
parallel execution — never offer sequential alternatives.

REPO = `${CLAUDE_PLUGIN_ROOT}`

<!--
  As a plugin command, CLAUDE_PLUGIN_ROOT resolves to the installed cys
  plugin's directory — which IS the parallel-plan-executor repo. If this
  file was copied by hand instead, replace the value with the clone's
  absolute path. If REPO cannot be resolved, ask the user for it before
  continuing.
-->

## Steps

1. **Parse `$ARGUMENTS`**: the first whitespace-separated token is
   `repo-path` (absolute path of the target repo); everything after it is
   the `idea`, free-form. Ask for whichever is missing — never guess.

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
   - `integration-branch`: suggest `feature/<plan-slug>` created from
     `develop`. If the user names `develop`/`main`/`master` directly,
     warn (mainline should never take agent merges) and confirm.
   - Whether to push and open a PR at the end (`openPr`), and if so
     `pr.base` and optional fields (`assignees`, `labels`, `milestone`,
     `closes`).
   - **Their explicit merge authorization**, naming the branches (e.g.
     "I authorize merging task-1 through task-N into feature/x"). Never
     fabricate it; a bare "yes" is not enough — they name the branches.
     Pass their words verbatim as `args.mergeAuthorization`.

7. **Summarize and confirm**: plan path, repo, task count, parallelism
   the graph shows, integration branch, PR settings, authorization text.
   Re-check the working tree is still clean; if the integration branch
   already exists, ask whether to continue on it or pick another name.

8. **Launch** the `Workflow` tool with:
   - `scriptPath`: `REPO/workflows/parallel-plan-executor.js`
   - `args`: `{ tasks, graph, planPath, repoPath, integrationBranch,
     executorPath: REPO, openPr, pr, mergeAuthorization }` (omit the
     optional ones not provided).

9. **After launching**: tell the user it runs in the background, that
   they can ask "how's the workflow going?" or open `/workflows`, and
   that merges may pause for their permission dialog — a click there is
   expected, not a failure.

## Notes

- The run's record lives under `<repo-path>/.cys/` (ledger, briefs,
  reports, review packages, handoff.md).
- If the workflow's startup validation rejects `args`, report the exact
  error verbatim.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/skills.test.js`
Expected: PASS, including the new commands test.

- [ ] **Step 5: Commit**

```bash
git add commands/flow.md tests/skills.test.js
```

```bash
git commit -m "feat(cys): add /cys:flow all-in-one command (idea to parallel run)"
```

---

### Task 2: Code standards reference for implementers

**Files:**
- Create: `skills/check/references/code-standards.md`

**Interfaces:**
- Consumes: None
- Produces: `skills/check/references/code-standards.md` — the clean-code standards implementer agents read before writing code.

- [ ] **Step 1: Write the reference**

Create `skills/check/references/code-standards.md` with exactly this content:

```markdown
<!-- Code standards for the cys:check skill and for implementer agents of the
     parallel-plan-executor Workflow (its implement prompt points here). -->

# Code standards

The brief says WHAT to build; these standards bind HOW. Reviewers hold
implementations to them (Important findings when violated), so read this
once before writing code and check against it during self-review.

## Naming

- Names reveal intent: a reader should know what a thing is for without
  opening it. `elapsedSeconds`, not `es`; `retryLimit`, not `n2`.
- One word per concept across the codebase — don't mix `fetch`/`get`/
  `retrieve` for the same operation.
- Follow the target repo's existing casing and vocabulary over your own.

## Functions and units

- Small units with ONE clear responsibility; if you need "and" to
  describe a function, split it.
- Prefer early returns over nested conditionals.
- No boolean flag parameters that switch behavior — write two functions.
- Keep files focused: code that changes together lives together.

## YAGNI and DRY

- Implement exactly what the brief specifies — no speculative
  parameters, hooks, or "while I'm here" extras. Unrequested scope is a
  review finding, not a gift.
- Don't duplicate logic that already exists in the repo: search first,
  reuse or extract. But don't force an abstraction for two vaguely
  similar lines either — duplication is cheaper than the wrong coupling.

## Dead code and noise

- No commented-out code, unused imports/variables, or leftover debug
  output in commits.
- No TODO/FIXME without an issue or a task reference the team can find.

## Comments

- Comment the WHY (constraint, trade-off, non-obvious cause), never the
  WHAT the next line already says. If a comment paraphrases the code,
  delete it; if the code needs it to be understood, rewrite the code.
- Match the surrounding files' comment language and density.

## Errors

- Fail loudly and specifically: error messages name the offending value
  and the expectation, so the failure explains itself.
- Never swallow an exception without recording why that's safe.

## Test hygiene

- Tests assert behavior, not implementation details; a refactor that
  preserves behavior should not break them.
- Each test earns its name: reading it should tell you what broke.
- No test interdependence — any test runs alone and in any order.
- The RED run is evidence, not ceremony: verify the failure message is
  the one you expect before making it pass.
```

- [ ] **Step 2: Verify the skills structure test still passes**

Run: `node --test tests/skills.test.js`
Expected: PASS (references/ files don't need frontmatter; nothing breaks).

- [ ] **Step 3: Commit**

```bash
git add skills/check/references/code-standards.md
```

```bash
git commit -m "feat(cys): add code-standards reference for implementers and reviewers"
```

---

### Task 3: Engine — implementers read the standards by exact path

**Files:**
- Modify: `workflows/parallel-plan-executor.template.js`
- Modify: `workflows/parallel-plan-executor.js` (generated — via `npm run build` only)
- Test: `tests/build-workflow.test.js`

**Interfaces:**
- Consumes: `skills/check/references/code-standards.md`
- Produces: `workflows/parallel-plan-executor.js` — rebuilt with the standards instruction.

- [ ] **Step 1: Write the failing test**

Add to `tests/build-workflow.test.js`:

```js
test('built workflow points implementers at the code-standards reference by exact path (cys F3)', () => {
  assert.ok(
    output.includes('${executorPath}/skills/check/references/code-standards.md'),
    'el prompt de implement debe mandar a leer los estándares por ruta exacta, no de memoria'
  );
});
```

Run: `node --test tests/build-workflow.test.js`
Expected: FAIL — the template does not mention the standards file yet.

- [ ] **Step 2: Edit the template**

In `workflows/parallel-plan-executor.template.js`, inside the `implement(task)` prompt, find the paragraph:

```
`Run: \`node ${executorPath}/bin/task-brief.js ${planPath} ${task.id} ${repoPath}/.cys\` — ` +
`it prints your brief file path, already inside the target repo where the reviewer will ` +
`read it. Read ONLY that brief file for your requirements, not the whole plan.\n\n` +
```

and append right after it:

```
`Also read ${executorPath}/skills/check/references/code-standards.md once before writing ` +
`any code — it binds HOW you implement (naming, unit size, YAGNI, comments, test hygiene) ` +
`and your self-review checks against it.\n\n` +
```

- [ ] **Step 3: Rebuild and run the full suite**

Run: `npm run build`
Expected: `Built D:\github\workflows\workflows\parallel-plan-executor.js`

Run: `npm test`
Expected: PASS — everything, including the new assertion.

- [ ] **Step 4: Commit**

```bash
git add workflows/parallel-plan-executor.template.js workflows/parallel-plan-executor.js tests/build-workflow.test.js
```

```bash
git commit -m "feat(engine): implementers read the code-standards reference by exact path"
```

---

### Task 4: Docs, guide update, pilot-9 bitácora, version bump

**Files:**
- Modify: `README.md`
- Modify: `README.es.md`
- Modify: `skills/guide/SKILL.md`
- Modify: `docs/pilots/2026-07-15-pilot-stats-bitacora.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: `commands/flow.md`, `workflows/parallel-plan-executor.js`
- Produces: None (documentation only).

- [ ] **Step 1: Update the READMEs**

In `README.md`, in "The cys plugin" section, after the note about `/cys:run-plan` add:

```markdown
The plugin also ships `/cys:flow` — the all-in-one entry point: give it a
target repo and an idea, and it walks the whole flow (design → plan →
parallel run) with your approval gates at each stage. Use `/cys:run-plan`
instead when an approved plan already exists.
```

In `README.es.md`, same place, in Spanish:

```markdown
El plugin también trae `/cys:flow` — el punto de entrada todo-en-uno: le
das un repo destino y una idea, y recorre el flujo completo (diseño →
plan → ejecución paralela) con tus puertas de aprobación en cada etapa.
Usá `/cys:run-plan` cuando ya tengas un plan aprobado.
```

- [ ] **Step 2: Update the guide skill**

In `skills/guide/SKILL.md`, in the "## Rules" section, add as the first bullet:

```markdown
- `/cys:flow <repo> <idea>` runs the whole flow end to end; `/cys:run-plan`
  enters at stage 3 with an existing plan. Prefer them over improvising
  the sequence.
```

- [ ] **Step 3: Append the pilot-9 bitácora entry**

Append to `docs/pilots/2026-07-15-pilot-stats-bitacora.md`:

```markdown
## Piloto 9 — 2026-07-16 (corridas F1/F2 del ecosistema cys, dogfooding)

Dos corridas reales del workflow contra este mismo repo (F1: independencia
del motor, 22 agentes; F2: plugin + skills, 19 + 10 agentes).

- **F9 validado en producción**: en la corrida F2 de recuperación, los
  agentes de merge reportaron "not yet an ancestor" tras el chequeo de
  ancestría de solo lectura — el short-circuit funciona como se diseñó.
- **F10 (nuevo, corregido en la misma rama)**: la redacción del fix F8
  ("do not treat this as something requiring a fresh consent check") fue
  marcada por el clasificador de permisos como intento de bypass ("bad-
  faith tunneling") y mató a 3 de 5 agentes de merge de F2 con 0 tokens —
  denegación previa a cualquier acción. Fix: el prompt ahora AFIRMA la
  autorización textual del usuario y ordena deferir al diálogo de
  permisos si aparece ("that dialog is the user's gate, not a failure").
  Lección general: afirmar consentimiento sí; instruir a saltear chequeos
  del entorno, nunca — el clasificador lo lee como evasión y endurece.
- **F11 (mitigado)**: el clasificador cita la memoria persistente del
  asistente como "política del usuario" — una nota vieja ("el clasificador
  bloquea todo merge de agentes") siguió bloqueando merges ya autorizados,
  incluso tras actualizarla (parece leer un snapshot). Mitigación doble:
  memoria reescrita con la política real, y regla `ask` para `git merge`
  en `.claude/settings.json` del repo — las reglas tienen precedencia
  sobre el clasificador, así que cada merge de agente pausa y pregunta al
  usuario con el diálogo nativo, determinísticamente.
- **Recuperación validada**: las 3 tareas con merge muerto se rescataron
  con merges manuales (autorizados) + una mini-corrida nueva solo con las
  tareas pendientes (grafo recortado {6:[], 7:[6]}) — cero retrabajo de lo
  ya implementado y revisado.
```

- [ ] **Step 4: CHANGELOG and version bump**

Add at the top of `CHANGELOG.md`:

```markdown
## 0.6.2 — 2026-07-16

New (cys F3 — see `docs/cys/specs/2026-07-16-cys-ecosystem-design.md`):

- `/cys:flow` — the all-in-one plugin command: idea → `cys:design` →
  `cys:plan` → parallel-plan-executor run, with user approval gates at
  every stage. Zero-config via `${CLAUDE_PLUGIN_ROOT}`.
- `skills/check/references/code-standards.md` — clean-code standards;
  the engine's implement prompt now points agents at it by exact path.
- Pilot 9 bitácora: F9 validated in production; F10 (consent-check
  wording flagged as bypass) and F11 (classifier citing stale assistant
  memory) documented with their fixes.
- `tests/skills.test.js` now guards command frontmatter too.
```

In `package.json`, change `"version": "0.6.1"` to `"version": "0.6.2"`.
In `.claude-plugin/plugin.json`, change `"version": "0.6.1"` to `"version": "0.6.2"` (the sync test enforces this).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md README.es.md skills/guide/SKILL.md docs/pilots/2026-07-15-pilot-stats-bitacora.md CHANGELOG.md package.json .claude-plugin/plugin.json
```

```bash
git commit -m "docs(cys): /cys:flow docs, pilot-9 bitacora and 0.6.2 bump"
```
