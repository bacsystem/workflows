export const meta = {
  name: 'parallel-plan-executor',
  description: 'Execute an implementation plan with independent tasks run in parallel via a dependency DAG: per-task briefs, adversarial review, serialized merges, git-flow handoff',
  phases: [
    { title: 'Implement' },
    { title: 'Review' },
    { title: 'Merge' },
    { title: 'Final review' },
    { title: 'Handoff' },
  ],
}

/* __SCHEDULER_SOURCE__ */

/* __VALIDATION_SOURCE__ */

/* __TIME_SOURCE__ */

// El harness puede entregar args como objeto o como string JSON según cómo se haya
// invocado la tool (comprobado en el piloto 2026-07-15): destructurar el string daba
// tasks undefined y un error que culpaba al campo equivocado.
const resolvedArgs = typeof args === 'string' ? JSON.parse(args) : args;
const { graph, tasks, planPath, repoPath, integrationBranch, executorPath, openPr, pr, mergeAuthorization } = resolvedArgs;
validateWorkflowArgs({ tasks, graph, integrationBranch, executorPath, openPr, pr, mergeAuthorization }); // falla rápido y claro, nunca deadlock
const tasksById = new Map(tasks.map((t) => [t.id, t]));

const IMPLEMENTER_SCHEMA = {
  type: 'object',
  properties: {
    status: { enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT'] },
    branch: { type: 'string' },
    baseSha: { type: 'string' },
    headSha: { type: 'string' },
    commitSummary: { type: 'string' },
    testSummary: { type: 'string' },
    reportFile: { type: 'string' },
    concerns: { type: 'string' },
    startedAt: { type: 'string', description: 'HH:MM:SS wall-clock time when work began (from `date +%H:%M:%S`)' },
    finishedAt: { type: 'string', description: 'HH:MM:SS wall-clock time right before reporting' },
  },
  required: ['status', 'branch', 'baseSha', 'headSha', 'reportFile', 'startedAt', 'finishedAt'],
};

const REVIEWER_SCHEMA = {
  type: 'object',
  properties: {
    specVerdict: { enum: ['PASS', 'FAIL'] },
    qualityVerdict: { enum: ['APPROVED', 'NEEDS_FIXES'] },
    findings: { type: 'string' },
  },
  required: ['specVerdict', 'qualityVerdict', 'findings'],
};

const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    mergeStatus: { enum: ['MERGED', 'CONFLICT'] },
    detail: { type: 'string' },
  },
  required: ['mergeStatus'],
};

const HANDOFF_SCHEMA = {
  type: 'object',
  properties: {
    handoffFile: { type: 'string' },
    versionBump: { type: 'string', description: 'proposed SemVer bump per git-flow rules, e.g. "patch -> 1.2.4" or "minor (0.x breaking) -> 0.5.0"' },
    prUrl: { type: 'string', description: 'URL of the created PR, only when openPr was requested and succeeded' },
    detail: { type: 'string' },
  },
  required: ['handoffFile'],
};

function appendLedger(line) {
  // Pasa por la misma cola que fixes y merges: dos tareas fallando a la vez hacían
  // append concurrente sobre el mismo archivo del repo principal. El contenido va entre
  // <line></line> porque incluye texto libre de otros agentes (concerns, findings) —
  // una comilla en ese texto rompía el framing del prompt.
  return enqueueMainRepo(() => agent(
    `In repo ${repoPath}, append to .cys/progress.md (create the file and ` +
    `its directory if missing) exactly the single line between the <line> tags below, ` +
    `without the tags:\n<line>${line}</line>`,
    { label: 'ledger', phase: 'Merge' }
  ));
}

// Serializa TODA operación que toca el working tree de repoPath: los merges (checkout de
// la rama de integración) y los fixes (checkout de task-<id> sin worktree propio). Un
// repo git solo puede tener una rama checked out a la vez, así que dos colas
// independientes sobre el mismo árbol seguían pisándose entre sí — la carrera fix-vs-fix
// estaba cerrada, pero fix-vs-merge no. El paralelismo real vive en los implement(), que
// corren cada uno en su worktree aislado.
let mainRepoQueueTail = Promise.resolve();
function enqueueMainRepo(fn) {
  const next = mainRepoQueueTail.then(fn, fn);
  mainRepoQueueTail = next.catch(() => {});
  return next;
}

