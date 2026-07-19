# cys on Gemini CLI — Design Spec

**Goal:** make cys's five non-engine skills (`design`, `plan`, `check`,
`ship`, `guide`) installable and usable in Gemini CLI, reusing their
content as-is — no forked copies to keep in sync. `cys:run` (the parallel
Workflow engine) stays explicitly Claude-Code-only; this spec does not
attempt to port it. Same scope boundary as the existing Cursor port
(`docs/cys/specs/2026-07-18-cursor-portability-design.md`).

## Why this scope, and why now

Gemini CLI portability was investigated and deferred on 2026-07-18,
during the Cursor design, on the assumption that Gemini's only
on-demand-invocation primitive was subagents (`.gemini/agents/*.md`) —
architecturally a separate-context delegate, not something that could
carry an interactive, ask-one-question-at-a-time conversation like
`cys:design` needs in the *same* thread as the user.

Re-verified 2026-07-19 before starting this spec, because Cursor's own
plugin UI had already changed once mid-project between research and
actual use, and this research was five days old. The re-check found the
premise had changed:

- Gemini CLI shipped a native **Agent Skills** feature (`.gemini/docs/cli/skills.md`),
  first appearing in the stable (non-preview) `v0.44.0` release, still
  receiving stable-channel fixes as of `v0.49.0` — not behind a
  `--preview` flag or feature gate. Confirmed via `gh api
  repos/google-gemini/gemini-cli/releases/tags/<v>` on both tags.
- A skill activates via a model-called `activate_skill` tool; on user
  approval, the `SKILL.md` body is added to the **current conversation
  history** — not delegated to a separate subagent context. This is the
  same shape as Claude Code's Skill tool and Cursor's `/skill-name`
  invocation, and satisfies the interactive-conversation requirement
  `cys:design` depends on.
- `SKILL.md` frontmatter needs only `name` + `description` — identical to
  what cys's files already use.
- Distribution turned out simpler than Cursor's, once traced through the
  actual install path: `gemini extensions install <github-url>` clones
  the **whole repository** to `~/.gemini/extensions/<name>/` (global,
  available in every project afterward — confirmed via
  `docs/extensions/reference.md`), and Gemini discovers skills by a pure
  directory-name convention (`skills/<name>/SKILL.md`) with **no manifest
  field declaring the path** — confirmed against two real published
  extensions (`apify/agent-skills`, `buildatscale-tv/gemini-skills`) whose
  `gemini-extension.json` files carry no `skills` key at all.

Because our `skills/` directory already contains exactly `check/`,
`design/`, `guide/`, `plan/`, `ship/` — no `run/` — an installed cys
extension auto-discovers precisely the five in-scope skills with zero
extra work. This is a smaller change than the Cursor port: no `"skills"`
path field, no directory restructuring, no copies, no symlinks.

## Design

### One shared `skills/` directory, not a fork

Same principle as Cursor: every skill under `skills/*/SKILL.md` (plus
`references/`/`scripts/` subdirectories) is plain Markdown/shell with no
Claude-Code-specific tool coupling. A `gemini-extension.json` at the repo
root is enough to make the existing directory installable — no new
skills directory, no build step, no generated copies.

### New `gemini-extension.json`

Mirrors `.claude-plugin/plugin.json`/`.cursor-plugin/plugin.json`'s
metadata shape, adjusted to Gemini's own field set (confirmed against
`docs/extensions/reference.md`: `name`, `version`, `description`,
`repository` all apply; no `skills`, `contextFileName`, `mcpServers`, or
`excludeTools` are needed for this scope):

```json
{
  "name": "cys",
  "version": "0.6.13",
  "description": "Development methodology skills for design, plan, check, and ship — parallel plan execution (cys:run) is Claude Code only for now.",
  "repository": "https://github.com/bacsystem/parallel-plan-executor",
  "license": "MIT"
}
```

Version stays in lockstep with `package.json`/`.claude-plugin/plugin.json`/
`.cursor-plugin/plugin.json` — same sync rule the existing tests already
enforce for those three, extended to cover this fourth file.

### The one content change: generalizing the platform note

`skills/guide/SKILL.md` (Stage 3 note) and `skills/plan/SKILL.md` (Hand
off section) currently name Cursor specifically as the platform where
`cys:run` isn't available. Both get reworded to name Gemini CLI
alongside Cursor, without forking either file per platform — e.g.
*"On platforms other than Claude Code (Cursor, Gemini CLI), `cys:run`
isn't available — execute the plan's tasks yourself in dependency order,
one at a time or by hand-dispatching the platform's own subagents per
task, without `cys:run`'s DAG scheduling, adversarial review, or
serialized merging."* This keeps both skills single-sourced across all
three platforms.

### `commands/flow.md` and `commands/run-plan.md` are not ported

Same reasoning as the Cursor spec: both exist solely to launch
`cys:run`, which is out of scope here. A Gemini CLI user reaches
`cys:design`/`cys:plan` by invoking those skills directly, same as any
other Gemini Agent Skill.

### README

`README.md`/`README.es.md` gain a "Gemini CLI" install section alongside
the existing Claude Code and Cursor ones: the install command
(`gemini extensions install https://github.com/bacsystem/parallel-plan-executor`),
what's available (5 skills) vs. not (`cys:run`'s parallel execution), and
a note that `gemini extensions update` is needed to pick up future
releases (install copies the repo rather than tracking it live —
confirmed via `docs/extensions/reference.md` and GitHub issue #5993).

## Out of scope

- Porting `cys:run` itself to Gemini CLI subagents — a distinct, much
  larger design if pursued later. Gemini's subagents (`.gemini/agents/*.md`)
  remain architecturally separate-context, same finding as before; a
  full port would need its own investigation into whether they can host
  worktree-isolated parallel execution at all.
- Any change to `workflows-src/parallel-plan-executor.template.js`,
  `workflows/parallel-plan-executor.js`, or `commands/*.md`.
- A `GEMINI.md` context file — skill discovery is description-based
  (same model as Claude Code's Skill tool), so no always-loaded context
  file is needed for this scope.
- Publishing to any Gemini extension registry/marketplace beyond the
  plain `gemini extensions install <github-url>` flow — no such registry
  was found to exist for Gemini CLI at investigation time.

## Testing

`tests/skills.test.js` gets new assertions:

- `gemini-extension.json` exists at the repo root, has `name === 'cys'`,
  and a non-empty `description`.
- Its `version` matches `package.json`'s (same sync discipline as the
  existing Claude Code and Cursor manifest checks).
- No `skills/run/` directory exists (proving `cys:run` stays out of the
  auto-discovered set — a regression here would silently expose it).
- `skills/guide/SKILL.md` and `skills/plan/SKILL.md` both mention Gemini
  CLI alongside Cursor in their platform-fallback notes.
