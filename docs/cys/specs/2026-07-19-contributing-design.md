# Contributing Docs — Design Spec

**Goal:** write down the repo's evidence-driven discipline (currently
only visible by reading test comments and commit history) so an outside
contributor doesn't have to reverse-engineer it, and give `cys:guide` an
honest answer to "is this overhead for my case?" From the same external
review prompt (2026-07-19) as the other two branches; this spec covers
the two purely-documentation, sustainability-oriented items (C1, C2),
independent of any code branch — no shared files.

## C1 — `CONTRIBUTING.md`

New file at the repo root, codifying what's currently implicit:

- The core rule, shown with a real example already in the repo (e.g.
  `src/graph-builder.js`'s duplicate-producer-warning comment, or a test
  name like `'reporta un símbolo declarado por dos productores'`): every
  behavior change needs a test that traces to a real finding or
  motivation, and a comment explaining *why*, not *what*.
  TDD (RED → GREEN), one commit per fix, Conventional Commits in
  English.
- `npm run build` is mandatory after touching any inlined module
  (`src/scheduler.js`, `src/graph-builder.js`, `src/validate-args.js`,
  `src/time.js`) or `workflows-src/parallel-plan-executor.template.js`;
  `workflows/parallel-plan-executor.js` is never hand-edited.
- Check for an already-open PR against the same base branch before
  opening a new one (`gh pr list --state open --base develop`) —
  overlapping PRs touching `commands/`, the version files, or the
  template have caused real conflicts.
- How to run the tests, and the two-halves architecture (pure-Node local
  prep vs. sandboxed `Workflow` script) — enough for someone reading this
  file cold to know where a given kind of change belongs.

## C2 — "When cys is overhead" in `cys:guide`

A short, honest section: `cys:run`'s worktrees + adversarial review +
serialized merge are real overhead for a one-line fix or a trivial
exploration — those are better done by hand. The full flow earns its
keep when a feature has several tasks, non-trivial dependencies, or
where inferred parallelism actually saves wall-clock time. Same tone
`cys:guide` already uses for the "no `cys:run` on this platform" note —
plain, not defensive.

## Testing

- No behavior to test in `CONTRIBUTING.md` beyond its existence (this
  repo's other root docs, like `README.md`, aren't asserted against
  either — a Markdown file's prose isn't something `npm test` checks).
- `tests/skills.test.js` gets one new assertion: `cys:guide` mentions
  when the full flow is overhead (exact wording confirmed at plan time
  against the file's actual current text, same discipline already
  applied to every other guide-content test in this file).

## Out of scope

- Any code branch item (A1–A3, B2) or the other docs branch (B1, B3)
  from the same review prompt — tracked on `feat/engine-limits`,
  `feat/run-summary`, and `docs/onboarding`.
- A `CODE_OF_CONDUCT.md` or issue/PR templates beyond the bug-report
  template already shipped (v0.6.13) — not asked for, not evidenced as
  needed yet.
