# cys on Gemini CLI Implementation Plan

> **For agentic workers:** execute this plan with the
> parallel-plan-executor Workflow (cys:run / the /cys:run-plan command).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make cys's five non-engine skills installable and usable in
Gemini CLI, reusing `skills/` as-is (no fork), per the approved design at
`docs/cys/specs/2026-07-19-gemini-cli-portability-design.md`. `cys:run`
stays explicitly out of scope.

**Architecture:** one task — a new extension manifest, one generalized
paragraph each in two existing skills (`guide`, `plan`), and two README
notes (EN/ES). No engine changes, no new skill files, no forked content,
no copying/symlinking of `SKILL.md` files.

**Tech Stack:** JSON (Gemini extension manifest), Markdown (skill +
READMEs), Node's built-in test runner.

## Global Constraints

- `skills/` stays a single, shared directory — no duplicated or
  Gemini-specific copies of any `SKILL.md`.
- `gemini-extension.json`'s `version` must stay in lockstep with
  `package.json` (same discipline as the existing Claude Code and Cursor
  manifests).
- No `skills/run/` directory may exist — `cys:run` stays out of Gemini's
  auto-discovered skill set.
- Commit messages: Conventional Commits, in English.

---

### Task 1: Add the Gemini extension manifest, generalize the platform-fallback notes, and add README docs

**Files:**
- Create: `gemini-extension.json`
- Modify: `skills/guide/SKILL.md`
- Modify: `skills/plan/SKILL.md`
- Modify: `README.md`
- Modify: `README.es.md`
- Test: `tests/skills.test.js`

