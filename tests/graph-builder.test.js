import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parsePlan } from '../src/plan-parser.js';
import { buildGraph, buildGraphWithDiagnostics, assertAcyclic, computeParallelWidth } from '../src/graph-builder.js';

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

test('serializa en cadena las tareas que tocan el mismo archivo', () => {
  const tasks = [
    { id: 1, title: 'A', files: { create: ['src/shared.js'], modify: [], test: [] }, interfaces: { consumes: [], produces: [] } },
    { id: 2, title: 'B', files: { create: [], modify: ['src/shared.js'], test: [] }, interfaces: { consumes: [], produces: [] } },
    { id: 3, title: 'C', files: { create: [], modify: ['src/shared.js'], test: [] }, interfaces: { consumes: [], produces: [] } },
  ];
  const graph = buildGraph(tasks);
  assert.deepEqual(graph[1], []);
  assert.deepEqual(graph[2], [1]);
  assert.deepEqual(graph[3], [2], 'la tarea 3 debe depender del ÚLTIMO que tocó el archivo, no del primero');
});

test('advierte cuando una tarea consume un símbolo que nadie produce', () => {
  const tasks = [{
    id: 1, title: 'A',
    files: { create: [], modify: [], test: [] },
    interfaces: { consumes: ['noExiste'], produces: [] },
  }];
  const { warnings } = buildGraphWithDiagnostics(tasks);
  assert.match(warnings.join('\n'), /task 1.*noExiste.*no task produces it/i);
});

test('no advierte cuando el símbolo consumido sí tiene productor', () => {
  const tasks = [
    { id: 1, title: 'A', files: { create: [], modify: [], test: [] }, interfaces: { consumes: [], produces: ['foo'] } },
    { id: 2, title: 'B', files: { create: [], modify: [], test: [] }, interfaces: { consumes: ['foo'], produces: [] } },
  ];
  const { warnings } = buildGraphWithDiagnostics(tasks);
  assert.equal(warnings.filter((w) => /produces it/i.test(w)).length, 0);
});

test('assertAcyclic maneja una cadena lineal larga sin fallar (guarda de regresión, no reproduce un desborde real hoy: ni 8M de tareas encadenadas revienta la pila recursiva en este entorno — igual se adopta la versión iterativa como defensa en profundidad para entornos con stack más chico)', () => {
  const LENGTH = 50000;
  const graph = {};
  graph[0] = [];
  for (let i = 1; i < LENGTH; i++) graph[i] = [i - 1];

  assert.doesNotThrow(() => assertAcyclic(graph));
});

test('throws on a cyclic dependency', () => {
  const tasks = [
    { id: 1, title: 'A', files: { create: [], modify: [], test: [] }, interfaces: { consumes: ['b'], produces: ['a'] } },
    { id: 2, title: 'B', files: { create: [], modify: [], test: [] }, interfaces: { consumes: ['a'], produces: ['b'] } },
  ];
  assert.throws(() => buildGraph(tasks), /Cycle detected/);
});

test('assertAcyclic detecta un ciclo en un grafo ya construido', () => {
  assert.throws(() => assertAcyclic({ 1: [2], 2: [1] }), /Cycle detected/);
});

test('assertAcyclic acepta un DAG válido', () => {
  assert.doesNotThrow(() => assertAcyclic({ 1: [], 2: [1], 3: [1, 2] }));
});

test('reporta un símbolo declarado por dos productores', () => {
  const tasks = [
    { id: 1, title: 'A', files: { create: [], modify: [], test: [] }, interfaces: { consumes: [], produces: ['createWidget'] } },
    { id: 2, title: 'B', files: { create: [], modify: [], test: [] }, interfaces: { consumes: [], produces: ['createWidget'] } },
  ];
  const { graph, warnings } = buildGraphWithDiagnostics(tasks);
  assert.match(warnings.join('\n'), /createWidget .* tasks 1, 2/);
  assert.deepEqual(graph[1], [], 'el primer productor sigue ganando: el grafo no cambia');
  assert.deepEqual(graph[2], []);
});

test('no emite warnings cuando cada símbolo tiene un solo productor', () => {
  const tasks = [
    { id: 1, title: 'A', files: { create: [], modify: [], test: [] }, interfaces: { consumes: [], produces: ['createWidget'] } },
    { id: 2, title: 'B', files: { create: [], modify: [], test: [] }, interfaces: { consumes: ['createWidget'], produces: [] } },
  ];
  const { warnings } = buildGraphWithDiagnostics(tasks);
  assert.deepEqual(warnings, []);
});

test('buildGraph rechaza ids duplicados en vez de colapsarlos en silencio', () => {
  const dup = [
    { id: 1, title: 'A', files: { create: [], modify: [], test: [] }, interfaces: { consumes: [], produces: [] } },
    { id: 1, title: 'B', files: { create: [], modify: [], test: [] }, interfaces: { consumes: [], produces: [] } },
  ];
  assert.throws(() => buildGraph(dup), /[Dd]uplicate task id 1/);
});

test('builds a real graph from a business-core plan excerpt', () => {
  const excerpt = readFileSync(path.join(here, 'fixtures/business-core-excerpt.md'), 'utf8');
  const tasks = parsePlan(excerpt);
  const graph = buildGraph(tasks);
  assert.equal(Object.keys(graph).length, tasks.length);
});

test('computeParallelWidth: tres tareas independientes da ancho 3', () => {
  assert.equal(computeParallelWidth({ 1: [], 2: [], 3: [] }), 3);
});

test('computeParallelWidth: una cadena lineal da ancho 1', () => {
  assert.equal(computeParallelWidth({ 1: [], 2: [1], 3: [2] }), 1);
});

test('computeParallelWidth: un diamante (2 base + 1 dependiente) da ancho 2', () => {
  assert.equal(computeParallelWidth({ 1: [], 2: [], 3: [1, 2] }), 2);
});

test('computeParallelWidth: grafo vacío da ancho 0', () => {
  assert.equal(computeParallelWidth({}), 0);
});
