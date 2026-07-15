import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkflowArgs } from '../src/validate-args.js';

// Args mínimos válidos; cada test sobreescribe lo que quiere romper.
const BRANCH = { integrationBranch: 'develop' };

test('acepta args válidos con un DAG consistente', () => {
  const tasks = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }];
  assert.doesNotThrow(() => validateWorkflowArgs({ tasks, graph: { 1: [], 2: [1] }, ...BRANCH }));
});

test('rechaza tasks vacío o ausente', () => {
  assert.throws(() => validateWorkflowArgs({ tasks: [], graph: {}, ...BRANCH }), /non-empty array/);
  assert.throws(() => validateWorkflowArgs({ tasks: undefined, graph: {}, ...BRANCH }), /non-empty array/);
});

test('rechaza un graph ausente', () => {
  assert.throws(() => validateWorkflowArgs({ tasks: [{ id: 1, title: 'A' }], graph: null, ...BRANCH }), /must be an object/);
});

test('rechaza una integrationBranch ausente o vacía: los agentes de merge no deben adivinar', () => {
  const tasks = [{ id: 1, title: 'A' }];
  const graph = { 1: [] };
  assert.throws(() => validateWorkflowArgs({ tasks, graph }), /integrationBranch/);
  assert.throws(() => validateWorkflowArgs({ tasks, graph, integrationBranch: '' }), /integrationBranch/);
  assert.throws(() => validateWorkflowArgs({ tasks, graph, integrationBranch: '   ' }), /integrationBranch/);
  assert.throws(() => validateWorkflowArgs({ tasks, graph, integrationBranch: 42 }), /integrationBranch/);
});

test('rechaza un grafo que referencia una tarea inexistente', () => {
  const tasks = [{ id: 1, title: 'A' }];
  assert.throws(() => validateWorkflowArgs({ tasks, graph: { 1: [], 2: [] }, ...BRANCH }),
    /task 2.*not present in tasks/i);
});

test('rechaza una dependencia hacia una tarea inexistente', () => {
  const tasks = [{ id: 1, title: 'A' }];
  assert.throws(() => validateWorkflowArgs({ tasks, graph: { 1: [99] }, ...BRANCH }),
    /dependency 99/i);
});

test('rechaza una tarea que falta en el grafo', () => {
  const tasks = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }];
  assert.throws(() => validateWorkflowArgs({ tasks, graph: { 1: [] }, ...BRANCH }),
    /task 2 is missing from the graph/i);
});

test('rechaza ids de tarea duplicados en vez de perder una tarea en silencio', () => {
  const tasks = [{ id: 1, title: 'A' }, { id: 1, title: 'B' }];
  assert.throws(() => validateWorkflowArgs({ tasks, graph: { 1: [] }, ...BRANCH }),
    /duplicate task id 1/i);
});

test('rechaza un grafo cíclico', () => {
  const tasks = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }];
  assert.throws(() => validateWorkflowArgs({ tasks, graph: { 1: [2], 2: [1] }, ...BRANCH }),
    /Cycle detected/);
});
