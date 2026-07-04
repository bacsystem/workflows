import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parsePlan } from '../src/plan-parser.js';
import { buildGraph } from '../src/graph-builder.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('infers dependencies from Produces/Consumes symbols', () => {
  const plan = readFileSync(path.join(here, 'fixtures/sample-plan.md'), 'utf8');
  const tasks = parsePlan(plan);
  const graph = buildGraph(tasks);

  assert.deepEqual(graph[1], []);
  assert.deepEqual(graph[2], []);
  assert.deepEqual(graph[3], [1, 2]);
});

test('infers a dependency from overlapping Files even without a matching symbol', () => {
  const tasks = [
    { id: 1, title: 'A', files: { create: ['src/shared.js'], modify: [], test: [] }, interfaces: { consumes: [], produces: [] } },
    { id: 2, title: 'B', files: { create: [], modify: ['src/shared.js'], test: [] }, interfaces: { consumes: [], produces: [] } },
  ];
  const graph = buildGraph(tasks);
  assert.deepEqual(graph[2], [1]);
});

test('throws on a cyclic dependency', () => {
  const tasks = [
    { id: 1, title: 'A', files: { create: [], modify: [], test: [] }, interfaces: { consumes: ['b'], produces: ['a'] } },
    { id: 2, title: 'B', files: { create: [], modify: [], test: [] }, interfaces: { consumes: ['a'], produces: ['b'] } },
  ];
  assert.throws(() => buildGraph(tasks), /Cycle detected/);
});

test('builds a real graph from a business-core plan excerpt', () => {
  const excerpt = readFileSync(path.join(here, 'fixtures/business-core-excerpt.md'), 'utf8');
  const tasks = parsePlan(excerpt);
  const graph = buildGraph(tasks);
  assert.equal(Object.keys(graph).length, tasks.length);
});
