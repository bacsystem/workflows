import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parsePlan } from '../src/plan-parser.js';
import { buildGraph } from '../src/graph-builder.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('el ejemplo hello-parallel parsea y muestra Tarea 2 y 3 en paralelo', () => {
  const plan = readFileSync(path.join(root, 'examples', 'hello-parallel', 'plan.md'), 'utf8');
  const tasks = parsePlan(plan);
  const graph = buildGraph(tasks);

  assert.deepEqual(graph[1], []);
  assert.deepEqual(graph[2], [1]);
  assert.deepEqual(graph[3], [1]);
  assert.deepEqual(graph[4], [2, 3]);
});
