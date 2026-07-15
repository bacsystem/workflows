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

async function runDag(graph, taskFn) {
  const results = new Map();
  const started = new Map();

  function run(taskId) {
    if (started.has(taskId)) return started.get(taskId);

    const promise = (async () => {
      const deps = graph[taskId] ?? [];
      const depOutcomes = await Promise.allSettled(deps.map(run));
      const blockedIndex = depOutcomes.findIndex((outcome) => outcome.status === 'rejected');
      if (blockedIndex !== -1) {
        const blockedBy = deps[blockedIndex];
        results.set(taskId, {
          status: 'skipped',
          reason: `blocked by a failed dependency (task ${blockedBy})`,
        });
        throw new Error(`task ${taskId} skipped: blocked by dependency ${blockedBy}`);
      }

      try {
        const result = await taskFn(taskId);
        results.set(taskId, { status: 'done', result });
      } catch (error) {
        results.set(taskId, { status: 'failed', error });
        throw error;
      }
    })();

    started.set(taskId, promise);
    return promise;
  }

  const allIds = Object.keys(graph).map(Number);
  await Promise.allSettled(allIds.map(run));
  return results;
}


function buildGraphWithDiagnostics(tasks) {
  const warnings = [];
  const producersOf = new Map(); // symbol -> [taskIds en orden de aparición]
  for (const task of tasks) {
    for (const symbol of task.interfaces.produces) {
      if (!producersOf.has(symbol)) producersOf.set(symbol, []);
      const producers = producersOf.get(symbol);
      if (!producers.includes(task.id)) producers.push(task.id);
    }
  }

  const producedBy = new Map(); // symbol -> taskId (el primer productor gana)
  for (const [symbol, producers] of producersOf) {
    producedBy.set(symbol, producers[0]);
    if (producers.length > 1) {
      // Ambigüedad real del plan (dos tareas dicen crear lo mismo): es warning, no
      // error — no impide ejecutar, pero el usuario debe enterarse en vez de que se
      // resuelva en silencio por orden de aparición.
      warnings.push(
        `Symbol ${symbol} is declared as produced by tasks ${producers.join(', ')} — ` +
        `first producer wins (task ${producers[0]})`
      );
    }
  }

  const deps = new Map(tasks.map((t) => [t.id, new Set()]));
  const fileOwner = new Map(); // filePath -> first taskId to touch it

  for (const task of tasks) {
    for (const symbol of task.interfaces.consumes) {
      const producerId = producedBy.get(symbol);
      if (producerId !== undefined && producerId !== task.id) {
        deps.get(task.id).add(producerId);
      }
    }

    const touchedFiles = [...task.files.create, ...task.files.modify, ...task.files.test];
    for (const file of touchedFiles) {
      const previousOwner = fileOwner.get(file);
      if (previousOwner !== undefined && previousOwner !== task.id) {
        deps.get(task.id).add(previousOwner);
      }
      fileOwner.set(file, task.id); // el último que lo toca pasa a ser el dueño
    }
  }

  const graph = {};
  for (const [taskId, depSet] of deps) {
    graph[taskId] = [...depSet].sort((a, b) => a - b);
  }

  assertAcyclic(graph);
  return { graph, warnings };
}

function buildGraph(tasks) {
  return buildGraphWithDiagnostics(tasks).graph;
}

function assertAcyclic(graph) {
  const UNVISITED = 0;
  const VISITING = 1;
  const DONE = 2;
  const state = new Map();

  function visit(id, chain) {
    const current = state.get(id) ?? UNVISITED;
    if (current === DONE) return;
    if (current === VISITING) {
      throw new Error(`Cycle detected in plan dependency graph: ${[...chain, id].join(' -> ')}`);
    }
    state.set(id, VISITING);
    for (const dep of graph[id] ?? []) {
      visit(dep, [...chain, id]);
    }
    state.set(id, DONE);
  }

  for (const id of Object.keys(graph).map(Number)) {
    visit(id, []);
  }
}


