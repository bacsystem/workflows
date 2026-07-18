---
name: design
description: Use BEFORE any creative or feature work — turning an idea into an approved design spec through collaborative dialogue. Triggers - "let's build X", "I want a feature that...", "help me design...". The cys flow starts here; the output spec feeds cys:plan.
---

# cys:design

Turn an idea into an approved design spec through natural collaborative
dialogue. Understand first, propose second, write the spec last.

**Announce at start:** "Using cys:design to shape this idea into a spec."

<HARD-GATE>
Do NOT write implementation code, scaffold projects, or invoke any
implementation skill until the user has approved a presented design.
This applies to every project, no matter how simple it looks.
</HARD-GATE>

## Process

1. **Explore context** — read the relevant files, docs and recent commits
   of the target repo before asking anything.
2. **Scope check** — if the request spans multiple independent subsystems,
   say so and help decompose it first; one spec per coherent sub-project.
3. **Clarifying questions** — ONE question per message. Prefer multiple
   choice. Cover purpose, constraints, and success criteria. Stop asking
   when you can state what you are building in two sentences.
4. **Propose 2-3 approaches** — with trade-offs, leading with your
   recommendation and why.
5. **Present the design in sections** — scale each section to its
   complexity; ask after each whether it looks right. Cover: architecture,
   components, data flow, error handling, testing.
6. **Write the spec** to `docs/cys/specs/YYYY-MM-DD-<topic>-design.md`
   (user preferences for location override this default) and commit it.
7. **Self-review the spec** — placeholders ("TBD", vague requirements),
   internal contradictions, scope creep, ambiguous requirements readable
   two ways. Fix inline.
8. **User review gate** — ask the user to review the written spec file.
   Only proceed on explicit approval.
9. **Hand off to cys:plan** — the ONLY next step after approval is
   invoking cys:plan to write the implementation plan.

## Design principles

- Decisions the user already made are settled — do not re-litigate them.
- YAGNI ruthlessly: strike features the goal does not need.
- Prefer small units with one clear purpose and well-defined interfaces;
  if internals cannot change without breaking consumers, redraw the
  boundaries.
- In existing codebases, follow the established patterns; propose targeted
  improvements only where existing problems block the current work.
- Environment-dependent constraints are verified, not inherited. A prior
  spec's finding about this sandbox (a blocked binary, no Docker, etc.)
  does not automatically apply to a different stack or a later run —
  check it empirically for this project (e.g. `docker info`, whether the
  relevant binary/service actually responds) before letting it drive a
  decision like "tests can only use mocks."

## Red flags — you are skipping the process

- "This is too simple to need a design" — simple projects hide the most
  unexamined assumptions. The spec may be short; it may not be skipped.
- Asking three questions in one message — ask one.
- Writing code "just to explore" before approval — exploration is reading,
  not writing.
