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

test('quita un import multilínea completo, no solo su primera línea', () => {
  const module = [
    'import {',
    '  alpha,',
    '  beta,',
    "} from './x.js';",
    '',
    'export function f() {',
    '  return alpha + beta;',
    '}',
    '',
  ].join('\n');
  const inlined = inlineSource(module);
  assert.ok(!inlined.includes('import'), 'no debe quedar rastro del import');
  assert.ok(!inlined.includes('alpha,'), 'los especificadores del import deben irse con él');
  assert.ok(inlined.includes('function f()'));
  assert.ok(inlined.includes('return alpha + beta;'), 'el cuerpo del módulo debe quedar intacto');
});

test('falla ruidosamente ante un export default, que dejaría sintaxis inválida', () => {
  assert.throws(() => inlineSource('export default function f() {}\n'), /export default/);
});

test('quita un import aunque tenga un comentario al final de la línea', () => {
  const inlined = inlineSource("import { x } from './x.js'; // shared helper\nconst a = x;\n");
  assert.ok(!inlined.includes('import'), 'el comentario final no debe impedir el stripping');
  assert.ok(inlined.includes('const a = x;'));
});

test('falla ruidosamente ante re-exports y export-as-default, que dejarían sintaxis inválida', () => {
  assert.throws(() => inlineSource("export * from './x.js';\n"), /export/);
  assert.throws(() => inlineSource('export { f as default };\n'), /export/);
});

test('falla ruidosamente si queda algún import sin eliminar en el resultado', () => {
  // Forma de import que el regex de stripping no cubre: mejor reventar en el build que
  // enviar un artefacto que explota recién al cargarlo el sandbox sin imports.
  assert.throws(() => inlineSource("import x\n  from './y.js' whatever\nconst a = 1;\n"), /import/i);
});
