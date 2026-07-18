import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
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

test('el mismo plan con una forma de ruta distinta (relativa vs absoluta) no cuenta como "plan distinto" (final review, hallazgo Important #1)', () => {
  const { dir, planPath } = makeFixtures();
  // state.json guarda una ruta relativa con "./" adelante; el argumento del CLI es la
  // ruta absoluta — ambas apuntan al mismo archivo real.
  const relativePlanPath = './' + path.relative(dir, planPath).split(path.sep).join('/');
  const statePath = path.join(dir, 'state.json');
  writeFileSync(
    statePath,
    JSON.stringify({ planPath: relativePlanPath, tasks: { 1: { status: 'done' } } })
  );

  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    const stdout = execFileSync('node', [cli, planPath, statePath], { encoding: 'utf8' });
    const result = JSON.parse(stdout);
    assert.deepEqual(result.tasks.map((t) => t.id), [2, 3]);
  } finally {
    process.chdir(originalCwd);
  }
});

test('el mismo plan visto a través de un directorio symlinkeado no cuenta como "plan distinto" (reportado por un usuario instalando en Mac, donde /var -> /private/var)', (t) => {
  const { dir, planPath } = makeFixtures();
  const linkDir = path.join(tmpdir(), `plan-remainder-link-${process.pid}-${Date.now()}`);
  try {
    symlinkSync(dir, linkDir, 'junction');
  } catch {
    t.skip('el entorno no permite crear symlinks de directorio (falta de permisos)');
    return;
  }
  try {
    // state.json guarda la ruta vista a través del symlink; el argumento del CLI usa la
    // ruta real (no symlinkeada) — mismo archivo en disco, dos strings distintos, igual
    // que process.cwd() (canonicalizado por el SO) vs un argumento sin canonicalizar.
    const statePath = writeState(dir, path.join(linkDir, 'plan.md'), { 1: { status: 'done' } });

    const stdout = execFileSync('node', [cli, planPath, statePath], { encoding: 'utf8' });
    const result = JSON.parse(stdout);
    assert.deepEqual(result.tasks.map((t) => t.id), [2, 3]);
  } finally {
    rmSync(linkDir, { force: true });
  }
});

test('si todas las tareas ya estaban done, la salida marca allDone para que el comando ofrezca terminar solo el cierre (final review, hallazgo Important #2)', () => {
  const { dir, planPath } = makeFixtures();
  const statePath = writeState(dir, planPath, {
    1: { status: 'done' },
    2: { status: 'done' },
    3: { status: 'done' },
  });

  const stdout = execFileSync('node', [cli, planPath, statePath], { encoding: 'utf8' });
  const result = JSON.parse(stdout);

  assert.equal(result.allDone, true);
});

test('allDone es false mientras quede algo pendiente o fallido', () => {
  const { dir, planPath } = makeFixtures();
  const statePath = writeState(dir, planPath, {
    1: { status: 'done' },
    2: { status: 'failed' },
    3: { status: 'pending' },
  });

  const stdout = execFileSync('node', [cli, planPath, statePath], { encoding: 'utf8' });
  const result = JSON.parse(stdout);

  assert.equal(result.allDone, false);
});

test('falla ruidosamente sin args', () => {
  assert.throws(() => execFileSync('node', [cli], { encoding: 'utf8', stdio: 'pipe' }));
});
