export const meta = {
  name: 'parallel-plan-executor',
  description: 'Execute an implementation plan with independent tasks run in parallel via a dependency DAG: per-task briefs, adversarial review, serialized merges, git-flow handoff',
  phases: [
    { title: 'Implement' },
    { title: 'Review' },
    { title: 'Merge' },
    { title: 'State' },
    { title: 'Final review' },
    { title: 'Handoff' },
  ],
}

async function runDag(graph, taskFn, options = {}) {
  const { maxConcurrency = Infinity } = options;
  const results = new Map();
  const started = new Map();

  let available = maxConcurrency;
  const waiters = [];
  const acquire = () => (available > 0
    ? (available--, Promise.resolve())
    : new Promise((resolve) => waiters.push(resolve)));
  const release = () => {
    const next = waiters.shift();
    if (next) next();
    else available++;
  };

  function run(taskId) {
    if (started.has(taskId)) return started.get(taskId);

    const promise = (async () => {
      const deps = graph[taskId] ?? [];
      const depOutcomes = await Promise.allSettled(deps.map(run));
      const blockedIndex = depOutcomes.findIndex((outcome) => outcome.status === 'rejected');
      if (blockedIndex !== -1) {
        const blockedBy = deps[blockedIndex];
        // El bloqueador pudo haber fallado él mismo o haber sido skipped por su propia
        // dependencia; el motivo distingue ambos casos y propaga la causa raíz original,
        // no el eslabón intermedio de la cascada.
        const blocker = results.get(blockedBy);
        const rootCauseId = blocker?.status === 'skipped' ? blocker.rootCauseId : blockedBy;
        const reason = blocker?.status === 'skipped'
          ? `blocked by a skipped dependency (task ${blockedBy}); root cause: task ${rootCauseId} failed`
          : `blocked by a failed dependency (task ${blockedBy})`;
        results.set(taskId, { status: 'skipped', reason, rootCauseId });
        throw new Error(`task ${taskId} skipped: ${reason}`);
      }

      // El slot de concurrencia se toma acá, después de resolver dependencias — nunca
      // alrededor del await de arriba. Gatear la espera de dependencias dejaría una tarea
      // bloqueada ocupando un slot que sus propias dependencias podrían necesitar: deadlock.
      await acquire();
      try {
        const result = await taskFn(taskId);
        results.set(taskId, { status: 'done', result });
      } catch (error) {
        results.set(taskId, { status: 'failed', error });
        throw error;
      } finally {
        release();
      }
    })();

    started.set(taskId, promise);
    return promise;
  }

  const allIds = Object.keys(graph).map(Number);
  await Promise.allSettled(allIds.map(run));
  return results;
}


// Dos tareas con el mismo id colapsarían en una sola entrada del grafo (y de tasksById
// en el workflow) y una de ellas nunca se ejecutaría, sin que nadie lo reporte. Vive acá
// porque este módulo es dueño del Map que colapsa; el parser y validateWorkflowArgs lo
// reutilizan como guard de sus propios puntos de entrada.
function assertUniqueTaskIds(tasks) {
  const seen = new Set();
  for (const task of tasks) {
    if (seen.has(task.id)) {
      throw new Error(`Duplicate task id ${task.id}`);
    }
    seen.add(task.id);
  }
}

