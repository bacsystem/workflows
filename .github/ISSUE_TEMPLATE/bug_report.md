---
name: Bug report
about: Something in cys (a skill, a command, or the parallel-plan-executor engine) didn't work as expected
title: ''
labels: bug
assignees: ''
---

## What happened

<!-- What did you expect, and what actually happened instead? -->

## Environment

- cys version: <!-- `claude plugin list` (Claude Code) or check .cursor-plugin/plugin.json's version if you're on Cursor -->
- Platform: <!-- Claude Code / Cursor -->
- Command or skill involved: <!-- e.g. /cys:run-plan, cys:design, cys:plan -->

## Steps to reproduce

<!-- As exact as you can — the plan/spec excerpt that triggered it is usually the fastest way for us to reproduce. -->

## Relevant `.cys/` output (if you have it)

<!--
cys already generates diagnostic artifacts on every run — pasting the
relevant one is usually the single most useful thing you can attach:
- .cys/pending.md (if the run's final review or cys:check already logged
  a finding about this)
- .cys/task-N-report.md (for the specific task that misbehaved)
- review-*.diff (if a review flagged something)
- The exact stderr/stdout of a failing command (e.g. `node bin/parse-plan.js`)
-->

## Anything else

<!-- Optional: anything you already tried, or suspect the cause might be. -->
