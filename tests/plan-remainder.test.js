import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'bin', 'plan-remainder.js');

const PLAN = [
  '# Some Plan',
  '',
  '---',
  '',
  '### Task 1: First',
  '',
  '**Files:**',
  '- Create: `src/a.js`',
  '',
  '**Interfaces:**',
  '- Produces: `alpha()`',
  '',
  '---',
  '',
  '### Task 2: Second',
  '',
  '**Files:**',
  '- Create: `src/b.js`',
  '',
  '**Interfaces:**',
  '- Consumes: `alpha()`',
  '- Produces: `beta()`',
  '',
  '---',
  '',
  '### Task 3: Third',
  '',
  '**Files:**',
  '- Create: `src/c.js`',
  '',
  '**Interfaces:**',
  '- Consumes: `beta()`',
  '',
].join('\n');

function makeFixtures() {
  const dir = mkdtempSync(path.join(tmpdir(), 'plan-remainder-'));
  const planPath = path.join(dir, 'plan.md');
  writeFileSync(planPath, PLAN);
  return { dir, planPath };
}

function writeState(dir, planPath, tasks) {
  const statePath = path.join(dir, 'state.json');
  writeFileSync(statePath, JSON.stringify({ planPath, tasks }));
  return statePath;
}

test('descarta las tareas done y las dependencias ya satisfechas', () => {
  const { dir, planPath } = makeFixtures();
  const statePath = writeState(dir, planPath, {
    1: { status: 'done' },
    2: { status: 'failed' },
    3: { status: 'pending' },
  });

  const stdout = execFileSync('node', [cli, planPath, statePath], { encoding: 'utf8' });
  const result = JSON.parse(stdout);

  assert.deepEqual(result.tasks.map((t) => t.id), [2, 3]);
  assert.deepEqual(result.graph, { 2: [], 3: [2] });
});

test('si ninguna tarea está done, devuelve el plan completo sin cambios', () => {
  const { dir, planPath } = makeFixtures();
  const statePath = writeState(dir, planPath, {
    1: { status: 'pending' },
    2: { status: 'pending' },
    3: { status: 'pending' },
  });

  const stdout = execFileSync('node', [cli, planPath, statePath], { encoding: 'utf8' });
  const result = JSON.parse(stdout);

  assert.deepEqual(result.tasks.map((t) => t.id), [1, 2, 3]);
  assert.deepEqual(result.graph, { 1: [], 2: [1], 3: [2] });
});

test('si todas las tareas están done, devuelve listas vacías', () => {
  const { dir, planPath } = makeFixtures();
  const statePath = writeState(dir, planPath, {
    1: { status: 'done' },
    2: { status: 'done' },
    3: { status: 'done' },
  });

  const stdout = execFileSync('node', [cli, planPath, statePath], { encoding: 'utf8' });
  const result = JSON.parse(stdout);

  assert.deepEqual(result.tasks, []);
  assert.deepEqual(result.graph, {});
});

test('falla ruidosamente si el planPath de state.json no coincide', () => {
  const { dir, planPath } = makeFixtures();
  const statePath = writeState(dir, '/otro/plan.md', {});

  assert.throws(() =>
    execFileSync('node', [cli, planPath, statePath], { encoding: 'utf8', stdio: 'pipe' })
  );
});

test('falla ruidosamente sin args', () => {
  assert.throws(() => execFileSync('node', [cli], { encoding: 'utf8', stdio: 'pipe' }));
});
