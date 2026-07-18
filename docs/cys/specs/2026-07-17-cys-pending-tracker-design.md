# cys Pending Tracker — Design Spec

**Goal:** give the user a durable, per-repo place to jot bugs, gaps, and
pending tasks that surface mid-conversation, and have `cys:guide` remind
them of open items instead of relying on memory or scrolling chat history.

## Problem

Work with cys spans long sessions across design, plan, run, and review.
Small findings surface constantly — a deferred bug, a scope gap noted in
a review, a "we should document this later" — and today they only live in
chat, so they get forgotten once the conversation moves on or gets
compacted.

## Design

### `.cys/pending.md`

A plain markdown file at `<repo-path>/.cys/pending.md`, alongside the
existing `.cys/` artifacts (`progress.md`, `handoff.md`, task briefs/reports)
— same directory, same gitignore rule, nothing new to wire into
`.gitignore`.

Three fixed `##` sections, always in this order:

```markdown
# Pendientes

## Bugs
- [ ] ...

## Gaps
- [ ] ...

## Tareas
- [ ] ...
```

- **Bugs** — a known defect, something broken.
- **Gaps** — scope that fell outside a design/spec/review on purpose or by
  omission (e.g. a Minor review finding left unfixed, a deferred design
  section).
- **Tareas** — anything pending that isn't a bug or a gap (a doc to write,
  a follow-up idea).

An item is `- [ ]` while open and `- [x]` once resolved. Nothing is ever
deleted automatically — it's the user's own log; they clean it up by hand
whenever they want.

### Creation and edits

No new tooling. The file is plain markdown, created and edited the same
way any other file is — by the user directly, or by an agent when asked
("agregá X a mis pendientes"). `cys:guide` never creates it — if it
doesn't exist, there's nothing to remind about, and cys:guide should not
scatter empty scaffold files into repos that don't use this convention.

### The reminder — `cys:guide`

`cys:guide` is the single place that reads it, because it's the flow's
index/entry-point skill — the moment a user reaches for cys generally,
before picking a stage. On invocation, before presenting the flow table:

- Check whether `.cys/pending.md` exists relative to the target repo. If
  missing or empty (no unchecked items in any section), say nothing and
  proceed as today.
- If it exists and has unchecked items, list them grouped by section —
  only sections with at least one open item are shown (an empty "Bugs"
  heading is not printed).

No other skill or command reads the file. `cys:design`, `cys:plan`,
`cys:run`/`/cys:run-plan`, `/cys:flow`, `cys:check`, and `cys:ship` are
unchanged — keeping this to one touch point means the reminder logic
never has to be kept in sync across six places as cys evolves.

## Out of scope

- No automatic population from the Workflow engine (`parallel-plan-executor`)
  — it stays a pure skill-level, manually-maintained file. Teaching the
  sandboxed Workflow script to write a fourth `.cys/` artifact (beyond
  `state.json`, ledger, reports) is unwarranted complexity for what is,
  today, a note-taking convention.
- No priority levels, due dates, owners, or other metadata — a flat
  checklist is enough for a single user's personal backlog.
- No reminder in commands/skills other than `cys:guide` (see above).

## Testing

`tests/skills.test.js` gets one new assertion: `skills/guide/SKILL.md`
documents the `.cys/pending.md` convention and the three fixed section
names (`Bugs`/`Gaps`/`Tareas`).
