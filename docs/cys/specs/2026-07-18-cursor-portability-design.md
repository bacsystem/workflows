# cys on Cursor — Design Spec

**Goal:** make cys's five non-engine skills (`design`, `plan`, `check`,
`ship`, `guide`) installable and usable in Cursor, reusing their content
as-is — no forked copies to keep in sync. `cys:run` (the parallel
Workflow engine) stays explicitly Claude-Code-only; this spec does not
attempt to port it.

## Why this scope

Cursor turned out to be a much closer match than assumed when multi-AI
portability was first postponed: it has an official plugin format
(`.cursor-plugin/plugin.json`, documented at `cursor.com/docs/plugins`)
with a `skills` field that auto-discovers `SKILL.md` files the same way
Claude Code does, plus its own on-demand skill-invocation model
(`/skill-name`) — architecturally the same shape as Claude Code's Skill
tool, not a different primitive like Gemini CLI's context-only or
subagent-only models (investigated the same day, deferred — see
`.cys/pending.md`).

Cursor also has real background subagents with git-worktree isolation
(since Cursor 2.5), which is architecturally close to what `cys:run`
does — but confirming a full port of the DAG scheduler, adversarial
review, and serialized-merge logic onto that primitive is a separate,
much larger investigation. Deliberately out of scope here; tracked as a
follow-up in `.cys/pending.md` if this port goes well.

## Design

### One shared `skills/` directory, not a fork

Every skill under `skills/*/SKILL.md` (plus their `references/` and
`scripts/` subdirectories) is plain Markdown/shell with no Claude-Code-
specific tool coupling — confirmed by inspection, nothing in `design`,
`plan`, `check`, or `ship` mentions a Claude-Code-only tool name or
behavior. They can be pointed at by both plugin manifests unchanged:

- `.claude-plugin/plugin.json` (existing) — Claude Code's own discovery.
- `.cursor-plugin/plugin.json` (new) — `"skills": "./skills/"`, same
  directory, same files, zero duplication.

### The one content change: `cys:guide`'s Stage 3 note

`cys:guide` is the only skill that names `cys:run` by title (its flow
table, Stage 3). On Cursor, there is no `cys:run` yet — plans produced by
`cys:plan` have no automated parallel executor to hand off to. Rather
than forking `cys:guide` per platform, it gets one added paragraph,
readable regardless of platform: *when `cys:run`/`/cys:run-plan` isn't
available (Cursor, for now), execute the plan's tasks yourself in
dependency order — one at a time, or by hand-dispatching Cursor's own
subagents per task — without the automated DAG scheduling, adversarial
review, or serialized merging `cys:run` provides on Claude Code.* This
keeps the skill single-sourced while being honest about the gap on the
platform where it matters.

### `commands/flow.md` and `commands/run-plan.md` are not ported

Both existing commands exist to launch `cys:run` — `flow.md`'s entire
back half is Design → Plan → *launch the Workflow*, and `run-plan.md` IS
the Workflow launcher. Neither has a meaningful Cursor equivalent while
`cys:run` itself is out of scope, so this spec adds no `.cursor/commands/`
directory. A Cursor user reaches `cys:design`/`cys:plan` by invoking
those skills directly (`/design`, `/plan` per Cursor's own convention),
same as any other Cursor skill.

### New `.cursor-plugin/plugin.json`

Mirrors `.claude-plugin/plugin.json`'s metadata, adjusted for the
narrower scope:

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

Version stays in lockstep with `package.json`/`.claude-plugin/plugin.json`
— same sync rule the existing test already enforces for the Claude Code
manifest, extended to cover this one too.

### README

`README.md`/`README.es.md` gain a short "Cursor" note alongside the
existing Claude Code install instructions: what's available (5 skills),
what isn't yet (`cys:run`'s parallel execution), and how to install
(point Cursor at this repo's `.cursor-plugin/`).

## Out of scope

- Porting `cys:run` itself (the DAG scheduler, adversarial review,
  serialized merge, Handoff agent) to Cursor's subagents — a distinct,
  much larger design if pursued later.
- Gemini CLI — deferred the same day this spec was written; its
  skill-equivalent (subagents with their own context) is architecturally
  different enough from Cursor/Claude Code's shared model that it needs
  its own design, not an extension of this one.
- Any change to `workflows-src/parallel-plan-executor.template.js`,
  `workflows/parallel-plan-executor.js`, or `commands/*.md`.
- Cursor-specific hooks (`hooks/hooks-cursor.json` in the superpowers
  example) — cys has no Claude Code hooks today either, so there's
  nothing to port.

## Testing

`tests/skills.test.js` gets new assertions:

- `.cursor-plugin/plugin.json` exists, has the required `name` field, and
  its `skills` field is exactly `"./skills/"` (proving no forked/duplicated
  skill directory was introduced).
- Its `version` matches `package.json`'s (same sync discipline as the
  existing Claude Code manifest check).
- `skills/guide/SKILL.md` mentions Cursor and describes the manual
  fallback when `cys:run` isn't available.
