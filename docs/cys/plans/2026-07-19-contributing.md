# Contributing Docs Implementation Plan

> **For agentic workers:** execute this plan with the
> parallel-plan-executor Workflow (cys:run / the /cys:run-plan command).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a `CONTRIBUTING.md` that writes down this repo's evidence-
driven discipline, and an honest "when cys is overhead" note in
`cys:guide`, per the approved design at
`docs/cys/specs/2026-07-19-contributing-design.md`.

**Architecture:** two independent tasks, disjoint files.

**Tech Stack:** Markdown, Node's built-in test runner.

## Global Constraints

- No new runtime dependencies.
- Commit messages: Conventional Commits, in English.

---

### Task 1: `CONTRIBUTING.md` (C1)

**Files:**
- Create: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: None
- Produces: None

- [ ] **Step 1: Write `CONTRIBUTING.md`**

```markdown
# Contributing to parallel-plan-executor (cys)

## The one rule that matters

Every behavior change ships with a test that traces to a real finding
or a concrete motivation, and a comment explaining *why* — not what the
code does, which the code itself already says. This repo has no
"nice to have" tests or "just in case" comments. Two real examples
already in the codebase:

- `src/graph-builder.js`'s duplicate-producer warning carries a comment
  explaining *why* it's a warning and not a hard error: "no impide
  ejecutar, pero el usuario debe enterarse en vez de que se resuelva en
  silencio por orden de aparición."
- Test names across `tests/*.test.js` frequently cite the pilot or
  finding that motivated them (e.g. `"...hallazgo real de persons-crud"`,
  `"pilot 8, F8"`) — a test with no traceable motivation is a smell,
  not a contribution.

If you're not sure a change is justified by a real finding, it probably
isn't ready yet. Speculative hardening for a scenario nobody has hit is
a request for discussion, not a PR.

## Workflow

1. **TDD, strictly**: write the failing test, confirm it fails for the
   reason you expect, write the minimal implementation, confirm it
   passes, then run the full suite (`npm test`).
2. **One commit per fix or feature**, Conventional Commits, in English
   (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, ...).
3. **Never hand-edit `workflows/parallel-plan-executor.js`** — it's
   generated. After touching any of the inlined modules
   (`src/scheduler.js`, `src/graph-builder.js`, `src/validate-args.js`,
   `src/time.js`) or `workflows-src/parallel-plan-executor.template.js`,
   run `npm run build` and commit both the source and the regenerated
   file. CI checks `git diff --exit-code workflows/parallel-plan-executor.js`
   after a fresh build — a stale generated file fails the build.
4. **Check for an open PR against the same base branch before opening a
   new one**: `gh pr list --state open --base develop`. Parallel PRs
   touching `commands/`, the version files (`package.json`,
   `CHANGELOG.md`, the `plugin.json`s, `gemini-extension.json`), or the
   workflow template have caused real merge conflicts and version-number
   collisions — coordinate instead of racing.

## Architecture, in one paragraph

This repo is split in two halves by necessity: the Claude Code
`Workflow` sandbox has no filesystem access and can't use
`Date.now()`/`new Date()`. So plan parsing and dependency-graph
inference (`src/plan-parser.js`, `src/graph-builder.js`,
`bin/parse-plan.js`) are pure Node, fully unit-tested, run *outside* the
sandbox. The actual parallel execution
(`workflows/parallel-plan-executor.js`) runs *inside* the sandboxed
`Workflow` tool and is generated from
`workflows-src/parallel-plan-executor.template.js` by inlining the
shared modules above — see rule 3.

## Running the tests

```
npm test                            # everything
node --test tests/scheduler.test.js # one file
npm run build                       # regenerate workflows/parallel-plan-executor.js
```

Requires Node >= 20.
```

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add CONTRIBUTING.md codifying the repo's evidence-driven discipline"
```

---

### Task 2: "When cys is overhead" in `cys:guide` (C2)

**Files:**
- Modify: `skills/guide/SKILL.md`
- Test: `tests/skills.test.js`

**Interfaces:**
- Consumes: None
- Produces: None

- [ ] **Step 1: Write the failing test**

Append to `tests/skills.test.js`:

```js
test('guide dice honestamente cuándo cys:run es overhead y conviene un fix a mano', () => {
  const guide = readFileSync(path.join(skillsDir, 'guide', 'SKILL.md'), 'utf8');
  assert.ok(
    guide.includes('When cys is overhead'),
    'cys:guide debe decir cuándo el flujo completo no vale la pena, no solo cuándo usarlo'
  );
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test tests/skills.test.js`
Expected: FAIL — `skills/guide/SKILL.md` has no such section yet.

- [ ] **Step 3: Add the section to `skills/guide/SKILL.md`**

Insert this new section right after the existing `## What cys does not
do` section (after its last bullet, "No agent-performed PR merges,
ever."), at the end of the file:

```markdown

## When cys is overhead

The full flow — worktrees, adversarial review, serialized merge — earns
its keep when a change has several tasks, non-trivial dependencies, or
where inferred parallelism actually saves wall-clock time. It's real
overhead for a one-line fix, a trivial exploration, or anything you'd
finish faster just doing it by hand. Use your judgment; cys respecting
your time includes not routing small changes through the whole flow
just because the tool exists.
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test tests/skills.test.js`
Expected: PASS — all tests, including the new one.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — no regressions.

- [ ] **Step 6: Commit**

```bash
git add skills/guide/SKILL.md tests/skills.test.js
git commit -m "docs(guide): document when cys is overhead and a manual fix is better"
```

---

## Self-review

- **Spec coverage:** C1 (`CONTRIBUTING.md` ✓) and C2 (honest "when cys
  is overhead" note ✓, tested ✓) — both design items covered.
- **Placeholder scan:** none — every step's content is complete and
  ready to paste.
- **Type consistency:** not applicable — no shared symbols between
  these two documentation-only tasks.
- **Version/toolchain enforcement:** not applicable.
- **Parser dry-run:** ran `node bin/parse-plan.js
  docs/cys/plans/2026-07-19-contributing.md` — see result below.