// El workflow recibe tasks/graph como JSON pegado a mano por el usuario (ver README);
// un ciclo en ese grafo deja a runDag esperando su propia promesa memoizada para
// siempre — deadlock sin error ni log. Esta validación corre antes de lanzar cualquier
// agente para que el fallo sea inmediato y explicable.
function validateWorkflowArgs({ tasks, graph }) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('args.tasks must be a non-empty array');
  }
  if (!graph || typeof graph !== 'object') {
    throw new Error('args.graph must be an object');
  }

  const taskIds = new Set(tasks.map((t) => t.id));

  for (const key of Object.keys(graph)) {
    const id = Number(key);
    if (!taskIds.has(id)) {
      throw new Error(`Graph references task ${id}, which is not present in tasks`);
    }
    for (const dep of graph[key]) {
      if (!taskIds.has(dep)) {
        throw new Error(`Task ${id} declares dependency ${dep}, which is not present in tasks`);
      }
    }
  }

  for (const id of taskIds) {
    if (graph[id] === undefined) {
      throw new Error(`Task ${id} is missing from the graph`);
    }
  }

  assertAcyclic(graph); // falla ruidosamente antes de que runDag pueda deadlockear
}


const { graph, tasks, planPath, repoPath } = args;
validateWorkflowArgs({ tasks, graph }); // falla rápido y claro, nunca deadlock
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

// The Workflow sandbox forbids Date.now()/new Date() (resume determinism), so wall-clock
// times come from the agents themselves (they run `date`); the script only does string
// arithmetic on HH:MM:SS values it was handed.
function hhmmssToSeconds(t) {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function formatDuration(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return 'duration unknown';
  let secs = hhmmssToSeconds(finishedAt) - hhmmssToSeconds(startedAt);
  if (secs < 0) secs += 24 * 3600; // crossed midnight
  return `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}s`;
}

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
  return agent(
    `In repo ${repoPath}, append this exact line to .superpowers/sdd/progress.md ` +
    `(create the file and its directory if missing): "${line}"`,
    { label: 'ledger', phase: 'Merge' }
  );
}

let mergeQueueTail = Promise.resolve();
function enqueueMerge(fn) {
  const next = mergeQueueTail.then(fn, fn);
  mergeQueueTail = next.catch(() => {});
  return next;
}

