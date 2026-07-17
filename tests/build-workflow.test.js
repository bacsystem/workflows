import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  const validateIndex = output.indexOf('validateWorkflowArgs({ tasks, graph, integrationBranch, executorPath, openPr, pr, mergeAuthorization })');
  assert.ok(validateIndex >= 0, 'the template must invoke validateWorkflowArgs with integrationBranch');
  assert.ok(
    validateIndex < output.indexOf('agent('),
    'validation must run before any agent() call'
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
    output.includes('integrationBranch, executorPath, openPr, pr, mergeAuthorization } = resolvedArgs'),
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

test('built workflow has zero superpowers references and never scans the filesystem (cys F1)', () => {
  assert.ok(
    !output.includes('superpowers'),
    'ni skills, ni scripts, ni rutas .superpowers/sdd deben sobrevivir a F1'
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
    (output.match(/enqueueMainRepo\(/g) ?? []).length, 4,
    'exactamente cuatro apariciones: la definición y los call sites de ledger, fix y merge'
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
    output.includes('<line>${line}</line>'),
    'la línea del ledger debe ir delimitada, no incrustada entre comillas'
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
  assert.ok(output.includes("settle(taskId, 'FAILED (review)')"), 'the review-failed-after-fix branch must count as settled');
  assert.ok(output.includes('settledCount = results.size'), 'skipped tasks must be reconciled after runDag');
});

test('built workflow points both implementers and reviewers at the code-standards reference (cys F3, review final finding #1)', () => {
  assert.equal(
    (output.match(/\$\{executorPath\}\/skills\/check\/references\/code-standards\.md/g) ?? []).length,
    2,
    'el documento dice "reviewers hold implementations to them" — debe citarse en implement() Y en review(), no solo en implement()'
  );
});
