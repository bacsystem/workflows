import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDag } from '../src/scheduler.js';

function delay(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

test('runs independent tasks concurrently, dependents after their deps', async () => {
  const graph = { 1: [], 2: [], 3: [1, 2] };
  const order = [];

  const results = await runDag(graph, async (id) => {
    order.push(`start-${id}`);
    await delay(id === 3 ? 5 : 20);
    order.push(`end-${id}`);
    return id * 10;
  });

  assert.equal(results.get(1).status, 'done');
  assert.equal(results.get(1).result, 10);
  assert.equal(results.get(3).result, 30);

  // both independent tasks must have started before either finished
  assert.ok(order.indexOf('start-2') < order.indexOf('end-1'));
  // the dependent task must not start until both deps have ended
  assert.ok(order.indexOf('start-3') > order.indexOf('end-1'));
  assert.ok(order.indexOf('start-3') > order.indexOf('end-2'));
});

test('marks a task failed and its dependents skipped', async () => {
  const graph = { 1: [], 2: [1] };

  const results = await runDag(graph, async (id) => {
    if (id === 1) throw new Error('boom');
    return id;
  });

  assert.equal(results.get(1).status, 'failed');
  assert.equal(results.get(1).error.message, 'boom');
  assert.equal(results.get(2).status, 'skipped');
});

test('independent branches keep running even if one branch fails', async () => {
  const graph = { 1: [], 2: [], 3: [1] };

  const results = await runDag(graph, async (id) => {
    if (id === 1) throw new Error('boom');
    await delay(5);
    return id;
  });

  assert.equal(results.get(2).status, 'done');
  assert.equal(results.get(3).status, 'skipped');
});

test('cascades skip status transitively through a chain of dependents', async () => {
  const graph = { 1: [], 2: [1], 3: [2] };
  const called = [];

  const results = await runDag(graph, async (id) => {
    called.push(id);
    if (id === 1) throw new Error('boom');
    return id;
  });

  assert.equal(results.get(1).status, 'failed');
  assert.equal(results.get(2).status, 'skipped');
  assert.equal(results.get(3).status, 'skipped');
  assert.ok(!called.includes(2));
  assert.ok(!called.includes(3));
});
