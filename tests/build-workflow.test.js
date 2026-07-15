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
  const validateIndex = output.indexOf('validateWorkflowArgs({ tasks, graph, integrationBranch })');
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
    output.includes('integrationBranch } = resolvedArgs'),
    'integrationBranch debe venir de los args resueltos (objeto o string parseado)'
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

test('built workflow makes sure the task brief lands in the target repo (pilot F4)', () => {
  assert.ok(
    output.includes('copy it to') &&
      output.includes('${repoPath}/.superpowers/sdd/task-${task.id}-brief.md'),
    'task-brief escribe en el cwd del agente; el implement debe garantizar el brief bajo repoPath'
  );
});

test('built workflow logs task start so long implement phases show life (pilot F5)', () => {
  assert.ok(
    output.includes('started (implement)'),
    'sin log de inicio, la barra queda muda hasta el primer settle (~10 min en el piloto 1)'
  );
});

test('built workflow settles every terminal branch and reconciles the progress bar', () => {
  assert.ok(output.includes('function settle('), 'progress accounting must be centralized in a settle() helper');
  assert.ok(output.includes("settle(taskId, 'FAILED (review)')"), 'the review-failed-after-fix branch must count as settled');
  assert.ok(output.includes('settledCount = results.size'), 'skipped tasks must be reconciled after runDag');
});