// Textual progress bar, emitted via log() after every task settles so the user
// sees advancement in the narrator lines without opening /workflows.
let settledCount = 0;
function progressBar() {
  const total = tasks.length;
  const filled = Math.round((settledCount / total) * 20);
  return `[${'#'.repeat(filled)}${'-'.repeat(20 - filled)}] ${settledCount}/${total} tasks settled`;
}

// Único punto de incremento: toda rama terminal de runTask pasa por acá, para que la
// barra no vuelva a desincronizarse cuando se agregue una rama nueva. Idempotente por
// tarea: las ramas específicas settlean con su etiqueta y la red de seguridad de
// runTask no las cuenta dos veces.
const settledTasks = new Set();
function settle(taskId, label) {
  if (settledTasks.has(taskId)) return;
  settledTasks.add(taskId);
  settledCount += 1;
  log(`${progressBar()} — Task ${taskId} ${label}`);
}

// agent() devuelve null si el usuario saltea el agente o si murió por un error terminal
// de API; sin este guard, ese null explotaba más adelante como un TypeError críptico
// (p. ej. "Cannot read properties of null (reading 'status')").
function ensureAgentResult(taskId, value, stage) {
  if (value) return value;
  throw new Error(`Task ${taskId}: ${stage} agent returned no result (skipped or terminal API error)`);
}

// BLOCKED/NEEDS_CONTEXT puede venir tanto del implement inicial como del fix round; el
// chequeo vive acá para que ninguna de las dos rutas se lo saltee.
async function assertNotBlocked(taskId, impl) {
  if (impl.status !== 'BLOCKED' && impl.status !== 'NEEDS_CONTEXT') return;
  const detail = impl.concerns ?? 'no detail given';
  await appendLedger(`Task ${taskId}: ${impl.status} — ${detail}`);
  settle(taskId, impl.status);
  throw new Error(`Task ${taskId} ${impl.status}: ${detail}`);
}

async function implement(task) {
  // Piloto 2026-07-15, hallazgo F3: isolation:'worktree' del harness aísla el repo de la
  // SESIÓN, no repoPath — dos implementadores paralelos compartieron el working tree del
  // repo objetivo y sus ramas se pisaron. El aislamiento correcto es un worktree DEL
  // REPO OBJETIVO, creado y liberado por el propio agente.
  const worktreeDir = `${repoPath}/.worktrees/task-${task.id}`;
  return agent(
    `You are implementing Task ${task.id}: "${task.title}", from the plan at ${planPath}, ` +
    `in repo ${repoPath}.\n\n` +
    `Other tasks run in parallel against that same repository — NEVER switch branches or ` +
    `edit files in ${repoPath} itself. Your very first repo action: create your own ` +
    `isolated worktree by running \`git -C ${repoPath} worktree add ${worktreeDir} ` +
    `-b task-${task.id}\` (fixed, predictable branch name so a later fix round can find ` +
    `it), then do ALL your work — edits, tests, commits — inside ${worktreeDir}. Record ` +
    `that worktree's initial HEAD SHA as baseSha.\n\n` +
    `Run: \`node ${executorPath}/bin/task-brief.js ${planPath} ${task.id} ${repoPath}/.cys\` — ` +
    `it prints your brief file path, already inside the target repo where the reviewer will ` +
    `read it. Read ONLY that brief file for your requirements, not the whole plan.\n\n` +
    `Also read ${executorPath}/skills/check/references/code-standards.md once before writing ` +
    `any code — it binds HOW you implement (naming, unit size, YAGNI, comments, test hygiene) ` +
    `and your self-review checks against it.\n\n` +
    `Read the "## Global Constraints" section from ${planPath} yourself — it binds this task.\n\n` +
    `Your very first action overall: run \`date +%H:%M:%S\` and report that value as ` +
    `startedAt; run it again right before reporting and use it as finishedAt.\n\n` +
    `Follow strict test-driven development for every code change: write the failing test ` +
    `first, run it and verify it fails, implement minimally, verify it passes. Implement exactly ` +
    `what the brief specifies, write tests, verify RED then GREEN, commit, then self-review ` +
    `(completeness, quality, YAGNI discipline, test hygiene) before reporting.\n\n` +
    `Write your full report (what you built, TDD evidence, files changed, self-review ` +
    `findings) to .cys/task-${task.id}-report.md in repo ${repoPath} (the main ` +
    `repo, not your worktree), record HEAD's SHA as headSha, then release your worktree: ` +
    `run \`git -C ${repoPath} worktree remove --force ${worktreeDir}\` — your branch and ` +
    `commits remain, and this frees task-${task.id} for a potential fix round. Report back ` +
    `via the required fields. Use BLOCKED or NEEDS_CONTEXT if you cannot proceed — there ` +
    `is no one to ask mid-run, so describe exactly what's missing in "concerns"; it will ` +
    `be resolved after this run, not now.`,
    { label: `implement-${task.id}`, phase: 'Implement', schema: IMPLEMENTER_SCHEMA }
  );
}

