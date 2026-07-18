# Fase 4c: Manual Retry Guide — Design Spec

**Goal:** when a `cys:run` gets cut short by a session/token limit, help the
user get back to it with less friction than "remember to type
`/cys:run-plan` again" — by generating, at launch time, ready-to-paste
config for a Claude Code Desktop Local Routine that checks for leftover
`.cys/state.json` and resumes the run on its own, while the user is away.

## Why this scope, not full automation

This was originally scoped as automatic, `ScheduleWakeup`-driven retry.
Three mechanisms were investigated and ruled out before landing on this
one — recorded here so the reasoning isn't re-derived later:

1. **`ScheduleWakeup`** — internal to the `/loop` skill's dynamic-pacing
   mode, not callable from an arbitrary command; and even if it were, it
   does not survive the session ending ("Tasks only fire while Claude Code
   is running and idle. Closing the terminal or letting the session exit
   stops them firing.") — exactly the scenario this feature exists to
   solve.
2. **`CronCreate`** — session-only ("nothing is written to disk, and the
   job is gone when Claude exits"). Same failure mode as `ScheduleWakeup`.
3. **`/schedule` remote Routines** — survive session end, but run in a
   fresh cloud clone with **no access to local files**
   ("Access to local files: No (fresh clone)"). `.cys/state.json` is local
   and gitignored by design — a cloud Routine can never see it.
4. **Claude Code Desktop *Local* Routines** — the one mechanism that is
   both durable (survives session end, persists across app restarts) and
   has real local filesystem access. The catch: **creating one is strictly
   interactive** — there is no tool an agent can call to create a Local
   Routine on the user's behalf, only the Desktop UI (Routines → New
   routine → Local) or a guided conversational setup, both requiring the
   human to complete the last step themselves.
5. **Windows Task Scheduler + headless `claude -p`** — investigated as an
   alternative once (4) turned out to be interactive-only. Headless mode
   does support plugin slash commands and reuses the interactive OAuth
   login (no separate API key needed), so it's technically viable — but
   it's OS-specific DIY (Windows only; Mac/Linux would need separate
   `launchd`/`cron` recipes), undocumented for Task Scheduler specifically,
   and roughly triples the maintenance surface for what both the user and
   this document agree is a nice-to-have. **Deferred**, not ruled out —
   revisit in `.cys/pending.md` if (4) proves too much friction in
   practice.

Given (1)–(3) are dead ends and (5) is deferred, this spec implements (4)
at the only scope actually available today: cys does the thinking (what
to check, what prompt to resume with), the user does the one manual step
(pasting it into the Desktop app) — once per run, not once per interruption.

## Design

### When it's offered

At the end of the existing launch flow in `/cys:run-plan` and `/cys:flow`
— **after** the user has answered the existing questions (`openPr`,
`pr.base`, merge authorization) and the run has been launched, not before.
It's a closing offer, not a precondition: declining it doesn't change
anything about the run itself.

One question, plain language: *"¿Querés que te arme el texto para
configurar un reintento manual (Routine Local de Desktop) por si esta
corrida se corta?"* On "no" (or no Desktop app / not interested), the
step is skipped entirely — nothing is generated, nothing is mentioned
again for this run.

### What cys generates

On "yes", cys prints a ready-to-paste block using the run's own already-
known parameters — nothing new is asked:

```
Nombre: cys auto-retry — <slug del plan o de la rama de integración>

Instrucciones:
Check whether <repoPath>/.cys/state.json exists. If it does not exist,
do nothing and finish immediately — there is nothing to resume.
If it exists, resume the interrupted cys run: invoke
/cys:run-plan <planPath> <repoPath> <integrationBranch> to resume it.
When asked whether to open a PR at the end, answer <"yes, base <pr.base>"
or "no">. When asked for merge authorization, say you don't have one for
this attempt — let any merge pause for the user's own permission click
instead of guessing one.

Horario sugerido: cada 15 minutos
Carpeta: <repoPath>
```

Along with a short note on where to paste it: Claude Code Desktop →
Routines → New routine → Local (or describe the same thing conversationally
to Claude in a Desktop session, which walks through the same form).

### Why no merge authorization in the generated prompt

The Routine fires unattended — there is no human present to type a fresh
"I authorize merging task-N into X" the way `cys:flow`/`cys:run-plan`
normally require (never fabricated, never assumed — merges always need a
human's own words naming the branches). Rather than persisting the
original launch's authorization text and replaying it automatically
(which would technically be honoring consent already given, but is a
sharper edge than this spec wants to introduce on a first pass), the
resumed run simply runs **without** `mergeAuthorization`. Per the existing,
unchanged behavior of `/cys:run-plan`/`/cys:flow`, that means: implement
and review phases proceed normally (no authorization needed there), and
each merge pauses for the user's own permission dialog. Net effect: the
user comes back to a run that got further than where they left it —
possibly all the way through, possibly parked at a merge waiting for one
click — never to a run that merged something on their behalf without a
fresh, explicit "yes."

This also means **zero engine changes** — nothing in
`workflows-src/parallel-plan-executor.template.js` changes. The whole
feature is generated text in the command layer.

### Cleanup

The generated block's accompanying note tells the user to delete or
disable the Routine once the run finishes (`.cys/state.json` is gone) or
once they no longer need it. There is no documented mechanism for a
Routine to delete itself, so this stays manual — flagging it rather than
pretending otherwise.

### Where this lives

- `commands/run-plan.md` — new step at the very end (after today's
  "After launching" step): ask the one question, print the block on "yes".
- `commands/flow.md` — same addition, same place in its own launch flow.
- No changes to `workflows-src/parallel-plan-executor.template.js`,
  `workflows/parallel-plan-executor.js`, or any `.cys/` runtime artifact.

## Out of scope

- Programmatic creation of the Routine — confirmed impossible with
  currently available tools.
- Self-deleting/self-disabling Routines — no confirmed mechanism.
- Windows Task Scheduler / headless-CLI automation — deferred (see
  point 5 above), tracked in `.cys/pending.md` if revisited.
- Persisting/replaying the original `mergeAuthorization` on resume — the
  resumed run simply runs without one; merges pause for permission as
  they normally would.
- Any change to how `.cys/state.json` itself is written, read, or
  structured — this spec only adds a text-generation step that reads the
  same parameters the launch flow already collects.

## Testing

`tests/skills.test.js` gets a new assertion: both `commands/run-plan.md`
and `commands/flow.md` mention the Local Routine offer and the exact
resume-invocation shape (`.cys/state.json` check + `/cys:run-plan` +
"without" merge authorization), so the generated block's content is
locked in text, not just described in prose.