// Los agentes de fix hacen checkout de su rama task-<id> en el repo principal (no en un
// worktree propio), y un repo git solo puede tener una rama checked out a la vez — dos
// reviews fallidas concurrentes se pisarían el working tree. Misma solución que los
// merges: una cola que los serializa.
let fixQueueTail = Promise.resolve();
function enqueueFix(fn) {
  const next = fixQueueTail.then(fn, fn);
  fixQueueTail = next.catch(() => {});
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
// barra no vuelva a desincronizarse cuando se agregue una rama nueva.
function settle(taskId, label) {
  settledCount += 1;
  log(`${progressBar()} — Task ${taskId} ${label}`);
}

async function implement(task) {
  return agent(
    `You are implementing Task ${task.id}: "${task.title}", from the plan at ${planPath}, ` +
    `in repo ${repoPath}.\n\n` +
    `${FIND_SDD_SCRIPTS} Run: task-brief ${planPath} ${task.id} — it prints your brief ` +
    `file path. Read ONLY that brief file for your requirements, not the whole plan.\n\n` +
    `Read the "## Global Constraints" section from ${planPath} yourself — it binds this task.\n\n` +
    `Your very first action: run \`date +%H:%M:%S\` and report that value as startedAt; run ` +
    `it again right before reporting and use it as finishedAt.\n\n` +
    `Before starting: create and switch to branch task-${task.id} (a fixed, predictable ` +
    `name so a later fix round can find it), then record its parent commit SHA as baseSha.\n\n` +
    `Follow superpowers:test-driven-development for every code change. Implement exactly ` +
    `what the brief specifies, write tests, verify RED then GREEN, commit, then self-review ` +
    `(completeness, quality, YAGNI discipline, test hygiene) before reporting.\n\n` +
    `Write your full report (what you built, TDD evidence, files changed, self-review ` +
    `findings) to .superpowers/sdd/task-${task.id}-report.md in repo ${repoPath}, then ` +
    `record HEAD's SHA as headSha and report back via the required fields. Use BLOCKED or ` +
    `NEEDS_CONTEXT if you cannot proceed — there is no one to ask mid-run, so describe ` +
    `exactly what's missing in "concerns"; it will be resolved after this run, not now.`,
    { label: `implement-${task.id}`, phase: 'Implement', isolation: 'worktree', schema: IMPLEMENTER_SCHEMA }
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
    `Run \`date +%H:%M:%S\` first (startedAt) and again before reporting (finishedAt).\n\n` +
    `Re-run the tests covering your change and append the results to ` +
    `${impl.reportFile}. Report back the new HEAD SHA as headSha (baseSha and branch stay ` +
    `the same).`,
    { label: `fix-${task.id}`, phase: 'Implement', schema: IMPLEMENTER_SCHEMA }
  );
}

async function runTask(taskId) {
  const task = tasksById.get(taskId);
  let impl;
  try {
    impl = await implement(task);
  } catch (error) {
    settle(taskId, 'FAILED');
    throw error;
  }

  if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
    await appendLedger(`Task ${taskId}: ${impl.status} — ${impl.concerns ?? 'no detail given'}`);
    settle(taskId, impl.status);
    throw new Error(`Task ${taskId} ${impl.status}: ${impl.concerns ?? 'no detail given'}`);
  }

  let verdict = await review(task, impl);
  if (verdict.qualityVerdict === 'NEEDS_FIXES' || verdict.specVerdict === 'FAIL') {
    log(`Task ${taskId}: review found issues, fixing once`);
    impl = await enqueueFix(() => fix(task, impl, verdict.findings));
    verdict = await review(task, impl);
    if (verdict.qualityVerdict === 'NEEDS_FIXES' || verdict.specVerdict === 'FAIL') {
      await appendLedger(`Task ${taskId}: blocked — review still failing after one fix round`);
      settle(taskId, 'FAILED (review)');
      throw new Error(`Task ${taskId}: review still failing after one fix round: ${verdict.findings}`);
    }
  }

  const mergeResult = await enqueueMerge(() =>
    agent(
      `Merge branch task-${taskId} into the integration branch of repo ${repoPath}. Report ` +
      `mergeStatus MERGED on success. If there is a real merge conflict, do not resolve it ` +
      `automatically — stop and report mergeStatus CONFLICT with the conflict details in "detail".`,
      { label: `merge-${taskId}`, phase: 'Merge', schema: MERGE_SCHEMA }
    )
  );

  if (mergeResult.mergeStatus === 'CONFLICT') {
    await appendLedger(`Task ${taskId}: merge CONFLICT — ${mergeResult.detail ?? 'no detail given'}`);
    settle(taskId, 'FAILED (merge conflict)');
    throw new Error(`Task ${taskId} merge CONFLICT: ${mergeResult.detail ?? 'no detail given'}`);
  }

  await appendLedger(
    `Task ${taskId}: complete ${impl.startedAt}..${impl.finishedAt} ` +
    `(${formatDuration(impl.startedAt, impl.finishedAt)}, commits ` +
    `${impl.baseSha.slice(0, 7)}..${impl.headSha.slice(0, 7)}, review clean)`
  );
  settle(taskId, `done in ${formatDuration(impl.startedAt, impl.finishedAt)}`);
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
    `Do a broad whole-branch review of repo ${repoPath}'s integration branch against the ` +
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

return { results: Object.fromEntries(results), finalReview };