async function review(task, impl) {
  return agent(
    `You are reviewing Task ${task.id}: "${task.title}" from the plan at ${planPath}. This ` +
    `is a task-scoped gate (spec compliance + code quality), not a merge review.\n\n` +
    `Run: \`node ${executorPath}/bin/review-package.js ${repoPath} ${impl.baseSha} ${impl.headSha} ${repoPath}/.cys\` — ` +
    `it prints a diff package file. Read that file once; it is your view ` +
    `of the change, do not re-run git.\n\n` +
    `Read the task brief already written at .cys/task-${task.id}-brief.md and the ` +
    `implementer's report at ${impl.reportFile}. Treat the report as unverified claims — ` +
    `verify against the diff.\n\n` +
    `Read the "## Global Constraints" section from ${planPath} yourself — it binds this task.\n\n` +
    `Also read ${executorPath}/skills/check/references/code-standards.md once — code-quality ` +
    `findings below are held to it (naming, unit size, YAGNI, dead code, comments, test hygiene).\n\n` +
    `Report: Part 1 spec compliance (Missing/Extra/Misunderstood, file:line) — verdict PASS ` +
    `or FAIL. Part 2 code quality (Critical/Important/Minor findings, file:line) — verdict ` +
    `APPROVED or NEEDS_FIXES. Findings text goes in "findings"; both verdicts are required ` +
    `fields.`,
    { label: `review-${task.id}`, phase: 'Review', schema: REVIEWER_SCHEMA }
  );
}

async function fix(task, impl, findings) {
  return agent(
    `On branch task-${task.id} in repo ${repoPath} (do not create a new worktree — check out ` +
    `that existing branch), fix these review findings for Task ${task.id}: ${findings}\n\n` +
    `If git refuses the checkout because task-${task.id} is already checked out in another ` +
    `worktree (the implementer's), run \`git worktree list\`, locate it, and do the work ` +
    `inside that worktree instead.\n\n` +
    `Run \`date +%H:%M:%S\` first (startedAt) and again before reporting (finishedAt).\n\n` +
    `Re-run the tests covering your change and append the results to ` +
    `${impl.reportFile}. Report back the new HEAD SHA as headSha; branch and ` +
    `baseSha (${impl.baseSha}) stay the same.`,
    { label: `fix-${task.id}`, phase: 'Implement', schema: IMPLEMENTER_SCHEMA }
  );
}

