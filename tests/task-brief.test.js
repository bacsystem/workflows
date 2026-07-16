import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTaskBlock } from '../src/plan-parser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'bin', 'task-brief.js');

const PLAN = [
  '# Some Plan',
  '',
  '## Global Constraints',
  '',
  '- Node >= 20.',
  '',
  '---',
  '',
  '### Task 1: First thing',
  '',
  '**Files:**',
  '- Create: `src/a.js`',
  '',
  'Body of task one.',
  '',
  '---',
  '',
  '### Task 2: Second thing',
  '',
  '**Files:**',
  '- Create: `src/b.js`',
  '',
  'Body of task two.',
  '',
].join('\n');

test('extractTaskBlock devuelve el bloque completo de una tarea intermedia, sin el separador final', () => {
  const block = extractTaskBlock(PLAN, 1);
  assert.ok(block.startsWith('### Task 1: First thing'));
  assert.ok(block.includes('Body of task one.'));
  assert.ok(!block.includes('### Task 2'), 'no debe arrastrar la tarea siguiente');
  assert.ok(!/\n---\s*$/.test(block), 'el separador --- final no es parte de la tarea');
});

test('extractTaskBlock devuelve la última tarea (hasta EOF) y null para un id inexistente', () => {
  const block = extractTaskBlock(PLAN, 2);
  assert.ok(block.startsWith('### Task 2: Second thing'));
  assert.ok(block.includes('Body of task two.'));
  assert.equal(extractTaskBlock(PLAN, 99), null);
});

test('extractTaskBlock normaliza CRLF igual que el parser', () => {
  const block = extractTaskBlock(PLAN.replace(/\n/g, '\r\n'), 1);
  assert.ok(block.startsWith('### Task 1: First thing'));
});

test('el CLI escribe el brief en outDir (creándolo), imprime su ruta absoluta y no incluye otras tareas', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'task-brief-'));
  const planPath = path.join(dir, 'plan.md');
  writeFileSync(planPath, PLAN);
  const outDir = path.join(dir, 'nested', '.cys');

  const stdout = execFileSync('node', [cli, planPath, '2', outDir], { encoding: 'utf8' }).trim();

  assert.equal(stdout, path.resolve(outDir, 'task-2-brief.md'));
  assert.ok(existsSync(stdout));
  const content = readFileSync(stdout, 'utf8');
  assert.ok(content.startsWith('### Task 2: Second thing'));
  assert.ok(!content.includes('### Task 1'));
});

test('el CLI falla ruidosamente: sin args, taskId no entero, o tarea inexistente', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'task-brief-err-'));
  const planPath = path.join(dir, 'plan.md');
  writeFileSync(planPath, PLAN);

  assert.throws(() => execFileSync('node', [cli], { encoding: 'utf8', stdio: 'pipe' }));
  assert.throws(() => execFileSync('node', [cli, planPath, 'two', dir], { encoding: 'utf8', stdio: 'pipe' }));
  assert.throws(() => execFileSync('node', [cli, planPath, '99', dir], { encoding: 'utf8', stdio: 'pipe' }));
});
