import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// El workflow final es un solo archivo autocontenido (el sandbox no puede importar),
// así que cada módulo de src/ se inyecta quitándole imports y exports.
function inlineModule(...segments) {
  return readFileSync(path.join(root, ...segments), 'utf8')
    .replace(/^import\s.*\n/gm, '')
    .replace(/^export\s+/gm, '');
}

const schedulerSource = inlineModule('src', 'scheduler.js');
const validationSource = [
  inlineModule('src', 'graph-builder.js'),
  inlineModule('src', 'validate-args.js'),
].join('\n');

const templatePath = path.join(root, 'workflows', 'parallel-plan-executor.template.js');
let output = readFileSync(templatePath, 'utf8');

const placeholders = {
  '/* __SCHEDULER_SOURCE__ */': schedulerSource,
  '/* __VALIDATION_SOURCE__ */': validationSource,
};
for (const [placeholder, source] of Object.entries(placeholders)) {
  if (!output.includes(placeholder)) {
    throw new Error(`Template is missing the ${placeholder} placeholder`);
  }
  output = output.replace(placeholder, source);
}

const outputPath = path.join(root, 'workflows', 'parallel-plan-executor.js');
writeFileSync(outputPath, output);
console.log(`Built ${outputPath}`);
