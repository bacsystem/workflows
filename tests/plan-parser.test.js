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