function buildGraphWithDiagnostics(tasks) {
  assertUniqueTaskIds(tasks);
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
  const fileOwner = new Map(); // filePath -> ÚLTIMO taskId que lo tocó (encadena la serialización)

  for (const task of tasks) {
    for (const symbol of task.interfaces.consumes) {
      const producerId = producedBy.get(symbol);
      if (producerId === undefined) {
        // Igual de silencioso que un typo hasta ahora: la tarea sigue sin esa dependencia
        // y nadie se entera. No es error — un símbolo ya presente en el repo antes del
        // plan es un consumo legítimo sin productor — pero merece el mismo aviso que ya
        // existe para un productor duplicado o un valor vacío.
        warnings.push(
          `Task ${task.id} consumes \`${symbol}\` but no task produces it — ` +
          `likely a typo or a missing producer task; no dependency was created`
        );
        continue;
      }
      if (producerId !== task.id) {
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

  for (const startId of Object.keys(graph).map(Number)) {
    if (state.get(startId) === DONE) continue;

    // Pila explícita en vez de recursión: cada frame lleva el id y un cursor sobre sus
    // dependencias, para poder "volver" a la mitad de un nodo sin usar la pila de
    // llamadas de JS — una cadena de miles de tareas encadenadas no debe reventarla.
    const stack = [{ id: startId, depIndex: 0, chain: [] }];
    state.set(startId, VISITING);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const deps = graph[frame.id] ?? [];

      if (frame.depIndex >= deps.length) {
        state.set(frame.id, DONE);
        stack.pop();
        continue;
      }

      const dep = deps[frame.depIndex];
      frame.depIndex++;

      const depState = state.get(dep) ?? UNVISITED;
      if (depState === DONE) continue;
      if (depState === VISITING) {
        throw new Error(`Cycle detected in plan dependency graph: ${[...frame.chain, frame.id, dep].join(' -> ')}`);
      }

      state.set(dep, VISITING);
      stack.push({ id: dep, depIndex: 0, chain: [...frame.chain, frame.id] });
    }
  }
}

function computeParallelWidth(graph) {
  const layer = new Map();
  function layerOf(id) {
    if (layer.has(id)) return layer.get(id);
    const deps = graph[id] ?? [];
    const value = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(layerOf));
    layer.set(id, value);
    return value;
  }
  const counts = new Map();
  for (const id of Object.keys(graph).map(Number)) {
    const l = layerOf(id);
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}


// El workflow recibe tasks/graph como JSON pegado a mano por el usuario (ver README);
// un ciclo en ese grafo deja a runDag esperando su propia promesa memoizada para
// siempre — deadlock sin error ni log. Esta validación corre antes de lanzar cualquier
// agente para que el fallo sea inmediato y explicable.
function validateWorkflowArgs({ tasks, graph, integrationBranch, executorPath, openPr, pr, mergeAuthorization, finishOnly, maxConcurrency }) {
  if (finishOnly !== undefined && typeof finishOnly !== 'boolean') {
    throw new Error('args.finishOnly must be a boolean when present');
  }
  if (!Array.isArray(tasks) || (tasks.length === 0 && !finishOnly)) {
    // finishOnly: true es la única excepción a "no vacío" — bin/plan-remainder.js marca
    // allDone cuando ya no queda ninguna tarea pendiente/fallida (todo se mergeó antes de
    // que la corrida se cortara) y solo falta terminar la revisión final + el handoff.
    // Final review, hallazgo Important #2.
    throw new Error('args.tasks must be a non-empty array (unless args.finishOnly is true)');
  }
  if (!graph || typeof graph !== 'object') {
    throw new Error('args.graph must be an object');
  }
  if (typeof integrationBranch !== 'string' || integrationBranch.trim() === '') {
    // Sin rama explícita, cada agente de merge (y el review final) "adivina" cuál es la
    // rama de integración — en un repo con master y develop pueden elegir distinto y
    // ambos reportar MERGED. Mejor exigirla de entrada.
    throw new Error('args.integrationBranch must name the branch merges target (e.g. "develop")');
  }
  if (typeof executorPath !== 'string' || executorPath.trim() === '') {
    // Los prompts corren bin/task-brief.js y bin/review-package.js por ruta exacta; sin
    // ella cada agente tendría que escanear el disco buscando scripts (hallazgo F7).
    throw new Error('args.executorPath must be the absolute path of the parallel-plan-executor clone (its bin/ scripts are invoked by exact path)');
  }
  if (openPr !== undefined && typeof openPr !== 'boolean') {
    // Crear un PR es un acto hacia afuera: el consentimiento debe ser explícito e
    // inequívoco, no un string truthy accidental.
    throw new Error('args.openPr must be a boolean when present');
  }
  if (pr !== undefined && (pr === null || typeof pr !== 'object' || Array.isArray(pr))) {
    throw new Error('args.pr must be an object ({ base, assignees, labels, milestone, closes }) when present');
  }
  if (mergeAuthorization !== undefined && typeof mergeAuthorization !== 'string') {
    // Piloto 2026-07-16, hallazgo F8: sin este campo, el agente de merge no tiene forma
    // de saber que el usuario ya autorizó el run — y a veces se autobloquea leyendo la
    // política de "merges requieren autorización humana" de memoria, inconsistentemente
    // entre tareas. Debe ser las palabras textuales del usuario, no un booleano.
    throw new Error('args.mergeAuthorization must be a string (the user\'s own authorization words) when present');
  }
  if (
    maxConcurrency !== undefined &&
    maxConcurrency !== Infinity &&
    (!Number.isInteger(maxConcurrency) || maxConcurrency < 1)
  ) {
    // Un tope inválido (0, negativo, no entero, no numérico) dejaría el semáforo de
    // runDag en un estado que nunca libera slots o que nunca los otorga — mejor fallar
    // rápido acá que deadlockear después de haber lanzado agentes.
    throw new Error('args.maxConcurrency must be Infinity or a positive integer when present');
  }

  assertUniqueTaskIds(tasks);
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


// El sandbox del Workflow prohíbe Date.now()/new Date() (determinismo del resume), así
// que los tiempos de pared vienen de los propios agentes (corren `date +%H:%M:%S`); acá
// solo se hace aritmética de strings sobre valores HH:MM:SS que pueden venir malformados
// — un agente es texto libre, no un reloj. Componentes de 1 o 2 dígitos, con rangos
// validados: "10:75:00" no es una hora, es basura que antes se convertía en duración.
const TIME_RE = /^(\d{1,2}):(\d{1,2}):(\d{1,2})$/;

function parseHHMMSS(t) {
  const match = TIME_RE.exec(t ?? '');
  if (!match) return null;
  const [h, m, s] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (h > 23 || m > 59 || s > 59) return null;
  return h * 3600 + m * 60 + s;
}

function hhmmssToSeconds(t) {
  return parseHHMMSS(t);
}

function formatDuration(startedAt, finishedAt) {
  const start = parseHHMMSS(startedAt);
  const end = parseHHMMSS(finishedAt);
  if (start === null || end === null) return 'duration unknown';
  let secs = end - start;
  if (secs < 0) secs += 24 * 3600; // crossed midnight
  return `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}s`;
}


// El harness puede entregar args como objeto o como string JSON según cómo se haya
// invocado la tool (comprobado en el piloto 2026-07-15): destructurar el string daba
// tasks undefined y un error que culpaba al campo equivocado.
const resolvedArgs = typeof args === 'string' ? JSON.parse(args) : args;
const { graph, tasks, planPath, repoPath, integrationBranch, executorPath, openPr, pr, mergeAuthorization, finishOnly, maxConcurrency } = resolvedArgs;
validateWorkflowArgs({ tasks, graph, integrationBranch, executorPath, openPr, pr, mergeAuthorization, finishOnly, maxConcurrency }); // falla rápido y claro, nunca deadlock
const tasksById = new Map(tasks.map((t) => [t.id, t]));

// Fase 4b: snapshot completo del estado de cada tarea, para que una sesión futura (no
// solo el caché same-session de resumeFromRunId) pueda detectar una corrida cortada y
// recuperar solo lo pendiente. Arranca en 'pending' para todas; se actualiza en cada
// settle() y el archivo se borra al llegar al final natural del script.
const taskStates = new Map(tasks.map((t) => [t.id, { status: 'pending' }]));

function stateJson() {
  const tasksObj = {};
  for (const [id, entry] of taskStates) tasksObj[id] = entry;
  return JSON.stringify({ planPath, repoPath, integrationBranch, tasks: tasksObj }, null, 2);
}

function writeState() {
  return enqueueMainRepo(() => agent(
    `Run \`date +%H:%M:%S\` first to get the current time. In repo ${repoPath}, you are ` +
    `updating .cys/state.json, a resume-bookkeeping snapshot for a parallel-plan-executor run. ` +
    `Before writing anything: independently verify the content below against the repo's actual ` +
    `state — for each task marked done, confirm its branch/commit SHA is a real ancestor of the ` +
    `integration branch (git log / git merge-base); for each task marked failed or in a given ` +
    `phase, check for corroborating evidence (a .cys/task-<id>-report.md, a review diff, a git ` +
    `log entry) rather than accepting the claim at face value. This content can go stale between ` +
    `when it was queued and when you actually run (other tasks keep progressing in the ` +
    `meantime) — that's expected, not a red flag by itself. If you find a task whose real state ` +
    `has moved on (e.g. its branch is now a real ancestor of the integration branch but the ` +
    `content still marks it pending, or a report/review-diff exists showing further progress ` +
    `than stated), don't refuse to write — correct that task's own entry yourself based on what ` +
    `you verified: if it's merged, "status": "done" plus its real branch/commit SHA; if its ` +
    `branch exists but isn't merged yet, "status": "in_progress" **and** a "phase" field (e.g. ` +
    `"Implement", "Review", or "Merge", picked from what the evidence shows it has reached — a ` +
    `bare "status" with no "phase" for a task that has actually started is itself an incomplete ` +
    `correction). Keep the exact same JSON shape and field vocabulary the other task entries in ` +
    `this content already use (don't invent new status values or fields). Only refuse to write ` +
    `if something looks actually fabricated rather than merely stale — e.g. a "done" entry ` +
    `whose branch/SHA doesn't exist anywhere in the repo's history at all. Write the ` +
    `(corrected, if needed) content ` +
    `between the <content> tags to .cys/state.json (create the file/directory if missing, ` +
    `overwrite anything already there), with "updatedAt": "<time from date>" inserted as a ` +
    `top-level field right after "integrationBranch", and nothing else.` +
    `\n<content>${stateJson()}</content>`,
    // effort:'low' — verificar git y escribir un JSON es trabajo mecánico; heredar el
    // esfuerzo de la sesión gastaba razonamiento de nivel implementación en bookkeeping.
    { label: 'state', phase: 'State', effort: 'low' }
  ));
}

// Coalesces concurrent state-write requests into one dispatched agent per
// "wave" instead of one per settle()/markInProgress() call: several tasks
// settling close together (a common real pattern — e.g. every dependency-
// free task starting around the same time) used to fire one [state] agent
// each. If a write is already in flight when a new request comes in, this
// just flags "there's more to record" and lets the in-flight write's own
// follow-up pass (which reads taskStates — and so stateJson() — fresh at
// that later point) pick it up, rather than spawning another agent. Still
// writes at least once per wave, so crash-resume safety is unchanged; the
// count of actual [state] agents drops with how much settling clusters.
let stateWriteChain = null;
let stateWriteDirty = false;
let stateWriteRequests = 0;
function requestWriteState() {
  stateWriteDirty = true;
  stateWriteRequests += 1;
  if (stateWriteChain) return stateWriteChain;
  stateWriteChain = (async () => {
    while (stateWriteDirty) {
      stateWriteDirty = false;
      const batched = stateWriteRequests;
      stateWriteRequests = 0;
      if (batched > 1) log(`[state] agrupó ${batched} pedidos de escritura en 1 solo agente`);
      await writeState();
    }
    stateWriteChain = null;
  })();
  return stateWriteChain;
}

function deleteState() {
  return enqueueMainRepo(() => agent(
    `In repo ${repoPath}, check whether .cys/state.json exists. If it does, verify against the ` +
    `repo's actual state (git log on the integration branch, .cys/task-<id>-report.md files) ` +
    `that the run it describes has genuinely finished — no task still pending or in progress. ` +
    `If that checks out, delete .cys/state.json. If it doesn't exist, there's nothing to do. If ` +
    `you find the run hasn't actually finished, don't delete it — report why instead.`,
    { label: 'state-clear', phase: 'Handoff', effort: 'low' }
  ));
}

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
    alreadyMerged: { type: 'boolean', description: 'true ONLY when the task branch already existed AND was already an ancestor of the integration branch before this agent did anything — i.e. a re-dispatch of finished work' },
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
    pendingLogged: { type: 'number', description: 'count of unresolved review findings appended to .cys/pending.md' },
    detail: { type: 'string' },
  },
  required: ['handoffFile'],
};

function appendLedgerBatch(lines) {
  // Pasa por la misma cola que fixes y merges: dos tareas fallando a la vez hacían
  // append concurrente sobre el mismo archivo del repo principal. Cada línea va entre
  // <line></line> porque incluye texto libre de otros agentes (concerns, findings) —
  // una comilla en ese texto rompía el framing del prompt.
  const linesXml = lines.map((l) => `<line>${l}</line>`).join('\n');
  return enqueueMainRepo(() => agent(
    `In repo ${repoPath}, you are appending ${lines.length} line(s) to .cys/progress.md, a ` +
    `human-readable log of this parallel-plan-executor run. The proposed lines are the ` +
    `<line> tags below, each written by an earlier step in this same run. Before appending ` +
    `each one, spot-check its factual claims against real evidence you can inspect yourself — ` +
    `a referenced commit SHA should exist in \`git log\`, a referenced merge/conflict should ` +
    `be visible in the repo's actual state or a .cys/task-<id>-report.md, a referenced review ` +
    `verdict should match a real review diff. Append the ones that check out verbatim, one ` +
    `per line, in the given order (create the file/directory if missing), without the tags. ` +
    `If any line describes something that didn't actually happen, don't append that one — ` +
    `report the discrepancy instead so it can be corrected; still append the rest that do ` +
    `check out.\n${linesXml}`,
    { label: 'ledger', phase: 'Merge', effort: 'low' }
  ));
}

// Coalesces concurrent appendLedger() calls the same way requestWriteState()
// coalesces state writes: if a batch is already in flight, new lines just
// join the next batch instead of each spawning its own [ledger] agent.
let ledgerChain = null;
let ledgerPending = [];
function appendLedger(line) {
  ledgerPending.push(line);
  if (ledgerChain) return ledgerChain;
  ledgerChain = (async () => {
    while (ledgerPending.length > 0) {
      const batch = ledgerPending;
      ledgerPending = [];
      if (batch.length > 1) log(`[ledger] agrupó ${batch.length} líneas en 1 solo agente`);
      await appendLedgerBatch(batch);
    }
    ledgerChain = null;
  })();
  return ledgerChain;
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
async function settle(taskId, status, label, extra = {}) {
  if (settledTasks.has(taskId)) return;
  settledTasks.add(taskId);
  settledCount += 1;
  taskStates.set(taskId, { status, ...extra });
  log(`${progressBar()} — Task ${taskId} (branch task-${taskId}) ${label}`);
  await requestWriteState();
}

// Sin esto, .cys/state.json muestra 'pending' desde que arranca la corrida hasta que la
// tarea termina (settle) — indistinguible de "todavía ni empezó" mientras está corriendo
// activamente. phase usa el mismo vocabulario que ya etiquetan las llamadas de agente
// (fix() ya usa phase: 'Implement'), no un término nuevo. Hallazgo real de un usuario
// leyendo state.json durante una corrida en curso.
function markInProgress(taskId, phase) {
  taskStates.set(taskId, { status: 'in_progress', phase });
  return requestWriteState();
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
  await settle(taskId, 'failed', impl.status, { reason: detail });
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
    `FAST-EXIT CHECK, before anything else: run \`git -C ${repoPath} show-ref --verify ` +
    `--quiet refs/heads/task-${task.id}\`; if the branch exists, \`git -C ${repoPath} ` +
    `merge-base --is-ancestor task-${task.id} ${integrationBranch}\`; and if that also ` +
    `succeeds, \`git -C ${repoPath} rev-list --count ${integrationBranch}..task-${task.id}\` ` +
    `PLUS confirm the branch actually contains this task's own commits (an EMPTY stub branch ` +
    `pointing at the integration tip is trivially "an ancestor" — that means the branch was ` +
    `created but the work never happened, e.g. a run cut off right after branch creation; in ` +
    `that case delete the stub with \`git -C ${repoPath} branch -D task-${task.id}\` and ` +
    `proceed to implement normally). Only when the branch exists, is an ancestor, AND carries ` +
    `real commits of its own merged into ${integrationBranch} (check \`git -C ${repoPath} log ` +
    `${integrationBranch} --oneline -20\` for this task's commits) was the task already ` +
    `implemented, reviewed, and merged in a prior invocation (a re-dispatch, e.g. after a ` +
    `resume) — then do NOT re-implement, re-run tests, or re-verify anything beyond these git ` +
    `commands. Report immediately with alreadyMerged: true, status DONE, the branch's real ` +
    `head SHA (\`git -C ${repoPath} rev-parse task-${task.id}\`) as headSha, and a one-line ` +
    `commitSummary saying the work was found already merged. Real pilot data: re-dispatched ` +
    `tasks each burned a full test-suite re-verification (testcontainers included) for zero ` +
    `new information.\n\n` +
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
    `2. Classify every finding in the final review below that is still unresolved (Minor ` +
    `findings are expected to stay open; also include any Important/Critical finding the user ` +
    `explicitly chose not to fix). For each: append one line to ${repoPath}/.cys/pending.md, ` +
    `under "## Bugs" for broken/incorrect behavior or "## Gaps" for missing/deferred scope — ` +
    `create the file first with this exact skeleton if it does not exist yet:\n` +
    `"# Pendientes\\n\\n## Bugs\\n\\n## Gaps\\n\\n## Tareas\\n". Keep the finding's own wording ` +
    `and file:line reference; never touch "## Tareas". Count how many items you appended as ` +
    `pendingLogged (0 if every finding was already resolved) — you need this number for step ` +
    `3 below.\n\n` +
    `3. Write ${repoPath}/.cys/handoff.md containing: a suggested PR title ` +
    `(Conventional Commit subject covering the run), a PR body with Summary / Type of change / ` +
    `Main changes (one bullet per task) / Version / Checklist sections, the final review ` +
    `verdict quoted below, a line stating the pendingLogged count from step 2 (how many ` +
    `findings were appended to .cys/pending.md, or that none were), and a post-run cleanup ` +
    `checklist (merged task-N branches to delete, what to do with ${integrationBranch} after ` +
    `the PR merges). Report its path as handoffFile.\n\n` +
    (wantPr
      ? `4. Push ${integrationBranch} to the remote and create the pull request: ` +
        `\`gh pr create --base ${prArgs.base ?? 'develop'} --head ${integrationBranch}\` with the ` +
        `title and body from handoff.md, applying these fields when present: ` +
        `${JSON.stringify(prArgs)} (assignees, labels, milestone; put "Closes #<closes>" in the ` +
        `body when closes is set). Do NOT merge the PR — that gate is human. Report its URL as ` +
        `prUrl. If there is no remote or gh fails, do not retry destructively: explain in "detail".\n\n`
      : `4. Do NOT push and do NOT create any PR (openPr was not requested). Note in "detail" ` +
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
    await settle(taskId, 'failed', 'FAILED', { reason: error?.message ?? String(error) });
    throw error;
  }
}

async function executeTask(taskId) {
  const task = tasksById.get(taskId);
  await markInProgress(taskId, 'Implement');
  // Señal de vida al arrancar (piloto, hallazgo F5): la barra solo se emite al settle,
  // así que sin esto el primer implement largo transcurre en silencio total.
  log(`Task ${taskId}: started (implement) on branch task-${taskId}`);
  let impl = ensureAgentResult(taskId, await implement(task), 'implementer');
  await assertNotBlocked(taskId, impl);

  // Salida rápida (piloto bs-inventory 2026-07-21): una tarea re-despachada tras un
  // resume (el caché invalida por prefijo, así que pasa seguido) volvía a pagar
  // revisión + merge completos sobre trabajo ya integrado — 63 agentes de review y
  // 57 de merge para 10 tareas. Si el implementador confirmó vía git que la rama ya
  // es ancestro de la rama de integración, no hay nada nuevo que revisar ni mergear.
  if (impl.alreadyMerged) {
    log(`Task ${taskId}: already merged in a prior invocation — skipping review and merge`);
    await settle(taskId, 'done', 'already merged (re-dispatch fast-exit)', {
      branch: `task-${taskId}`,
      headSha: impl.headSha,
    });
    return impl;
  }

  await markInProgress(taskId, 'Review');
  let verdict = ensureAgentResult(taskId, await review(task, impl), 'reviewer');
  if (verdict.qualityVerdict === 'NEEDS_FIXES' || verdict.specVerdict === 'FAIL') {
    log(`Task ${taskId}: review found issues, fixing once`);
    await markInProgress(taskId, 'Implement');
    impl = ensureAgentResult(
      taskId,
      await enqueueMainRepo(() => fix(task, impl, verdict.findings)),
      'fix'
    );
    await assertNotBlocked(taskId, impl);
    await markInProgress(taskId, 'Review');
    verdict = ensureAgentResult(taskId, await review(task, impl), 'reviewer');
    if (verdict.qualityVerdict === 'NEEDS_FIXES' || verdict.specVerdict === 'FAIL') {
      await appendLedger(`Task ${taskId}: blocked — review still failing after one fix round`);
      await settle(taskId, 'failed', 'FAILED (review)', { reason: verdict.findings });
      throw new Error(`Task ${taskId}: review still failing after one fix round: ${verdict.findings}`);
    }
  }

  await markInProgress(taskId, 'Merge');
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
        `Otherwise, merge branch task-${taskId} into branch ${integrationBranch} of repo ${repoPath} ` +
        `using \`git merge --no-ff\` — always create a merge commit, even when a fast-forward would ` +
        `be possible, so every task's integration leaves a consistent, explicit commit regardless of ` +
        `execution order. Report mergeStatus MERGED on success. If there is a real merge conflict, do ` +
        `not resolve it automatically — stop and report mergeStatus CONFLICT with the conflict details in "detail".` +
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
    await settle(taskId, 'failed', 'FAILED (merge conflict)', { reason: mergeResult.detail ?? 'no detail given' });
    throw new Error(`Task ${taskId} merge CONFLICT: ${mergeResult.detail ?? 'no detail given'}`);
  }

  const duration = formatDuration(impl.startedAt, impl.finishedAt);
  await appendLedger(
    `Task ${taskId}: complete ${impl.startedAt}..${impl.finishedAt} ` +
    `(${duration}, commits ` +
    `${impl.baseSha.slice(0, 7)}..${impl.headSha.slice(0, 7)}, review clean)`
  );
  await settle(taskId, 'done', `done in ${duration}`, { branch: `task-${taskId}`, headSha: impl.headSha });
  return impl;
}

// finishOnly (Fase 4b, hallazgo Important #2 de la revisión final): bin/plan-remainder.js
// marca allDone cuando una corrida anterior ya mergeó todas las tareas y se cortó antes
// de llegar a la revisión final/handoff — acá no hay nada que implementar ni mergear, así
// que se saltea el DAG entero y se va directo a esa parte, en vez de fallar por falta de
// tareas o repetir trabajo ya hecho.
let results = new Map();
if (!finishOnly) {
  await writeState();
  results = await runDag(graph, runTask, { maxConcurrency });
  // Las tareas skipped nunca pasan por runTask; reconciliar para que la barra cierre en N/N.
  settledCount = results.size;
  log(`${progressBar()} — ejecución terminada`);
} else {
  log('finishOnly: no hay tareas que ejecutar — todo se mergeó en una corrida anterior, solo falta la revisión final y el handoff.');
}

const mergedCount = finishOnly ? 1 : [...results.values()].filter((r) => r.status === 'done').length;
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
      (handoffResult.prUrl ? ` — PR: ${handoffResult.prUrl}` : '') +
      (handoffResult.pendingLogged ? ` — ${handoffResult.pendingLogged} pendiente(s) agregado(s) a .cys/pending.md` : ''));
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

