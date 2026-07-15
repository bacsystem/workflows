import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineSource } from '../scripts/inline-source.js';

const LF_MODULE = "import { x } from './x.js';\n\nexport function f() {\n  return x;\n}\n";
// Mismo módulo tal como queda en un working copy Windows con core.autocrlf=true
const CRLF_MODULE = LF_MODULE.replace(/\n/g, '\r\n');

test('quita imports y exports de un módulo con finales LF', () => {
  const inlined = inlineSource(LF_MODULE);
  assert.ok(!inlined.includes('import '));
  assert.ok(!inlined.includes('export '));
  assert.ok(inlined.includes('function f()'));
});

test('quita imports y exports igual con finales CRLF', () => {
  const inlined = inlineSource(CRLF_MODULE);
  assert.ok(!inlined.includes('import '), 'las líneas import deben eliminarse aunque terminen en \\r\\n');
  assert.ok(!inlined.includes('export '));
  assert.ok(inlined.includes('function f()'));
});

test('normaliza CRLF a LF en el resultado', () => {
  assert.ok(!inlineSource(CRLF_MODULE).includes('\r'));
});
