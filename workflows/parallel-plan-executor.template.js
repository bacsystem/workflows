export const meta = {
  name: 'parallel-plan-executor',
  description: 'Execute a writing-plans implementation plan with independent tasks run in parallel via a dependency DAG, reusing subagent-driven-development\'s task-brief/review-package/ledger machinery',
  phases: [
    { title: 'Implement' },
    { title: 'Review' },
    { title: 'Merge' },
    { title: 'Final review' },
  ],
}

/* __SCHEDULER_SOURCE__ */

/* __VALIDATION_SOURCE__ */

/* __TIME_SOURCE__ */

// El harness puede entregar args como objeto o como string JSON según cómo se haya
// invocado la tool (comprobado en el piloto 2026-07-15): destructurar el string daba
// tasks undefined y un error que culpaba al campo equivocado.
const resolvedArgs = typeof args === 'string' ? JSON.parse(args) : args;
const { graph, tasks, planPath, repoPath, integrationBranch } = resolvedArgs;
validateWorkflowArgs({ tasks, graph, integrationBranch }); // falla rápido y claro, nunca deadlock
const tasksById = new Map(tasks.map((t) => [t.id, t]));

const FIND_SDD_SCRIPTS =
  'Locate the superpowers:subagent-driven-development skill\'s scripts directory — search ' +
  'under the Claude Code plugin cache for a path ending in ' +
  '"subagent-driven-development/scripts" (it contains task-brief and review-package).';

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

function appendLedger(line) {
  // Pasa por la misma cola que fixes y merges: dos tareas fallando a la vez hacían
  // append concurrente sobre el mismo archivo del repo principal. El contenido va entre
  // <line></line> porque incluye texto libre de otros agentes (concerns, findings) —
  // una comilla en ese texto rompía el framing del prompt.
  return enqueueMainRepo(() => agent(
    `In repo ${repoPath}, append to .superpowers/sdd/progress.md (create the file and ` +
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
    `${FIND_SDD_SCRIPTS} Run: task-brief ${planPath} ${task.id} — it prints your brief ` +
    `file path. Read ONLY that brief file for your requirements, not the whole plan. If ` +
    `that brief file is not already under ${repoPath}/.superpowers/sdd/, copy it to ` +
    `${repoPath}/.superpowers/sdd/task-${task.id}-brief.md — the reviewer reads it from there.\n\n` +
    `Read the "## Global Constraints" section from ${planPath} yourself — it binds this task.\n\n` +
    `Your very first action overall: run \`date +%H:%M:%S\` and report that value as ` +
    `startedAt; run it again right before reporting and use it as finishedAt.\n\n` +
    `Follow superpowers:test-driven-development for every code change. Implement exactly ` +
    `what the brief specifies, write tests, verify RED then GREEN, commit, then self-review ` +
    `(completeness, quality, YAGNI discipline, test hygiene) before reporting.\n\n` +
    `Write your full report (what you built, TDD evidence, files changed, self-review ` +
    `findings) to .superpowers/sdd/task-${task.id}-report.md in repo ${repoPath} (the main ` +
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
    `${FIND_SDD_SCRIPTS} Run: review-package ${impl.baseSha} ${impl.headSha} — it prints a ` +
    `diff package file. Read that file once; it is your view of the change, do not re-run git.\n\n` +
    `Read the task brief already written at .superpowers/sdd/task-${task.id}-brief.md and the ` +
    `implementer's report at ${impl.reportFile}. Treat the report as unverified claims — ` +
    `verify against the diff.\n\n` +
    `Read the "## Global Constraints" section from ${planPath} yourself — it binds this task.\n\n` +
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
        `Merge branch task-${taskId} into branch ${integrationBranch} of repo ${repoPath}. Report ` +
        `mergeStatus MERGED on success. If there is a real merge conflict, do not resolve it ` +
        `automatically — stop and report mergeStatus CONFLICT with the conflict details in "detail".`,
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
if (mergedCount > 0) {
  finalReview = await agent(
    `Do a broad whole-branch review of repo ${repoPath}'s \`${integrationBranch}\` branch against the ` +
    `full plan at ${planPath} (use superpowers:requesting-code-review's code-reviewer ` +
    `template). Check cross-task consistency the per-task reviews couldn't see.`,
    { label: 'final-review', phase: 'Final review', effort: 'high' }
  );
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
return { results: serializableResults, finalReview };
