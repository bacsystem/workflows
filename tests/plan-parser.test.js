import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parsePlan } from '../src/plan-parser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const samplePlan = readFileSync(path.join(here, 'fixtures/sample-plan.md'), 'utf8');

test('parses task id, title, files, and interfaces', () => {
  const tasks = parsePlan(samplePlan);
  assert.equal(tasks.length, 3);

  assert.deepEqual(tasks[0], {
    id: 1,
    title: 'Widget core',
    files: { create: ['src/widget.js'], modify: [], test: ['tests/widget.test.js'] },
    interfaces: { consumes: [], produces: ['createWidget'] },
  });

  assert.deepEqual(tasks[2].files, {
    create: ['src/bridge.js'],
    modify: ['src/widget.js'],
    test: ['tests/bridge.test.js'],
  });
  assert.deepEqual(tasks[2].interfaces.consumes.sort(), ['createGadget', 'createWidget']);
});

test('strips line-range suffixes from Modify paths', () => {
  const text = [
    '### Task 1: X',
    '',
    '**Files:**',
    '- Modify: `src/existing.py:123-145`',
    '',
    '**Interfaces:**',
    '- Consumes:',
    '- Produces:',
    '',
    '- [ ] **Step 1: x**',
  ].join('\n');
  const [task] = parsePlan(text);
  assert.deepEqual(task.files.modify, ['src/existing.py']);
});

test('handles a real excerpt from the business-core plan without throwing', () => {
  const excerpt = readFileSync(path.join(here, 'fixtures/business-core-excerpt.md'), 'utf8');
  const tasks = parsePlan(excerpt);
  assert.ok(tasks.length >= 1);
  assert.ok(tasks[0].title.length > 0);
});

test('solo extrae símbolos entre backticks, ignorando las palabras de prosa', () => {
  const text = [
    '### Task 1: X',
    '',
    '**Interfaces:**',
    '- Consumes: the `loadConfig()` helper and the widget utilities from task 3',
    '- Produces: the `makeA()` factory used by every later task that needs widgets',
    '',
    '- [ ] **Step 1: x**',
  ].join('\n');
  const [task] = parsePlan(text);
  assert.deepEqual(task.interfaces.consumes, ['loadConfig']);
  assert.deepEqual(task.interfaces.produces, ['makeA']);
});

test('trata "Consumes: None" y "Produces: None" como interfaces vacías', () => {
  const text = [
    '### Task 1: X',
    '',
    '**Interfaces:**',
    '- Consumes: None',
    '- Produces: None (pure scaffolding)',
    '',
    '- [ ] **Step 1: x**',
  ].join('\n');
  const [task] = parsePlan(text);
  assert.deepEqual(task.interfaces, { consumes: [], produces: [] });
});

test('rechaza un plan con ids de tarea duplicados en vez de perder una tarea en silencio', () => {
  const text = [
    '### Task 1: A',
    '',
    '- [ ] **Step 1: x**',
    '',
    '### Task 1: B',
    '',
    '- [ ] **Step 1: x**',
  ].join('\n');
  assert.throws(() => parsePlan(text), /[Dd]uplicate task id 1/);
});

test('preserva rutas con dos puntos (drive de Windows) al quitar rangos de líneas', () => {
  const text = [
    '### Task 1: X',
    '',
    '**Files:**',
    '- Modify: `C:/legacy/app.py:10-20`',
    '- Modify: `src/utils.py:88`',
    '',
    '- [ ] **Step 1: x**',
  ].join('\n');
  const [task] = parsePlan(text);
  assert.deepEqual(task.files.modify, ['C:/legacy/app.py', 'src/utils.py']);
});

test('una sección termina también en un header bold de varias palabras', () => {
  const text = [
    '### Task 1: X',
    '',
    '**Files:**',
    '- Create: `a.js`',
    '',
    '**Extra Notes:**',
    '- Modify: `b.js` is mentioned here as prose, not as a Files entry',
    '',
    '- [ ] **Step 1: x**',
  ].join('\n');
  const [task] = parsePlan(text);
  assert.deepEqual(task.files.create, ['a.js']);
  assert.deepEqual(task.files.modify, []);
});

test('parses a plan with CRLF line endings identically to LF', () => {
  // Normalize the on-disk fixture to LF first (git checkout settings such as
  // core.autocrlf can already have converted it) before forcing it to CRLF,
  // so this test faithfully represents a Windows CRLF checkout regardless of
  // how the fixture itself was checked out.
  const lfPlan = samplePlan.replace(/\r\n/g, '\n');
  const crlfPlan = lfPlan.replace(/\n/g, '\r\n');
  const lfTasks = parsePlan(lfPlan);
  const crlfTasks = parsePlan(crlfPlan);

  assert.equal(crlfTasks.length, 3);
  assert.deepEqual(crlfTasks, lfTasks);
});