// Fase Handoff (v0.5.0): prepara el cierre estilo git-flow SIN ejecutarlo — el merge del
// PR y la promoción de ramas son siempre humanos. Con openPr: true (consentimiento
// explícito dado al lanzar), además pushea la feature branch y CREA el PR (crear un PR
// es pedir revisión humana, no saltearla; mergearlo sí está prohibido).
async function handoff(finalReview) {
  const prArgs = pr ?? {};
  const wantPr = openPr === true;
  return agent(
    `In repo ${repoPath}, prepare the git-flow handoff for branch ${integrationBranch}.\n\n` +
    `1. Inspect the run's work: \`git log --oneline ${integrationBranch}\` — the task-N merge ` +
    `commits and the commits they brought in. Derive the dominant Conventional ` +
    `Commit type and propose a SemVer bump per git-flow rules (>=1.0: feat=minor, fix=patch, ` +
    `BREAKING=major; 0.x: BREAKING=minor, everything else=patch). Report it as versionBump.\n\n` +
    `2. Write ${repoPath}/.cys/handoff.md containing: a suggested PR title ` +
    `(Conventional Commit subject covering the run), a PR body with Summary / Type of change / ` +
    `Main changes (one bullet per task) / Version / Checklist sections, the final review ` +
    `verdict quoted below, and a post-run cleanup checklist (merged task-N branches to delete, ` +
    `what to do with ${integrationBranch} after the PR merges). Report its path as handoffFile.\n\n` +
    (wantPr
      ? `3. Push ${integrationBranch} to the remote and create the pull request: ` +
        `\`gh pr create --base ${prArgs.base ?? 'develop'} --head ${integrationBranch}\` with the ` +
        `title and body from handoff.md, applying these fields when present: ` +
        `${JSON.stringify(prArgs)} (assignees, labels, milestone; put "Closes #<closes>" in the ` +
        `body when closes is set). Do NOT merge the PR — that gate is human. Report its URL as ` +
        `prUrl. If there is no remote or gh fails, do not retry destructively: explain in "detail".\n\n`
      : `3. Do NOT push and do NOT create any PR (openPr was not requested). Note in "detail" ` +
        `that the branch is ready for a manual git-flow handoff.\n\n`) +
    `Final whole-branch review verdict:\n<review>${finalReview ?? 'final review was not run'}</review>`,
    { label: 'handoff', phase: 'Handoff', schema: HANDOFF_SCHEMA }
  );
}

async function runTask(taskId) {
  try {
    return await executeTask(taskId);
  } catch (error) {
    // Red de seguridad: cualquier salida de executeTask — también las no previstas —
    // cuenta en la barra de progreso; settle es idempotente, así que las ramas que ya
    // settlearon con una etiqueta específica no se cuentan dos veces.
    settle(taskId, 'FAILED');
    throw error;
  }
}

async function executeTask(taskId) {
  const task = tasksById.get(taskId);
  // Señal de vida al arrancar (piloto, hallazgo F5): la barra solo se emite al settle,
  // así que sin esto el primer implement largo transcurre en silencio total.
  log(`Task ${taskId}: started (implement)`);
  let impl = ensureAgentResult(taskId, await implement(task), 'implementer');
  await assertNotBlocked(taskId, impl);

  let verdict = ensureAgentResult(taskId, await review(task, impl), 'reviewer');
  if (verdict.qualityVerdict === 'NEEDS_FIXES' || verdict.specVerdict === 'FAIL') {
    log(`Task ${taskId}: review found issues, fixing once`);
    impl = ensureAgentResult(
      taskId,
      await enqueueMainRepo(() => fix(task, impl, verdict.findings)),
      'fix'
    );
    await assertNotBlocked(taskId, impl);
    verdict = ensureAgentResult(taskId, await review(task, impl), 'reviewer');
    if (verdict.qualityVerdict === 'NEEDS_FIXES' || verdict.specVerdict === 'FAIL') {
      await appendLedger(`Task ${taskId}: blocked — review still failing after one fix round`);
      settle(taskId, 'FAILED (review)');
      throw new Error(`Task ${taskId}: review still failing after one fix round: ${verdict.findings}`);
    }
  }

  const mergeResult = ensureAgentResult(
    taskId,
    await enqueueMainRepo(() =>
      agent(
        // Piloto 8, hallazgo F9: en corridas repetidas sobre el mismo repo, la rama de una
        // task ya integrada volvía a pasar por `git merge` (no-op) y ese intento inútil
        // igual se exponía al clasificador de permisos — un bloqueo ahí tumbaba TODA la
        // corrida en cascada. El chequeo de ancestría es de solo lectura y corta antes.
        `First run \`git -C ${repoPath} merge-base --is-ancestor task-${taskId} ` +
        `${integrationBranch}\`. If it exits 0, branch task-${taskId} is ALREADY integrated: ` +
        `report mergeStatus MERGED with detail "already an ancestor, nothing to do" and do ` +
        `NOT run any merge command.\n\n` +
        `Otherwise, merge branch task-${taskId} into branch ${integrationBranch} of repo ${repoPath}. Report ` +
        `mergeStatus MERGED on success. If there is a real merge conflict, do not resolve it ` +
        `automatically — stop and report mergeStatus CONFLICT with the conflict details in "detail".` +
        (mergeAuthorization
          // Piloto 2026-07-16, hallazgo F8: sin esto, el agente de merge no tiene forma de
          // saber que el usuario ya autorizó el run — algunos se autobloqueaban leyendo la
          // política de "merges requieren autorización humana" de memoria, inconsistentemente
          // entre tareas del mismo run. La autorización debe llegar textual, no inferida.
          // Hallazgo F10 (corrida F2 de cys): la redacción anterior ("do not treat this as
          // requiring a fresh consent check") fue marcada por el clasificador de permisos
          // como intento de bypass y mató a los agentes de merge. Afirmar la autorización
          // sí; instruir a saltear chequeos del entorno, nunca.
          ? `\n\nThe user has already explicitly authorized merges for this run, in their own ` +
            `words: "${mergeAuthorization}". That authorization names task-${taskId} and ` +
            `${integrationBranch}. If the environment's permission system still asks for ` +
            `confirmation, defer to it and let it pause — that dialog is the user's gate, ` +
            `not a failure. Report honestly whatever happens.`
          : ''),
        { label: `merge-${taskId}`, phase: 'Merge', schema: MERGE_SCHEMA }
      )
    ),
    'merge'
  );

  if (mergeResult.mergeStatus === 'CONFLICT') {
    await appendLedger(`Task ${taskId}: merge CONFLICT — ${mergeResult.detail ?? 'no detail given'}`);
    settle(taskId, 'FAILED (merge conflict)');
    throw new Error(`Task ${taskId} merge CONFLICT: ${mergeResult.detail ?? 'no detail given'}`);
  }

  const duration = formatDuration(impl.startedAt, impl.finishedAt);
  await appendLedger(
    `Task ${taskId}: complete ${impl.startedAt}..${impl.finishedAt} ` +
    `(${duration}, commits ` +
    `${impl.baseSha.slice(0, 7)}..${impl.headSha.slice(0, 7)}, review clean)`
  );
  settle(taskId, `done in ${duration}`);
  return impl;
}