**Interfaces:**
- Consumes: None
- Produces: None (this plan's only task)

- [ ] **Step 1: Write the failing tests**

Append to the end of `tests/skills.test.js`:

````markdown
```js
test('gemini-extension.json declara la extensión cys, en lockstep de versión (Gemini CLI portability)', () => {
  const geminiManifest = JSON.parse(readFileSync(path.join(root, 'gemini-extension.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(geminiManifest.name, 'cys');
  assert.ok(geminiManifest.description && geminiManifest.description.length > 0);
  assert.equal(
    geminiManifest.version,
    pkg.version,
    'sin este candado, un bump de versión deja el manifest de Gemini desincronizado en silencio'
  );
});

test('skills/run/ no existe: cys:run queda fuera del auto-discovery de Gemini CLI', () => {
  assert.equal(
    existsSync(path.join(skillsDir, 'run')),
    false,
    'una carpeta skills/run/ expondría cys:run por convención de Gemini, rompiendo el scope de este port'
  );
});

test('guide documenta la alternativa manual cuando cys:run no está disponible (Cursor, Gemini CLI)', () => {
  const guide = readFileSync(path.join(skillsDir, 'guide', 'SKILL.md'), 'utf8');
  assert.ok(
    guide.includes('Cursor') &&
      guide.includes('Gemini CLI') &&
      guide.includes('execute its tasks yourself in dependency order'),
    'cys:guide debe explicar qué hacer cuando cys:run no está disponible (Cursor, Gemini CLI)'
  );
});

test('plan documenta el fallback de hand-off cuando cys:run no está disponible (Cursor, Gemini CLI)', () => {
  const plan = readFileSync(path.join(skillsDir, 'plan', 'SKILL.md'), 'utf8');
  assert.ok(
    plan.includes('Cursor') && plan.includes('Gemini CLI'),
    'cys:plan debe mencionar qué hacer en plataformas sin cys:run (Cursor, Gemini CLI)'
  );
});
```
````

This replaces the existing Cursor-only test named
`'guide documenta la alternativa manual cuando cys:run no está disponible (Cursor)'`
(currently asserting `guide.includes('On Cursor,')`) — that assertion no
longer holds once Step 3 below generalizes the wording, so the old test
is removed as part of this step (see Step 2 for what to expect from it
now).

- [ ] **Step 2: Run the tests, verify they fail**

Run: `node --test tests/skills.test.js`
Expected: FAIL — `gemini-extension.json` doesn't exist yet, and neither
`guide/SKILL.md` nor `plan/SKILL.md` mention Gemini CLI yet. The old
Cursor-only guide test (still present until Step 3 edits the file) keeps
passing at this point; it gets superseded, not broken, by this step.

- [ ] **Step 3: Create `gemini-extension.json`**

```json
{
  "name": "cys",
  "version": "0.6.13",
  "description": "Development methodology skills for design, plan, check, and ship — parallel plan execution (cys:run) is Claude Code only for now.",
  "repository": "https://github.com/bacsystem/parallel-plan-executor",
  "license": "MIT"
}
```

- [ ] **Step 4: Generalize the platform-fallback note in `skills/guide/SKILL.md`**

Replace this existing paragraph (right before the `## Rules` heading):

```markdown
**On Cursor, `cys:run` isn't available yet** — only stage 3's automated
DAG scheduling, adversarial review, and serialized merging are
Claude-Code-only. After `cys:plan` produces a plan there,
execute its tasks yourself in dependency order: one at a time, or by
hand-dispatching Cursor's own subagents per task, without cys:run's
orchestration.
```

with:

```markdown
**On platforms other than Claude Code (Cursor, Gemini CLI), `cys:run`
isn't available** — only stage 3's automated DAG scheduling, adversarial
review, and serialized merging are Claude-Code-only. After `cys:plan`
produces a plan there, execute its tasks yourself in dependency order:
one at a time, or by hand-dispatching the platform's own subagents per
task, without cys:run's orchestration.
```

- [ ] **Step 5: Generalize the Hand off section in `skills/plan/SKILL.md`**

Replace the existing `## Hand off` section (the plan's own final
section):

```markdown
## Hand off

After saving the plan, hand off to execution: launch with cys:run
(or tell the user to run /cys:run-plan). Do NOT offer sequential execution
paths — parallel execution via the DAG is the cys default.
```

with:

```markdown
## Hand off

After saving the plan, hand off to execution: on Claude Code, launch
with cys:run (or tell the user to run /cys:run-plan) — do NOT offer
sequential execution as a substitute; parallel execution via the DAG is
the cys default there. On platforms where cys:run isn't available
(Cursor, Gemini CLI), tell the user to execute the plan's tasks
themselves in dependency order, per cys:guide's fallback note.
```

- [ ] **Step 6: Add the Gemini CLI section to `README.md`**

Insert this new subsection right after the Cursor section's closing
`</details>` block ends (the line "pick it up.\n</details>") and before
the `## Requirements` heading:

````markdown
### Gemini CLI

The five non-engine skills (`design`, `plan`, `check`, `ship`, `guide`)
also work in [Gemini CLI](https://geminicli.com), via its native Agent
Skills feature — no forked copy, `skills/` is discovered as-is by
directory-name convention (no manifest field needed, unlike Cursor).

Install:

```
gemini extensions install https://github.com/bacsystem/parallel-plan-executor
```

This clones the whole repo to `~/.gemini/extensions/cys/` and makes the
skills available in every project — not just the one you ran the
command from. Since install copies rather than tracks the repo live, run
`gemini extensions update cys` to pick up future releases.

`cys:run`'s parallel execution stays Claude-Code-only (see Requirements
below): on Gemini CLI, `cys:guide` tells you how to execute a plan's
tasks yourself instead.
````

- [ ] **Step 7: Add the equivalent section to `README.es.md`**

Insert this new subsection right after the Cursor section's closing
`</details>` block ends (the line "Window\") para que lo tome.\n</details>")
and before the `## Requisitos` heading:

````markdown
### Gemini CLI

Las cinco skills que no son el motor (`design`, `plan`, `check`, `ship`,
`guide`) también funcionan en [Gemini CLI](https://geminicli.com), vía
su feature nativa de Agent Skills — sin copia forkeada, `skills/` se
descubre tal cual por convención de nombre de carpeta (sin campo de
manifest, a diferencia de Cursor).

Instalar:

```
gemini extensions install https://github.com/bacsystem/parallel-plan-executor
```

Esto clona el repo entero a `~/.gemini/extensions/cys/` y deja las
skills disponibles en cualquier proyecto — no solo en el que corriste el
comando. Como la instalación copia el repo en vez de seguirlo en vivo,
corré `gemini extensions update cys` para traer futuras versiones.

La ejecución paralela de `cys:run` sigue siendo exclusiva de Claude Code
(ver Requisitos abajo): en Gemini CLI, `cys:guide` explica cómo ejecutar
las tareas de un plan vos mismo en su lugar.
````

- [ ] **Step 8: Run the tests, verify they pass**

Run: `node --test tests/skills.test.js`
Expected: PASS — all tests, including the four new/updated ones.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS — no regressions elsewhere.

- [ ] **Step 10: Commit**

```bash
git add gemini-extension.json skills/guide/SKILL.md skills/plan/SKILL.md README.md README.es.md tests/skills.test.js
git commit -m "feat(cys): make design/plan/check/ship/guide installable on Gemini CLI"
```

---

## Self-review

- **Spec coverage:** `gemini-extension.json` ✓, generalized `cys:guide`
  fallback note ✓, generalized `cys:plan` hand-off ✓, README notes in
  both languages ✓, version-sync test ✓, `skills/run/` absence test ✓.
  Every "out of scope" item from the design (porting `cys:run`, a
  `GEMINI.md` context file, extension-registry publishing, engine/command
  changes) is correctly untouched.
- **Placeholder scan:** none — every step's content is complete and
  ready to paste.
- **Type consistency:** `gemini-extension.json`'s `version` field
  (`"0.6.13"`) matches `package.json`'s current version exactly, same
  value the existing Cursor/Claude Code manifest tests already lock to.
- **Version/toolchain enforcement:** not applicable — this plan pins no
  language/runtime version beyond what the repo already enforces
  (Node >= 20 via `package.json`'s existing `engines` field, unchanged
  here).
- **Parser dry-run:** a single task, no Consumes/Produces symbols — graph
  is trivially `{"1": []}`. Ran `node bin/parse-plan.js
  docs/cys/plans/2026-07-19-gemini-cli-portability.md` — see result
  below.
