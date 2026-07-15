import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { inlineSource } from './inline-source.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// El workflow final es un solo archivo autocontenido (el sandbox no puede importar),
// así que cada módulo de src/ se inyecta quitándole imports y exports.
function inlineModule(...segments) {
  return inlineSource(readFileSync(path.join(root, ...segments), 'utf8'));
}

const schedulerSource = inlineModule('src', 'scheduler.js');
const validationSource = [
  inlineModule('src', 'graph-builder.js'),
  inlineModule('src', 'validate-args.js'),
].join('\n');

const templatePath = path.join(root, 'workflows', 'parallel-plan-executor.template.js');
// El template también se normaliza a LF para que el artefacto sea determinista sin
// importar los finales de línea del working copy.
let output = readFileSync(templatePath, 'utf8').replace(/\r\n/g, '\n');

const placeholders = {
  '/* __SCHEDULER_SOURCE__ */': schedulerSource,
  '/* __VALIDATION_SOURCE__ */': validationSource,
  '/* __TIME_SOURCE__ */': inlineModule('src', 'time.js'),
};
for (const [placeholder, source] of Object.entries(placeholders)) {
  if (!output.includes(placeholder)) {
    throw new Error(`Template is missing the ${placeholder} placeholder`);
  }
  // Reemplazo con función: un string como segundo argumento interpretaría patrones
  // especiales ($&, $', $$...) dentro del código inyectado.
  output = output.replace(placeholder, () => source);
}

const outputPath = path.join(root, 'workflows', 'parallel-plan-executor.js');
writeFileSync(outputPath, output);
console.log(`Built ${outputPath}`);
