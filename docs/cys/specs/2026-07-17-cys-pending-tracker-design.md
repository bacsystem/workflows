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

No other skill or command *reads* the file to remind the user (see
Automatic registration below for who *writes* to it). `cys:design` and
`cys:plan` are unchanged.

### Automatic registration

Findings that come out of a review and are still unresolved when that
review concludes get appended automatically — this is exactly the
pattern already lived with Fase 4b's 3 Minor findings, which today just
evaporate into chat once the conversation moves on. Two touch points,
both places that already produce Critical/Important/Minor findings:

- **The Workflow's Handoff agent** (`workflows-src/parallel-plan-executor.template.js`,
  runs after the final whole-branch review and any fix round). By the
  time it runs, Critical/Important findings are expected to already be
  fixed (existing process); Minor findings typically are not. The Handoff
  agent's prompt gets one more instruction: for every finding from the
  final review that is still open (Minor, or an Important/Critical one
  the user explicitly chose not to fix), append it to
  `<repoPath>/.cys/pending.md` — creating the file with the three-section
  skeleton if it doesn't exist yet. This reuses the agent's existing
  Bash/Write access to the repo working tree; no new capability for the
  sandboxed Workflow script itself. `handoff.md` gets one line noting how
  many items were logged, so the user sees it without opening the file.
- **`cys:check`**, run standalone (outside a `cys:run`). When the user
  responds to a finding with something other than "fix it now" (defer,
  "later", "not now"), `cys:check` appends it to `.cys/pending.md` the
  same way, instead of just letting it drop out of the conversation.

**Bug vs. Gap classification** is the writing agent's own call, using the
same distinction as the manual convention: a finding describing broken or
incorrect behavior → **Bugs**; a finding describing something missing,
deferred, or outside the reviewed change's original scope → **Gaps**.
Each appended line keeps the finding's own wording (no paraphrasing into
something vaguer) and, where available, the file/commit reference the
review already produced.

**Tareas** is never auto-populated — it stays free-form, user/agent-typed
during conversation, as originally designed.

## Out of scope

- `cys:design` and `cys:plan`'s own self-review steps do not write to
  `pending.md` — deliberately deferred scope noted during spec/plan
  writing (e.g. "evaluated and deferred" sections) stays in the spec
  document itself, which is already the durable record for that kind of
  decision. Revisit if this turns out to be a gap in practice.
- No priority levels, due dates, owners, or other metadata — a flat
  checklist is enough for a single user's personal backlog.
- No reminder in commands/skills other than `cys:guide` (see above).

## Testing

- `tests/skills.test.js`: `skills/guide/SKILL.md` documents the
  `.cys/pending.md` convention, the three fixed section names
  (`Bugs`/`Gaps`/`Tareas`), and the reminder behavior; `skills/check/SKILL.md`
  documents appending deferred findings to `.cys/pending.md`.
- `tests/build-workflow.test.js`: the Handoff agent's prompt in
  `workflows-src/parallel-plan-executor.template.js` mentions
  `.cys/pending.md` and the Bug/Gap classification rule (built into
  `workflows/parallel-plan-executor.js` via `npm run build`, per this
  repo's existing convention — never hand-edit the generated file).
