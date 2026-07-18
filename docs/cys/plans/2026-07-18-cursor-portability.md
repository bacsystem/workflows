# cys on Cursor Implementation Plan

> **For agentic workers:** execute this plan with the
> parallel-plan-executor Workflow (cys:run / the /cys:run-plan command).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make cys's five non-engine skills installable and usable in
Cursor, reusing `skills/` as-is (no fork), per the approved design at
`docs/cys/specs/2026-07-18-cursor-portability-design.md`. `cys:run`
stays explicitly out of scope.

**Architecture:** one task — a new manifest file, one added paragraph in
an existing skill, and two README notes (EN/ES). No engine changes, no
new skill files, no forked content.

**Tech Stack:** JSON (Cursor plugin manifest), Markdown (skill + READMEs),
Node's built-in test runner.

## Global Constraints

- `skills/` stays a single, shared directory — no duplicated or
  Cursor-specific copies of any `SKILL.md`.
- `.cursor-plugin/plugin.json`'s `version` must stay in lockstep with
  `package.json` (same discipline as the existing Claude Code manifest).
- Commit messages: Conventional Commits, in English.

---

### Task 1: Add the Cursor manifest, guide's fallback note, and README docs

**Files:**
- Create: `.cursor-plugin/plugin.json`
- Modify: `skills/guide/SKILL.md`
- Modify: `README.md`
- Modify: `README.es.md`
- Test: `tests/skills.test.js`

**Interfaces:**
- Consumes: None
- Produces: None (this plan's only task)

- [ ] **Step 1: Write the failing tests**

Append to the end of `tests/skills.test.js`:

```js
test('.cursor-plugin/plugin.json comparte el mismo directorio de skills, sin fork (Cursor portability)', () => {
  const cursorManifest = JSON.parse(readFileSync(path.join(root, '.cursor-plugin', 'plugin.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(cursorManifest.name, 'cys');
  assert.equal(cursorManifest.skills, './skills/', 'debe apuntar al mismo directorio que usa Claude Code, sin fork');
  assert.equal(
    cursorManifest.version,
    pkg.version,
    'sin este candado, un bump de versión deja el manifest de Cursor desincronizado en silencio'
  );
});

test('guide documenta la alternativa manual cuando cys:run no está disponible (Cursor)', () => {
  const guide = readFileSync(path.join(skillsDir, 'guide', 'SKILL.md'), 'utf8');
  assert.ok(
    guide.includes('On Cursor,') &&
      guide.includes('execute its tasks yourself in dependency order'),
    'cys:guide debe explicar qué hacer cuando cys:run no está disponible (Cursor, por ahora)'
  );
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `node --test tests/skills.test.js`
Expected: FAIL — `.cursor-plugin/plugin.json` doesn't exist yet, and
`guide/SKILL.md` doesn't mention Cursor yet.

- [ ] **Step 3: Create `.cursor-plugin/plugin.json`**

```json
{
  "name": "cys",
  "version": "0.6.6",
  "description": "Development methodology skills for design, plan, check, and ship — parallel plan execution (cys:run) is Claude Code only for now.",
  "author": { "name": "bacsystem" },
  "repository": "https://github.com/bacsystem/parallel-plan-executor",
  "license": "MIT",
  "keywords": ["workflow", "methodology", "cursor"],
  "skills": "./skills/"
}
```

- [ ] **Step 4: Add the Cursor fallback note to `skills/guide/SKILL.md`**

Insert this paragraph right after the existing "Stage 5 overlaps..."
paragraph ends (the line "...duplicate the PR-creation work.") and before
the `## Rules` heading:

```markdown
**On Cursor, `cys:run` isn't available yet** — only stage 3's automated
DAG scheduling, adversarial review, and serialized merging are Claude-
Code-only. After `cys:plan` produces a plan there, execute its tasks
yourself in dependency order: one at a time, or by hand-dispatching
Cursor's own subagents per task, without cys:run's orchestration.
```

- [ ] **Step 5: Add the Cursor note to `README.md`**

Insert this new subsection right after the existing `/cys:flow` paragraph
ends (the line "...an approved plan already exists.") and before the
`## Requirements` heading:

```markdown
### Using cys on Cursor

The five non-engine skills (`design`, `plan`, `check`, `ship`, `guide`)
also work in [Cursor](https://cursor.com), reusing the exact same
`skills/` directory — no forked copy to keep in sync. Install by pointing
Cursor at this repo's `.cursor-plugin/`. `cys:run`'s parallel execution
stays Claude-Code-only (see Requirements below): on Cursor, `cys:guide`
tells you how to execute a plan's tasks yourself instead.
```

- [ ] **Step 6: Add the equivalent note to `README.es.md`**

Insert this new subsection right after the existing `/cys:flow` paragraph
ends (the line "...ya tengas un plan aprobado.") and before the
`## Requisitos` heading:

```markdown
### Usar cys en Cursor

Las cinco skills que no son el motor (`design`, `plan`, `check`, `ship`,
`guide`) también funcionan en [Cursor](https://cursor.com), reusando el
mismo directorio `skills/` — sin copia forkeada que mantener sincronizada.
Se instala apuntando Cursor a `.cursor-plugin/` de este repo. La
ejecución paralela de `cys:run` sigue siendo exclusiva de Claude Code
(ver Requisitos abajo): en Cursor, `cys:guide` explica cómo ejecutar las
tareas de un plan vos mismo en su lugar.
```

- [ ] **Step 7: Run the tests, verify they pass**

Run: `node --test tests/skills.test.js`
Expected: PASS — all tests, including the two new ones.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS — no regressions elsewhere (in particular, no other test
assumes `skills/guide/SKILL.md`'s exact byte length or line count).

- [ ] **Step 9: Commit**

```bash
git add .cursor-plugin/plugin.json skills/guide/SKILL.md README.md README.es.md tests/skills.test.js
git commit -m "feat(cys): make design/plan/check/ship/guide installable on Cursor"
```

---

## Self-review

- **Spec coverage:** shared `skills/` directory via the new manifest ✓,
  `cys:guide`'s one-paragraph fallback ✓, README notes in both languages
  ✓, version-sync test ✓. Every "out of scope" item from the design
  (porting `cys:run`, Gemini CLI, new command files, hooks) is correctly
  untouched.
- **Placeholder scan:** none — every step's content is complete and
  ready to paste.
- **Type consistency:** the manifest's `skills` value (`"./skills/"`) and
  the test's expected value are identical strings.
- **Parser dry-run:** a single task, no Consumes/Produces symbols — graph
  is trivially `{"1": []}`.
