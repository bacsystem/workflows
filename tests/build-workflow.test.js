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

test('built workflow serializes fix agents through a dedicated queue', () => {
  execFileSync('node', [path.join(root, 'scripts', 'build-workflow.js')]);
  const output = readFileSync(path.join(root, 'workflows', 'parallel-plan-executor.js'), 'utf8');

  assert.ok(output.includes('function enqueueFix('));
  assert.ok(output.includes('enqueueFix(() => fix(task, impl'), 'runTask must route fix() through the queue');
});

test('built workflow settles every terminal branch and reconciles the progress bar', () => {
  execFileSync('node', [path.join(root, 'scripts', 'build-workflow.js')]);
  const output = readFileSync(path.join(root, 'workflows', 'parallel-plan-executor.js'), 'utf8');

  assert.ok(output.includes('function settle('), 'progress accounting must be centralized in a settle() helper');
  assert.ok(output.includes("settle(taskId, 'FAILED (review)')"), 'the review-failed-after-fix branch must count as settled');
  assert.ok(output.includes('settledCount = results.size'), 'skipped tasks must be reconciled after runDag');
});
