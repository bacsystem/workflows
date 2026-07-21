import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// El build es determinista: se corre UNA vez y todos los tests aseveran sobre el mismo
// artefacto, en vez de gastar un proceso node por test.
execFileSync('node', [path.join(root, 'scripts', 'build-workflow.js')]);
const output = readFileSync(path.join(root, 'workflows', 'parallel-plan-executor.js'), 'utf8');

test('build script embeds the scheduler source and strips its export, keeping only the meta export', () => {
  assert.ok(output.includes('async function runDag('));
  assert.ok(!output.includes('__SCHEDULER_SOURCE__'));
  assert.ok(!output.includes('export async function runDag'));
  assert.equal((output.match(/^export\s/gm) ?? []).length, 1); // only "export const meta"
  assert.ok(output.includes("name: 'parallel-plan-executor'"));
});

test('build script embeds the args validation and the template invokes it before any agent', () => {
  assert.ok(output.includes('function validateWorkflowArgs('));
  assert.ok(output.includes('function assertAcyclic('));
  assert.ok(!output.includes('__VALIDATION_SOURCE__'));
  assert.ok(!output.includes('import '), 'the built file must be self-contained, no imports');
  const validateIndex = output.indexOf('validateWorkflowArgs({ tasks, graph, integrationBranch, executorPath, openPr, pr, mergeAuthorization, finishOnly, maxConcurrency })');
  assert.ok(validateIndex >= 0, 'the template must invoke validateWorkflowArgs with integrationBranch');
  assert.ok(
    validateIndex < output.indexOf('agent('),
    'validation must run before any agent() call'
  );
});

test('el template pasa maxConcurrency a runDag', () => {
  assert.match(
    output,
    /runDag\(graph, runTask, \{\s*maxConcurrency\s*\}\)/,
    'runDag debe recibir el maxConcurrency del usuario, no ignorarlo'
  );
});

test('built workflow tolerates args delivered as a JSON string (real harness behavior)', () => {
  assert.ok(
    output.includes("typeof args === 'string' ? JSON.parse(args) : args"),
    'args puede llegar como string JSON según cómo se invoque la tool; destructurarlo sin parsear da tasks undefined'
  );
});

test('built workflow names the integration branch explicitly instead of letting agents guess', () => {
  assert.ok(
    output.includes('integrationBranch, executorPath, openPr, pr, mergeAuthorization, finishOnly, maxConcurrency } = resolvedArgs'),
    'integrationBranch y executorPath deben venir de los args resueltos (objeto o string parseado)'
  );
  assert.ok(
    output.includes('into branch ${integrationBranch}'),
    'el prompt de merge debe nombrar la rama destino'
  );
  assert.ok(
    output.includes('\\`${integrationBranch}\\` branch'),
    'el review final debe revisar esa misma rama, no adivinar otra'
  );
  assert.ok(
    !output.includes('the integration branch of repo'),
    'no debe quedar ninguna referencia a una rama de integración sin nombre'
  );
});

test('built workflow threads the user\'s merge authorization into the merge prompt (pilot 8, F8)', () => {
  assert.ok(
    output.includes('(mergeAuthorization\n'),
    'el prompt de merge debe condicionar en mergeAuthorization'
  );
  assert.ok(
    output.includes('The user has already explicitly authorized merges for this run'),
    'sin este texto, el agente de merge no tiene forma de saber que el usuario ya autorizó el run y puede autobloquearse leyendo la memoria de la cuenta'
  );
});

test('built workflow short-circuits merges of already-integrated branches (pilot 8, F9)', () => {
  assert.ok(
    output.includes('merge-base --is-ancestor task-${taskId}'),
    'el prompt de merge debe chequear ancestría (solo lectura) antes de intentar el merge'
  );
  assert.ok(
    output.includes('already an ancestor, nothing to do'),
    'una rama ya integrada debe reportar MERGED sin correr ningún comando de merge'
  );
});

