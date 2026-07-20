import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const cliPath = path.join(root, 'bin', 'parse-plan.js');
const fixturePath = path.join(here, 'fixtures', 'sample-plan.md');

test('CLI prints parsed tasks and graph as JSON', () => {
  const output = execFileSync('node', [cliPath, fixturePath], { encoding: 'utf8' });
  const parsed = JSON.parse(output);

  assert.equal(parsed.tasks.length, 3);
  assert.deepEqual(parsed.graph['3'], [1, 2]);
});

test('CLI emite warnings de productor duplicado en stderr y en el JSON, sin ensuciar stdout', () => {
  const duplicateFixture = path.join(here, 'fixtures', 'duplicate-producer-plan.md');
  const result = spawnSync('node', [cliPath, duplicateFixture], { encoding: 'utf8' });

  assert.equal(result.status, 0, 'la ambigüedad es warning, no error');
  const parsed = JSON.parse(result.stdout); // stdout debe seguir siendo JSON puro
  assert.match(parsed.warnings.join('\n'), /createWidget/);
  assert.match(result.stderr, /createWidget/);
});

test('CLI exits non-zero with a usage message when no path is given', () => {
  assert.throws(() => execFileSync('node', [cliPath], { encoding: 'utf8' }));
});

test('el comando publicado en examples/README.md imprime el grafo que ese README promete', () => {
  // examples/README.md muestra `node bin/parse-plan.js examples/hello-parallel/plan.md`
  // como el primer contacto de un dev nuevo con cys — si el CLI cambia de forma
  // incompatible, este test debe romperse ANTES que el README quede mintiendo.
  const examplePath = path.join(root, 'examples', 'hello-parallel', 'plan.md');
  const output = execFileSync('node', [cliPath, examplePath], { encoding: 'utf8' });
  const parsed = JSON.parse(output);

  assert.deepEqual(parsed.graph, { 1: [], 2: [1], 3: [1], 4: [2, 3] });
});
