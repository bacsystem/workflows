# Onboarding Materials — Design Spec

**Goal:** give a new visitor two fast, low-effort ways to see what cys
actually does — a runnable example that shows real inferred parallelism
in under 5 minutes (B1), and a diagram of the whole 5-skill flow with
its artifacts and human gates (B3). Both from the same external review
prompt (2026-07-19) as `docs/cys/specs/2026-07-19-engine-limits-design.md`;
this spec covers the two purely-documentation items, independent of any
code branch (no shared files, no merge-order dependency).

## B1 — Runnable end-to-end example

`examples/hello-parallel/plan.md`: a minimal but real plan, parseable by
`bin/parse-plan.js`, with 2 tasks that are genuinely independent (disjoint
`Consumes`/`Produces`, disjoint files) so the DAG shows real parallelism,
plus one task depending on both — same shape as
`tests/fixtures/sample-plan.md` (already proven to parse correctly), not
a fresh invention.

`examples/README.md` walks the 5-minute path: run `node
bin/parse-plan.js examples/hello-parallel/plan.md`, read the printed
`graph`, and see which two task ids have no edge between them — that
absence of an edge *is* the parallelism, not something cys has to
narrate.

A test parses the example and asserts the graph's exact shape, so a
future parser change that silently breaks the example fails CI instead
of just rotting undetected — same principle already applied to every
other fixture in this repo.

## B3 — Ecosystem flow diagram

`docs/diagram/flujo-cys-ecosystem.mmd`, matching the existing
`docs/diagram/flujo-parallel-plan-executor.mmd`'s style (Mermaid
`flowchart TD`, Spanish labels, `subgraph` per phase) rather than
inventing a new visual language. Content: the 5 skills in sequence
(`design → plan → run → check → ship`), the artifact each stage reads
and writes (`docs/cys/specs/*.md` → `docs/cys/plans/*.md` → task
branches + `.cys/*` → review verdicts → PR), and the two human gates
(spec approval, PR merge) — distinct from the existing engine diagram,
which is one level deeper (`runDag` internals), not a duplicate of it.

Linked from `README.md`/`README.es.md` (near the existing engine-diagram
reference) and from `skills/guide/SKILL.md`'s stage table.

## Testing

- New test in `tests/` (file name decided at plan time, likely
  `tests/examples.test.js`) parses `examples/hello-parallel/plan.md` via
  `parsePlan`/`buildGraph` and asserts the exact graph shape (which task
  ids have edges, which don't).
- No test for the `.mmd` file itself beyond its existence and that it's
  linked from the README — Mermaid syntax isn't validated by this repo's
  toolchain, consistent with how the existing engine diagram is handled
  (no test references it either).

## Out of scope

- Any code branch item (A1–A3, B2) from the same review prompt — tracked
  on `feat/engine-limits` and `feat/run-summary`.
- An `.svg` export of the new diagram — the existing engine diagram has
  one, but generating it isn't part of this repo's toolchain (it was
  produced out-of-band); adding an `.svg` here would need the same
  out-of-band step this spec doesn't include.