test('built workflow has zero external-plugin references and never scans the filesystem (cys F1)', () => {
  assert.ok(
    !output.includes('subagent-driven-development'),
    'ni skills, ni scripts, ni rutas del plugin externo deben sobrevivir a F1'
  );
  assert.ok(
    !output.includes('find ~') && !output.includes('FIND_SDD_SCRIPTS'),
    'los scripts se invocan por ruta exacta; el escaneo de disco (F7) muere de raíz'
  );
  assert.ok(
    output.includes('node ${executorPath}/bin/task-brief.js ${planPath} ${task.id} ${repoPath}/.cys'),
    'el implementador corre task-brief propio por ruta exacta, escribiendo directo en .cys del repo destino'
  );
  assert.ok(
    output.includes('node ${executorPath}/bin/review-package.js ${repoPath} ${impl.baseSha} ${impl.headSha} ${repoPath}/.cys'),
    'el reviewer corre review-package propio por ruta exacta'
  );
});

test('built workflow serializes every main-repo working-tree operation through one queue', () => {
  assert.ok(output.includes('function enqueueMainRepo('));
  assert.ok(
    output.includes('enqueueMainRepo(() => fix(task, impl'),
    'fix() debe pasar por la cola del repo principal'
  );
  assert.equal(
    (output.match(/enqueueMainRepo\(/g) ?? []).length, 6,
    'exactamente seis apariciones: la definición y los call sites de ledger, fix, merge, writeState y deleteState'
  );
  assert.ok(
    !output.includes('fixQueueTail') && !output.includes('mergeQueueTail'),
    'no deben quedar colas separadas: fix y merge comparten working tree'
  );
  assert.equal(
    (output.match(/let \w+QueueTail/g) ?? []).length, 1,
    'debe declararse exactamente una cola'
  );
});

test('built workflow frames ledger content so free-form agent text cannot break the prompt', () => {
  assert.ok(
    output.includes('<line>${l}</line>') || output.includes('<line>${line}</line>'),
    'cada línea del ledger debe ir delimitada con <line></line>, no incrustada entre comillas — ' +
    'sigue siendo cierto tras el coalescing de appendLedger(), que arma el XML por línea vía .map()'
  );
});

test('built workflow guards every agent result against null (user skip / terminal API error)', () => {
  assert.ok(output.includes('function ensureAgentResult('), 'debe existir un guard centralizado');
  assert.equal(
    (output.match(/ensureAgentResult\(/g) ?? []).length, 6,
    'definición + implement + review inicial + fix + review post-fix + merge'
  );
});

test('built workflow re-checks BLOCKED/NEEDS_CONTEXT after the fix round, not only after implement', () => {
  assert.ok(output.includes('function assertNotBlocked('), 'el chequeo de BLOCKED debe estar centralizado');
  assert.equal(
    (output.match(/assertNotBlocked\(/g) ?? []).length, 3,
    'definición + tras implement + tras fix'
  );
});

test('built workflow hands the fix agent its baseSha instead of asking it to guess', () => {
  assert.ok(
    output.includes('baseSha (${impl.baseSha}) stay the same'),
    'el prompt de fix debe interpolar el baseSha original, no pedirle al agente que lo adivine'
  );
});

test('built workflow inlines the shared time helpers instead of redefining them', () => {
  assert.ok(output.includes('function formatDuration('));
  assert.ok(
    output.includes('TIME_RE'),
    'la validación de formato HH:MM:SS de src/time.js debe estar inlineada'
  );
  assert.equal(
    (output.match(/function hhmmssToSeconds\(/g) ?? []).length, 1,
    'los helpers de tiempo deben aparecer una sola vez (inlineados desde src/time.js)'
  );
});

test('built workflow gives each implementer its own worktree of the TARGET repo (pilot F3)', () => {
  assert.ok(
    output.includes('git -C ${repoPath} worktree add'),
    'el prompt de implement debe ordenar crear un worktree del repo objetivo'
  );
  assert.ok(
    !output.includes("isolation: 'worktree'"),
    "isolation:'worktree' aísla el repo de la SESIÓN, no repoPath — dos implementadores compartían el working tree del objetivo"
  );
  assert.ok(
    output.includes('git -C ${repoPath} worktree remove'),
    'el worktree se libera al terminar, dejando la rama task-N disponible para el fix round'
  );
});

test('built workflow records the run under .cys/ in the target repo (cys F1)', () => {
  assert.ok(output.includes('.cys/progress.md'), 'el ledger vive en .cys');
  assert.ok(output.includes('.cys/task-${task.id}-brief.md'), 'el brief se lee desde .cys');
  assert.ok(output.includes('.cys/task-${task.id}-report.md'), 'el reporte del implementador va a .cys');
  assert.ok(output.includes('.cys/handoff.md'), 'el handoff va a .cys');
});

test('built workflow logs task start so long implement phases show life (pilot F5)', () => {
  assert.ok(
    output.includes('started (implement)'),
    'sin log de inicio, la barra queda muda hasta el primer settle (~10 min en el piloto 1)'
  );
});

test('built workflow names the branch in progress logs, not just the task id', () => {
  assert.ok(
    output.includes('started (implement) on branch task-${taskId}'),
    'el aviso de inicio debe nombrar la rama task-N para que el usuario sepa dónde mirar'
  );
  assert.ok(
    output.includes('(branch task-${taskId})'),
    'la línea de settle (done/failed/skipped) también debe nombrar la rama'
  );
});

test('built workflow returns failure causes as messages, not raw Error objects (pilot 2/5)', () => {
  assert.ok(
    output.includes('r.error?.message ?? String(r.error)') &&
      output.includes('serializableResults'),
    'un Error de JS serializa a {} en JSON: el objeto results retornado perdía la causa de cada tarea failed'
  );
});

test('built workflow ships a Handoff phase that prepares the git-flow handoff (v0.5.0)', () => {
  assert.ok(output.includes("{ title: 'Handoff' }"), 'la fase debe estar declarada en meta.phases');
  assert.ok(output.includes('function handoff('), 'debe existir la función handoff');
  assert.equal(
    (output.match(/await handoff\(/g) ?? []).length, 1,
    'handoff se invoca exactamente una vez'
  );
  assert.ok(
    output.indexOf('mergedCount > 0') < output.indexOf('await handoff('),
    'handoff solo corre si algo mergeó (mismo gate que la review final)'
  );
  assert.ok(
    output.includes('.cys/handoff.md'),
    'el entregable es un handoff.md en el repo objetivo'
  );
  assert.ok(
    output.includes('handoff: handoffResult'),
    'el resultado del handoff viaja en el return del workflow'
  );
});

test('built workflow opens the PR only with explicit openPr consent, and never merges it', () => {
  assert.ok(
    output.includes('openPr === true'),
    'crear el PR requiere openPr: true explícito en args'
  );
  assert.ok(
    output.includes('gh pr create --base'),
    'el PR se crea con gh contra la base declarada'
  );
  assert.ok(
    output.includes('Do NOT merge'),
    'el prompt debe prohibir mergear el PR — esa puerta es humana'
  );
});

test('built workflow settles every terminal branch and reconciles the progress bar', () => {
  assert.ok(output.includes('function settle('), 'progress accounting must be centralized in a settle() helper');
  assert.ok(output.includes("settle(taskId, 'failed', 'FAILED (review)'"), 'the review-failed-after-fix branch must count as settled');
  assert.ok(output.includes('settledCount = results.size'), 'skipped tasks must be reconciled after runDag');
});

test('built workflow points both implementers and reviewers at the code-standards reference (cys F3, review final finding #1)', () => {
  assert.equal(
    (output.match(/\$\{executorPath\}\/skills\/check\/references\/code-standards\.md/g) ?? []).length,
    2,
    'el documento dice "reviewers hold implementations to them" — debe citarse en implement() Y en review(), no solo en implement()'
  );
});

test('el template vive fuera de workflows/, para no duplicarse en el listado de skills del plugin (Fase 4a fix 2)', () => {
  assert.ok(
    existsSync(path.join(root, 'workflows-src', 'parallel-plan-executor.template.js')),
    'el template debe existir en workflows-src/'
  );
  assert.ok(
    !existsSync(path.join(root, 'workflows', 'parallel-plan-executor.template.js')),
    'workflows/ no debe tener ningún archivo con export const meta además del generado — causa raíz confirmada del duplicado cys:parallel-plan-executor en el listado de skills'
  );
});

test('built workflow writes .cys/state.json at start, updates it per settle, and deletes it before the final return (Fase 4b)', () => {
  assert.ok(
    output.includes('const taskStates = new Map('),
    'debe existir un registro en memoria del estado de cada tarea'
  );
  assert.ok(
    output.includes('.cys/state.json'),
    'el motor debe escribir/borrar .cys/state.json'
  );
  assert.ok(
    output.includes('async function settle('),
    'settle() debe ser async para poder escribir el estado antes de continuar'
  );
  const deleteIndex = output.indexOf('delete .cys/state.json');
  const returnIndex = output.indexOf('return { results: serializableResults, finalReview, handoff: handoffResult };');
  assert.ok(deleteIndex >= 0, 'debe existir la instrucción de borrar el estado');
  assert.ok(
    deleteIndex < returnIndex,
    'el borrado debe ocurrir antes del return final, para que solo quede el archivo si el script se cortó antes de llegar ahí'
  );
});

test('built workflow tags .cys/state.json writes with their own phase, not Merge (pending.md bug)', () => {
  assert.ok(
    output.includes("{ title: 'State' }"),
    "debe declararse una fase 'State' en meta.phases para las escrituras de bookkeeping"
  );
  const writeStateIndex = output.indexOf("label: 'state',");
  assert.ok(writeStateIndex >= 0, "debe existir la llamada de agente etiquetada 'state'");
  assert.ok(
    output.slice(writeStateIndex, writeStateIndex + 40).includes("phase: 'State'"),
    "la escritura de estado no debe quedar bajo phase: 'Merge' — corre antes de la primera tarea y en cada settle(), no solo durante merges"
  );
});

test('built workflow instructs the state-write agent to verify against real repo state, not just assert the content is true (safety-classifier block, pending.md bug reopened 2026-07-21)', () => {
  const writeStateIndex = output.indexOf('function writeState()');
  assert.ok(writeStateIndex >= 0, 'debe existir writeState()');
  const writeStateBody = output.slice(writeStateIndex, writeStateIndex + 2600);
  assert.ok(
    writeStateBody.includes('independently verify') && writeStateBody.includes('git log') && writeStateBody.includes('git merge-base'),
    'la primera corrección (afirmarle al agente "esto ya es verdad, escríbelo") seguía siendo bloqueada por el clasificador en corridas reales — el prompt debe pedirle al agente que verifique el contenido contra el repo real antes de escribir, no solo confiar en la afirmación'
  );
  assert.ok(
    writeStateBody.includes("don't refuse to write") && writeStateBody.includes('correct that task'),
    'una foto desactualizada por la cola de encolado es esperable, no un bloqueo — el agente debe autocorregir la entrada de la tarea con lo que verificó, no negarse a escribir sin más (el primer intento de este arreglo solo pedía "no escribas, reportá", lo que dejaba state.json congelado indefinidamente)'
  );
  assert.ok(
    writeStateBody.includes('"status": "in_progress"') && writeStateBody.includes('"phase"'),
    'la corrección debe incluir tanto status como phase para una tarea en curso — un status sin phase es una corrección incompleta (pedido explícito del usuario tras ver state.json sin fase)'
  );
});

test('built workflow instructs the ledger-append agent to spot-check the line against real evidence before appending (safety-classifier block, pending.md bug reopened 2026-07-21)', () => {
  const appendLedgerBatchIndex = output.indexOf('function appendLedgerBatch(');
  assert.ok(appendLedgerBatchIndex >= 0, 'debe existir appendLedgerBatch()');
  const appendLedgerBatchBody = output.slice(appendLedgerBatchIndex, appendLedgerBatchIndex + 1200);
  assert.ok(
    appendLedgerBatchBody.includes('spot-check') && appendLedgerBatchBody.includes('git log'),
    'el agente de ledger debe verificar las afirmaciones de la línea contra evidencia real (git log, reportes) antes de agregarla, no solo confiar en el texto que le pasaron'
  );
});

test('built workflow coalesces concurrent appendLedger() calls into one batched [ledger] agent', () => {
  const appendLedgerIndex = output.indexOf('function appendLedger(line)');
  assert.ok(appendLedgerIndex >= 0, 'debe existir appendLedger(line), el wrapper público de coalescing');
  const appendLedgerBody = output.slice(appendLedgerIndex, appendLedgerIndex + 500);
  assert.ok(
    appendLedgerBody.includes('ledgerPending') && appendLedgerBody.includes('while'),
    'appendLedger() debe encolar en ledgerPending y reintentar con un loop mientras haya líneas nuevas, no lanzar un agente por cada llamada'
  );
  assert.ok(
    output.includes('appendLedgerBatch(batch)'),
    'el batch acumulado debe pasarse completo a appendLedgerBatch(), no una línea a la vez'
  );
  assert.ok(
    output.includes('agrupó') && output.includes('batch.length'),
    'debe loguear cuántas líneas se agruparon en un solo agente, para que se pueda confirmar en vivo que el coalescing está funcionando (pedido explícito del usuario)'
  );
});

test('built workflow coalesces concurrent state-write requests instead of dispatching one [state] agent per settle()/markInProgress() call', () => {
  const requestIndex = output.indexOf('function requestWriteState()');
  assert.ok(requestIndex >= 0, 'debe existir requestWriteState(), el wrapper de coalescing sobre writeState()');
  const requestBody = output.slice(requestIndex, requestIndex + 500);
  assert.ok(
    requestBody.includes('stateWriteDirty') && requestBody.includes('while'),
    'el coalescing debe usar una bandera "dirty" y un loop que reintente mientras haya pedidos nuevos, no lanzar un agente por cada llamada'
  );
  assert.ok(
    output.includes('await requestWriteState()') && output.includes('return requestWriteState()'),
    'settle() y markInProgress() deben pasar por requestWriteState(), no llamar a writeState() directo (si no, el coalescing no tiene efecto)'
  );
  assert.ok(
    output.includes('agrupó') && output.includes('stateWriteRequests'),
    'debe loguear cuántos pedidos de escritura se agruparon en un solo agente, para que se pueda confirmar en vivo que el coalescing está funcionando (pedido explícito del usuario)'
  );
});

test('built workflow adds updatedAt to .cys/state.json via the write agent\'s own date command (pending.md gap, Fase 4b design)', () => {
  const writeStateIndex = output.indexOf('function writeState()');
  assert.ok(writeStateIndex >= 0, 'debe existir writeState()');
  const writeStateBody = output.slice(writeStateIndex, writeStateIndex + 2600);
  assert.ok(
    writeStateBody.includes('date +%H:%M:%S'),
    'el timestamp no puede venir de Date.now()/new Date() (prohibido en el sandbox de Workflow) — debe pedirle al agente que corra date'
  );
  assert.ok(
    writeStateBody.includes('updatedAt'),
    'el campo updatedAt del diseño original de Fase 4b sigue faltando en el JSON escrito'
  );
});

test('built workflow instructs the Handoff agent to surface pendingLogged inside handoff.md itself, not just the run log (pending.md gap, Important finding)', () => {
  const classifyIndex = output.indexOf('Classify every finding in the final review');
  const handoffWriteIndex = output.indexOf('.cys/handoff.md containing');
  assert.ok(classifyIndex >= 0, 'debe existir el paso de clasificación/registro en pending.md dentro del prompt de handoff');
  assert.ok(handoffWriteIndex >= 0, 'debe existir el paso de redacción de handoff.md');
  assert.ok(
    classifyIndex < handoffWriteIndex,
    'pendingLogged debe calcularse ANTES de redactar handoff.md, para poder citar el conteo adentro'
  );
  const handoffStepBody = output.slice(handoffWriteIndex, handoffWriteIndex + 500);
  assert.ok(
    handoffStepBody.includes('pendingLogged'),
    'la instrucción de handoff.md debe mencionar pendingLogged explícitamente — el diseño pedía que el usuario lo vea sin abrir .cys/pending.md ni leer el log efímero'
  );
});

test('built workflow appends unresolved final-review findings to .cys/pending.md via the Handoff agent (cys pending tracker)', () => {
  assert.ok(
    output.includes('.cys/pending.md'),
    'el prompt de handoff debe instruir escribir en .cys/pending.md'
  );
  assert.ok(
    output.includes('## Bugs') && output.includes('## Gaps') && output.includes('## Tareas'),
    'el esqueleto de pending.md debe tener las tres secciones fijas'
  );
  assert.ok(
    output.includes('pendingLogged'),
    'el agente debe reportar cuántos ítems agregó, para poder mostrarlo en el log final'
  );
});

test('built workflow marks a task in_progress per phase before settling, instead of staying "pending" the whole time it runs', () => {
  assert.ok(output.includes('function markInProgress('), 'debe existir un helper para marcar el estado en curso');
  assert.ok(output.includes("status: 'in_progress'"), "el estado debe distinguir 'in_progress' de 'pending'");
  const executeTaskIndex = output.indexOf('async function executeTask(');
  assert.ok(executeTaskIndex >= 0, 'debe existir executeTask()');
  const body = output.slice(executeTaskIndex, executeTaskIndex + 3000);
  assert.equal(
    (body.match(/markInProgress\(taskId, 'Implement'\)/g) ?? []).length,
    2,
    "debe marcarse 'Implement' antes del implement inicial Y antes de fix() — fix() ya etiqueta su propia llamada de agente phase: 'Implement', mismo vocabulario"
  );
  assert.equal(
    (body.match(/markInProgress\(taskId, 'Review'\)/g) ?? []).length,
    2,
    "debe marcarse 'Review' antes de la revisión inicial Y antes de la revisión posterior al fix"
  );
  assert.ok(
    body.includes("markInProgress(taskId, 'Merge')"),
    "debe marcarse 'Merge' antes de intentar el merge"
  );
});

test('built workflow forces a real merge commit for task integrations, never a silent fast-forward', () => {
  assert.ok(
    output.includes('--no-ff'),
    'sin --no-ff, git hace fast-forward cuando puede, dejando un historial inconsistente entre tareas según el orden real de ejecución'
  );
});

test('el resumen final incluye conteos de resultado, ancho de paralelismo y trabajo secuencial vs. ventana de pared', () => {
  assert.ok(
    output.includes('computeParallelWidth(graph)'),
    'el resumen debe calcular el ancho de paralelismo inferido del plan'
  );
  assert.ok(
    output.includes('Sequential-equivalent') || output.includes('secuencial'),
    'el resumen debe mostrar el trabajo secuencial equivalente'
  );
  assert.ok(
    !output.includes('speedup') && !output.includes('Nx faster') && !output.includes('veces más rápido'),
    'el resumen no debe inventar un número de speedup — solo mostrar los datos'
  );
});
