# Fase 4c: Manual Retry Guide Implementation Plan

> **For agentic workers:** execute this plan with the
> parallel-plan-executor Workflow (cys:run / the /cys:run-plan command).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/cys:run-plan` and `/cys:flow` offer, right after launching a
run, ready-to-paste config for a Claude Code Desktop Local Routine that
checks `.cys/state.json` and resumes the run unattended if it gets cut
short — per the approved design at
`docs/cys/specs/2026-07-18-fase-4c-manual-retry-guide-design.md`.

**Architecture:** one task, command-layer only — no engine changes. Both
command files get the same new closing step, worded to their own existing
style; a single shared test locks in both.

**Tech Stack:** Markdown (commands), Node's built-in test runner.

## Global Constraints

- No changes to `workflows-src/parallel-plan-executor.template.js`,
  `workflows/parallel-plan-executor.js`, or any `.cys/` runtime artifact —
  this is generated *text*, not new engine behavior.
- The generated block never includes merge authorization — resumed merges
  must pause for the user's own permission click, same as an unauthorized
  run today.
- Commit messages: Conventional Commits, in English.

---

### Task 1: Offer the manual retry guide in `/cys:run-plan` and `/cys:flow`

**Files:**
- Modify: `commands/run-plan.md`
- Modify: `commands/flow.md`
- Test: `tests/skills.test.js`

**Interfaces:**
- Consumes: None
- Produces: None (this is the plan's only task — nothing downstream)

- [ ] **Step 1: Write the failing test**

Append to the end of `tests/skills.test.js`:

```js
test('run-plan.md y flow.md ofrecen el texto de reintento manual (Routine Local) al terminar de lanzar (Fase 4c)', () => {
  const runPlan = readFileSync(path.join(root, 'commands', 'run-plan.md'), 'utf8');
  const flow = readFileSync(path.join(root, 'commands', 'flow.md'), 'utf8');
  for (const [name, content] of [['run-plan.md', runPlan], ['flow.md', flow]]) {
    assert.ok(
      content.includes('Desktop Local Routine') &&
        content.includes('Check whether <repo-path>/.cys/state.json exists') &&
        content.includes("don't have one this time"),
      `commands/${name} debe ofrecer el texto de reintento manual, chequear .cys/state.json y no dar autorización de merge en el prompt generado`
    );
  }
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test tests/skills.test.js`
Expected: FAIL — neither command file mentions a Desktop Local Routine yet.

- [ ] **Step 3: Add the step to `commands/run-plan.md`**

The file currently ends with step 9 ("After launching") followed by a
`## Notes` section. Insert a new step 10 between them:

```markdown
10. **Offer the manual retry guide** (skip entirely if `allDone` was
    `true` — the run finishes immediately, nothing to resume): ask one
    question, in plain language — whether they want the copy-paste text
    for a Claude Code Desktop Local Routine that resumes this run
    unattended if it gets cut short. On "no", stop here. On "yes", print
    this block, filling in this run's own already-known values (no new
    questions):

    ```
    Name: cys auto-retry — <plan or integration-branch slug>

    Instructions:
    Check whether <repo-path>/.cys/state.json exists. If it does not
    exist, do nothing and finish immediately.
    If it exists, resume the interrupted cys run: invoke
    /cys:run-plan <plan-path> <repo-path> <integration-branch>.
    When asked whether to open a PR, answer <this run's openPr/pr.base>.
    When asked for merge authorization, say you don't have one this
    time — let any merge pause for the user's own permission click.

    Suggested schedule: every 15 minutes
    Folder: <repo-path>
    ```

    Tell them where to paste it: Claude Code Desktop → Routines → New
    routine → Local (or describe the same thing conversationally to
    Claude in a Desktop session, which walks through the same form).
    Remind them to delete or disable the Routine once the run finishes
    or once they no longer need it — there is no way for it to clean
    itself up yet.
```

- [ ] **Step 4: Add the same step to `commands/flow.md`**

The file currently ends with step 11 ("After launching") followed by a
`## Notes` section. Insert a new step 12, worded identically except for
the step number (this file numbers its steps one higher throughout, since
it has two extra steps — Design and Plan — before the shared launch flow):

```markdown
12. **Offer the manual retry guide**: ask one question, in plain
    language — whether they want the copy-paste text for a Claude Code
    Desktop Local Routine that resumes this run unattended if it gets cut
    short. On "no", stop here. On "yes", print this block, filling in
    this run's own already-known values (no new questions):

    ```
    Name: cys auto-retry — <plan or integration-branch slug>

    Instructions:
    Check whether <repo-path>/.cys/state.json exists. If it does not
    exist, do nothing and finish immediately.
    If it exists, resume the interrupted cys run: invoke
    /cys:run-plan <plan-path> <repo-path> <integration-branch>.
    When asked whether to open a PR, answer <this run's openPr/pr.base>.
    When asked for merge authorization, say you don't have one this
    time — let any merge pause for the user's own permission click.

    Suggested schedule: every 15 minutes
    Folder: <repo-path>
    ```

    Tell them where to paste it: Claude Code Desktop → Routines → New
    routine → Local (or describe the same thing conversationally to
    Claude in a Desktop session, which walks through the same form).
    Remind them to delete or disable the Routine once the run finishes
    or once they no longer need it — there is no way for it to clean
    itself up yet.
```

(`/cys:flow` never resumes via `allDone` itself — that only happens
through `/cys:run-plan` per the existing Notes in `flow.md` step 6 — so
this file's version of the step has no `allDone` skip clause.)

- [ ] **Step 5: Run the test, verify it passes**

Run: `node --test tests/skills.test.js`
Expected: PASS — all tests, including the new one.

- [ ] **Step 6: Commit**

```bash
git add commands/run-plan.md commands/flow.md tests/skills.test.js
git commit -m "feat(cys): offer a Desktop Local Routine retry guide after launching a run"
```

---

## Self-review

- **Spec coverage:** the design's single deliverable (offer + generated
  block in both commands) is fully covered by this one task; every
  "out of scope" item from the design (programmatic creation, self-
  deleting Routines, Task Scheduler, persisted merge authorization,
  engine changes) is correctly untouched.
- **Placeholder scan:** none — the step text and generated block are
  complete, copy-pasteable as written.
- **Type consistency:** the generated block's shape (`Name`/`Instructions`/
  `Suggested schedule`/`Folder`) and wording are identical between
  `run-plan.md` and `flow.md`, as the design requires.
- **Parser dry-run:** a single task touching two command files plus one
  shared test file — no Consumes/Produces symbols, so the graph is
  trivially `{"1": []}`. Nothing to parallelize; not a concern for a
  one-task plan.
