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

test('el motivo del skip distingue failed de skipped y apunta a la causa raíz', async () => {
  const graph = { 1: [], 2: [1], 3: [2] };

  const results = await runDag(graph, async (id) => {
    if (id === 1) throw new Error('boom');
    return id;
  });

  // dependencia directa: la 1 realmente falló
  assert.match(results.get(2).reason, /failed dependency \(task 1\)/);
  // dependencia transitiva: la 2 fue skipped, no failed — y la causa raíz es la 1
  assert.match(results.get(3).reason, /skipped dependency \(task 2\)/);
  assert.match(results.get(3).reason, /root cause: task 1 failed/);
});

test('caps concurrency at maxConcurrency', async () => {
  const graph = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  let running = 0;
  let peak = 0;

  await runDag(graph, async (id) => {
    running++;
    peak = Math.max(peak, running);
    await delay(10);
    running--;
    return id;
  }, { maxConcurrency: 2 });

  assert.equal(peak, 2);
});

test('maxConcurrency: 1 over a chain preserves topological order', async () => {
  const graph = { 1: [], 2: [1], 3: [2] };
  const order = [];

  await runDag(graph, async (id) => {
    order.push(id);
    await delay(5);
  }, { maxConcurrency: 1 });

  assert.deepEqual(order, [1, 2, 3]);
});

test('no options means unlimited concurrency, same as before this change', async () => {
  const graph = { 1: [], 2: [], 3: [] };
  let running = 0;
  let peak = 0;

  await runDag(graph, async () => {
    running++;
    peak = Math.max(peak, running);
    await delay(10);
    running--;
  });

  assert.equal(peak, 3);
});

test('a diamond completes without deadlock under maxConcurrency: 2', async () => {
  const graph = { 1: [], 2: [], 3: [1, 2] };

  const results = await runDag(graph, async (id) => {
    await delay(5);
    return id;
  }, { maxConcurrency: 2 });

  assert.equal(results.get(3).status, 'done');
});
