---
name: check
description: Use when reviewing implemented work or before claiming anything is done, fixed or passing — adversarial review with explicit verdicts, and verification with evidence before assertions. The same conventions the parallel-plan-executor's review agents follow.
---

# cys:check

Two disciplines in one skill: reviewing someone else's change
adversarially, and verifying your own claims before you make them.

**Announce at start:** "Using cys:check to review/verify this work."

## Reviewing a change

Treat the implementer's report as unverified claims — verify against the
diff, never against the narrative. Read the actual change once, fully.

Structure every review as two independent verdicts:

1. **Spec compliance** — verdict `PASS` or `FAIL`.
   Findings categorized as Missing / Extra / Misunderstood, each with
   `file:line`.
2. **Code quality** — verdict `APPROVED` or `NEEDS_FIXES`.
   Findings categorized as Critical (must fix) / Important (should fix) /
   Minor (nice to have), each with `file:line`. Hold the change to
   `references/code-standards.md` (naming, unit size, YAGNI, dead code,
   comments, test hygiene) — a violation is a finding, not a style
   opinion.

Both verdicts are always required; a beautiful implementation of the
wrong thing FAILs, an ugly implementation of the right thing may PASS
with NEEDS_FIXES.

For a whole-branch (cross-task) review, structure it as:
Strengths / Issues (Critical, Important, Minor — each with file:line) /
Recommendations / Assessment ("Ready to merge? yes/no" with reasoning).
Look specifically for cross-boundary defects a per-task review cannot
see: interface mismatches, duplicated logic, contract drift.

## Verifying before claiming

Never state "done", "fixed", "passing" or "works" without having run the
verification in the same session and read its output:

- Run the project's own test/lint command — not a guess. Show the result.
- If you changed generated artifacts, regenerate and diff — confirm sync.
- If the change has a runtime surface, exercise it end-to-end once.
- Report outcomes faithfully: failing tests are reported as failing,
  skipped steps as skipped. Evidence precedes assertions, always.

## Red flags

- Reviewing the report instead of the diff.
- A single merged verdict ("looks good") — the two axes exist because
  they fail independently.
- "Should work now" — run it; then say it works.
- Findings without file:line — unactionable review is noise.
