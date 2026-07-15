import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkflowArgs } from '../src/validate-args.js';

test('acepta args válidos con un DAG consistente', () => {
  const tasks = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }];
  assert.doesNotThrow(() => validateWorkflowArgs({ tasks, graph: { 1: [], 2: [1] } }));
});

test('rechaza tasks vacío o ausente', () => {
  assert.throws(() => validateWorkflowArgs({ tasks: [], graph: {} }), /non-empty array/);
  assert.throws(() => validateWorkflowArgs({ tasks: undefined, graph: {} }), /non-empty array/);
});

test('rechaza un graph ausente', () => {
  assert.throws(() => validateWorkflowArgs({ tasks: [{ id: 1, title: 'A' }], graph: null }), /must be an object/);
});

test('rechaza un grafo que referencia una tarea inexistente', () => {
  const tasks = [{ id: 1, title: 'A' }];
  assert.throws(() => validateWorkflowArgs({ tasks, graph: { 1: [], 2: [] } }),
    /task 2.*not present in tasks/i);
});

test('rechaza una dependencia hacia una tarea inexistente', () => {
  const tasks = [{ id: 1, title: 'A' }];
  assert.throws(() => validateWorkflowArgs({ tasks, graph: { 1: [99] } }),
    /dependency 99/i);
});

test('rechaza una tarea que falta en el grafo', () => {
  const tasks = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }];
  assert.throws(() => validateWorkflowArgs({ tasks, graph: { 1: [] } }),
    /task 2 is missing from the graph/i);
});

test('rechaza un grafo cíclico', () => {
  const tasks = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }];
  assert.throws(() => validateWorkflowArgs({ tasks, graph: { 1: [2], 2: [1] } }),
    /Cycle detected/);
});
