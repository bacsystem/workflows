import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

test('build script embeds the scheduler source and strips its export, keeping only the meta export', () => {
  execFileSync('node', [path.join(root, 'scripts', 'build-workflow.js')]);
  const output = readFileSync(path.join(root, 'workflows', 'parallel-plan-executor.js'), 'utf8');

  assert.ok(output.includes('async function runDag('));
  assert.ok(!output.includes('__SCHEDULER_SOURCE__'));
  assert.ok(!output.includes('export async function runDag'));
  assert.equal((output.match(/^export\s/gm) ?? []).length, 1); // only "export const meta"
  assert.ok(output.includes("name: 'parallel-plan-executor'"));
});

test('build script embeds the args validation and the template invokes it before any agent', () => {
  execFileSync('node', [path.join(root, 'scripts', 'build-workflow.js')]);
  const output = readFileSync(path.join(root, 'workflows', 'parallel-plan-executor.js'), 'utf8');

  assert.ok(output.includes('function validateWorkflowArgs('));
  assert.ok(output.includes('function assertAcyclic('));
  assert.ok(!output.includes('__VALIDATION_SOURCE__'));
  assert.ok(!output.includes('import '), 'the built file must be self-contained, no imports');
  assert.ok(
    output.indexOf('validateWorkflowArgs({ tasks, graph })') < output.indexOf('agent('),
    'validation must run before any agent() call'
  );
});

test('built workflow serializes every main-repo working-tree operation through one queue', () => {
  execFileSync('node', [path.join(root, 'scripts', 'build-workflow.js')]);
  const output = readFileSync(path.join(root, 'workflows', 'parallel-plan-executor.js'), 'utf8');

  assert.ok(output.includes('function enqueueMainRepo('));
  assert.ok(
    output.includes('enqueueMainRepo(() => fix(task, impl'),
    'fix() debe pasar por la cola del repo principal'
  );
  assert.equal(
    (output.match(/enqueueMainRepo\(/g) ?? []).length, 3,
    'exactamente tres apariciones: la definición, el call site de fix y el de merge'
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

test('built workflow guards every agent result against null (user skip / terminal API error)', () => {
  execFileSync('node', [path.join(root, 'scripts', 'build-workflow.js')]);
  const output = readFileSync(path.join(root, 'workflows', 'parallel-plan-executor.js'), 'utf8');

  assert.ok(output.includes('function ensureAgentResult('), 'debe existir un guard centralizado');
  assert.equal(
    (output.match(/ensureAgentResult\(/g) ?? []).length, 6,
    'definición + implement + review inicial + fix + review post-fix + merge'
  );
});

test('built workflow re-checks BLOCKED/NEEDS_CONTEXT after the fix round, not only after implement', () => {
  execFileSync('node', [path.join(root, 'scripts', 'build-workflow.js')]);
  const output = readFileSync(path.join(root, 'workflows', 'parallel-plan-executor.js'), 'utf8');

  assert.ok(output.includes('function assertNotBlocked('), 'el chequeo de BLOCKED debe estar centralizado');
  assert.equal(
    (output.match(/assertNotBlocked\(/g) ?? []).length, 3,
    'definición + tras implement + tras fix'
  );
});

test('built workflow hands the fix agent its baseSha instead of asking it to guess', () => {
  execFileSync('node', [path.join(root, 'scripts', 'build-workflow.js')]);
  const output = readFileSync(path.join(root, 'workflows', 'parallel-plan-executor.js'), 'utf8');

  assert.ok(
    output.includes('baseSha (${impl.baseSha}) stay the same'),
    'el prompt de fix debe interpolar el baseSha original, no pedirle al agente que lo adivine'
  );
});

test('built workflow inlines the shared time helpers instead of redefining them', () => {
  execFileSync('node', [path.join(root, 'scripts', 'build-workflow.js')]);
  const output = readFileSync(path.join(root, 'workflows', 'parallel-plan-executor.js'), 'utf8');

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

test('built workflow settles every terminal branch and reconciles the progress bar', () => {
  execFileSync('node', [path.join(root, 'scripts', 'build-workflow.js')]);
  const output = readFileSync(path.join(root, 'workflows', 'parallel-plan-executor.js'), 'utf8');

  assert.ok(output.includes('function settle('), 'progress accounting must be centralized in a settle() helper');
  assert.ok(output.includes("settle(taskId, 'FAILED (review)')"), 'the review-failed-after-fix branch must count as settled');
  assert.ok(output.includes('settledCount = results.size'), 'skipped tasks must be reconciled after runDag');
});
