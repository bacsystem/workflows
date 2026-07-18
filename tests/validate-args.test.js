import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkflowArgs } from '../src/validate-args.js';

// Args mínimos válidos; cada test sobreescribe lo que quiere romper.
const BRANCH = { integrationBranch: 'develop', executorPath: 'D:/tools/parallel-plan-executor' };

test('acepta args válidos con un DAG consistente', () => {
  const tasks = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }];
  assert.doesNotThrow(() => validateWorkflowArgs({ tasks, graph: { 1: [], 2: [1] }, ...BRANCH }));
});

test('rechaza tasks vacío o ausente', () => {
  assert.throws(() => validateWorkflowArgs({ tasks: [], graph: {}, ...BRANCH }), /non-empty array/);
  assert.throws(() => validateWorkflowArgs({ tasks: undefined, graph: {}, ...BRANCH }), /non-empty array/);
});

test('acepta tasks vacío cuando finishOnly es true — toda la corrida ya se mergeó, solo falta el cierre (final review, hallazgo Important #2)', () => {
  assert.doesNotThrow(() =>
    validateWorkflowArgs({ tasks: [], graph: {}, ...BRANCH, finishOnly: true })
  );
});

test('rechaza finishOnly no-booleano', () => {
  assert.throws(
    () => validateWorkflowArgs({ tasks: [], graph: {}, ...BRANCH, finishOnly: 'yes' }),
    /finishOnly/
  );
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

test('rechaza un executorPath ausente o vacío: los prompts invocan bin/ por ruta exacta', () => {
  const base = {
    tasks: [{ id: 1 }],
    graph: { 1: [] },
    integrationBranch: 'feature/x',
  };
  assert.throws(() => validateWorkflowArgs({ ...base }), /executorPath/);
  assert.throws(() => validateWorkflowArgs({ ...base, executorPath: '' }), /executorPath/);
  assert.throws(() => validateWorkflowArgs({ ...base, executorPath: 42 }), /executorPath/);
  assert.doesNotThrow(() =>
    validateWorkflowArgs({ ...base, executorPath: 'D:/tools/parallel-plan-executor' })
  );
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

test('acepta openPr booleano y pr objeto; rechaza formas inválidas', () => {
  const tasks = [{ id: 1, title: 'A' }];
  const graph = { 1: [] };
  assert.doesNotThrow(() => validateWorkflowArgs({ tasks, graph, ...BRANCH, openPr: true, pr: { base: 'develop', closes: 42 } }));
  assert.throws(() => validateWorkflowArgs({ tasks, graph, ...BRANCH, openPr: 'yes' }), /openPr/);
  assert.throws(() => validateWorkflowArgs({ tasks, graph, ...BRANCH, pr: 'develop' }), /args\.pr/);
  assert.throws(() => validateWorkflowArgs({ tasks, graph, ...BRANCH, pr: ['x'] }), /args\.pr/);
});

test('acepta mergeAuthorization string; rechaza formas no-string', () => {
  const tasks = [{ id: 1, title: 'A' }];
  const graph = { 1: [] };
  assert.doesNotThrow(() => validateWorkflowArgs({ tasks, graph, ...BRANCH, mergeAuthorization: 'Autorizo mergear task-1' }));
  assert.throws(() => validateWorkflowArgs({ tasks, graph, ...BRANCH, mergeAuthorization: true }), /mergeAuthorization/);
  assert.throws(() => validateWorkflowArgs({ tasks, graph, ...BRANCH, mergeAuthorization: 42 }), /mergeAuthorization/);
});

test('rechaza un grafo cíclico', () => {
  const tasks = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }];
  assert.throws(() => validateWorkflowArgs({ tasks, graph: { 1: [2], 2: [1] }, ...BRANCH }),
    /Cycle detected/);
});
