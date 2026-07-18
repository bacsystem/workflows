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

## Data integrity

- A field or combination the domain calls "unique"/"must not collide"
  needs a database-level backstop (a unique index/constraint), not only
  an application-layer existence check before insert/update — two
  concurrent requests can both pass that check before either writes
  (TOCTOU). Flag application-only uniqueness as a finding even when the
  design spec only ruled out expressing it via Bean-Validation-style
  annotations — that rules out one mechanism, not a storage-layer
  constraint.

## Test hygiene

- Tests assert behavior, not implementation details; a refactor that
  preserves behavior should not break them.
- Each test earns its name: reading it should tell you what broke.
- No test interdependence — any test runs alone and in any order.
- The RED run is evidence, not ceremony: verify the failure message is
  the one you expect before making it pass.
