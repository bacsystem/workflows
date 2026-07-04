import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const schedulerSource = readFileSync(path.join(root, 'src', 'scheduler.js'), 'utf8')
  .replace(/^export\s+/m, '');

const templatePath = path.join(root, 'workflows', 'parallel-plan-executor.template.js');
const template = readFileSync(templatePath, 'utf8');

const PLACEHOLDER = '/* __SCHEDULER_SOURCE__ */';
if (!template.includes(PLACEHOLDER)) {
  throw new Error(`Template is missing the ${PLACEHOLDER} placeholder`);
}

const output = template.replace(PLACEHOLDER, schedulerSource);

const outputPath = path.join(root, 'workflows', 'parallel-plan-executor.js');
writeFileSync(outputPath, output);
console.log(`Built ${outputPath}`);