const results = await runDag(graph, runTask);

// Las tareas skipped nunca pasan por runTask; reconciliar para que la barra cierre en N/N.
settledCount = results.size;
log(`${progressBar()} — ejecución terminada`);

const mergedCount = [...results.values()].filter((r) => r.status === 'done').length;
let finalReview = null;
let handoffResult = null;
if (mergedCount > 0) {
  finalReview = await agent(
    `Do a broad whole-branch review of repo ${repoPath}'s \`${integrationBranch}\` branch against the ` +
    `full plan at ${planPath}. Structure it as: Strengths / Issues (Critical, Important, ` +
    `Minor — each with file:line) / Recommendations / Assessment ("Ready to merge? yes/no" ` +
    `with reasoning). Check cross-task consistency the per-task reviews couldn't see.`,
    { label: 'final-review', phase: 'Final review', effort: 'high' }
  );
  handoffResult = await handoff(finalReview);
  if (handoffResult) {
    log(`Handoff listo: ${handoffResult.handoffFile}` +
      (handoffResult.versionBump ? ` — bump propuesto: ${handoffResult.versionBump}` : '') +
      (handoffResult.prUrl ? ` — PR: ${handoffResult.prUrl}` : ''));
  } else {
    log('Handoff: el agente no devolvió resultado (salteado o error terminal); la rama queda lista para handoff manual');
  }
}

const summaryLines = [...results.entries()].map(([id, r]) => {
  if (r.status === 'done') {
    const impl = r.result;
    return `Task ${id}: done in ${formatDuration(impl?.startedAt, impl?.finishedAt)} (${impl?.startedAt}..${impl?.finishedAt})`;
  }
  if (r.status === 'failed') return `Task ${id}: FAILED — ${r.error?.message ?? 'unknown error'}`;
  return `Task ${id}: skipped — ${r.reason}`;
});
log(summaryLines.join('\n'));
if (finalReview) log(`Final whole-branch review:\n${finalReview}`);

// Un Error de JS serializa a {} al pasar por JSON: sin este mapeo, el objeto retornado
// perdía la causa de cada tarea failed (piloto 2/5 — el mensaje solo quedaba en los logs).
const serializableResults = Object.fromEntries(
  [...results.entries()].map(([id, r]) => [
    id,
    r.status === 'failed'
      ? { status: 'failed', error: r.error?.message ?? String(r.error) }
      : r,
  ])
);
return { results: serializableResults, finalReview, handoff: handoffResult };