const doneResults = [...results.values()].filter((r) => r.status === 'done');
const outcomeCounts = {
  done: doneResults.length,
  failed: [...results.values()].filter((r) => r.status === 'failed').length,
  skipped: [...results.values()].filter((r) => r.status === 'skipped').length,
};
const statsLines = [
  `Tasks: ${results.size} total — ${outcomeCounts.done} done, ${outcomeCounts.failed} failed, ${outcomeCounts.skipped} skipped`,
  `Plan's inferred parallel width: ${computeParallelWidth(graph)} (largest set of tasks with no dependency between them)`,
];
if (doneResults.length > 0) {
  const durations = doneResults
    .map((r) => hhmmssToSeconds(r.result?.finishedAt) - hhmmssToSeconds(r.result?.startedAt))
    .map((secs) => (secs < 0 ? secs + 24 * 3600 : secs))
    .filter((secs) => Number.isFinite(secs));
  const sequentialEquivalentSecs = durations.reduce((sum, secs) => sum + secs, 0);
  const starts = doneResults.map((r) => hhmmssToSeconds(r.result?.startedAt)).filter((s) => s !== null);
  const ends = doneResults.map((r) => hhmmssToSeconds(r.result?.finishedAt)).filter((s) => s !== null);
  if (starts.length > 0 && ends.length > 0) {
    let wallClockSecs = Math.max(...ends) - Math.min(...starts);
    if (wallClockSecs < 0) wallClockSecs += 24 * 3600;
    // Sin Nx inventado: los tiempos vienen de `date` reportado por cada agente, no de un
    // reloj monotónico — se muestran los dos números y que el usuario saque su conclusión.
    statsLines.push(
      `Sequential-equivalent work (sum of each done task's own duration): ` +
      `${Math.floor(sequentialEquivalentSecs / 60)}m${String(sequentialEquivalentSecs % 60).padStart(2, '0')}s — ` +
      `vs. wall-clock window (first start to last finish): ` +
      `${Math.floor(wallClockSecs / 60)}m${String(wallClockSecs % 60).padStart(2, '0')}s`
    );
  }
}
log(statsLines.join('\n'));
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
await deleteState();
return { results: serializableResults, finalReview, handoff: handoffResult };
