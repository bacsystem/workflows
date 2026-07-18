import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = path.join(root, 'skills');

// Frontmatter YAML mínimo: bloque --- ... --- con name: y description: no vacíos.
function parseFrontmatter(markdown) {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z-]+):\s*(.+)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

test('plugin.json declara el plugin cys con los campos mínimos', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'cys');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.description && manifest.description.length > 0);
});

test('la versión del plugin está sincronizada con package.json', () => {
  // Sin este candado, el próximo bump de package.json deja plugin.json atrás en silencio
  // (hallazgo de la review final de F2).
  const manifest = JSON.parse(readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version);
});

test('marketplace.json se autohospeda apuntando a la raíz del repo', () => {
  const market = JSON.parse(readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.equal(market.name, 'bacsystem');
  assert.ok(Array.isArray(market.plugins) && market.plugins.length === 1);
  assert.equal(market.plugins[0].name, 'cys');
  assert.equal(market.plugins[0].source, './');
});

test('el set de skills v1 del plugin está completo', () => {
  const expected = ['check', 'design', 'guide', 'plan', 'ship'];
  const actual = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  assert.deepEqual(actual, expected);
});

test('cada skill existente tiene SKILL.md con frontmatter name/description válidos', () => {
  if (!existsSync(skillsDir)) return; // aún sin skills: las tareas 2-6 las agregan
  for (const dir of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const skillFile = path.join(skillsDir, dir.name, 'SKILL.md');
    assert.ok(existsSync(skillFile), `skills/${dir.name} necesita un SKILL.md`);
    const fm = parseFrontmatter(readFileSync(skillFile, 'utf8'));
    assert.ok(fm, `skills/${dir.name}/SKILL.md necesita frontmatter ---`);
    assert.equal(fm.name, dir.name, 'el name del frontmatter debe coincidir con el directorio');
    assert.ok(fm.description && fm.description.length >= 20, 'la description guía la invocación: no puede ser vacía ni trivial');
  }
});

test('los comandos crean la integrationBranch desde develop si no existe antes de lanzar (Fase 4a fix 1)', () => {
  const flow = readFileSync(path.join(root, 'commands', 'flow.md'), 'utf8');
  const runPlan = readFileSync(path.join(root, 'commands', 'run-plan.md'), 'utf8');
  for (const [name, content] of [['flow.md', flow], ['run-plan.md', runPlan]]) {
    assert.ok(
      content.includes('create it from `develop`'),
      `commands/${name} debe crear la rama de integración desde develop si no existe (antes solo cubría el caso "ya existe")`
    );
  }
});

test('los comandos detectan .cys/state.json de una corrida interrumpida (Fase 4b)', () => {
  const flow = readFileSync(path.join(root, 'commands', 'flow.md'), 'utf8');
  const runPlan = readFileSync(path.join(root, 'commands', 'run-plan.md'), 'utf8');
  assert.ok(
    flow.includes('.cys/state.json'),
    'commands/flow.md debe chequear si hay estado de una corrida interrumpida'
  );
  assert.ok(
    runPlan.includes('.cys/state.json') && runPlan.includes('bin/plan-remainder.js'),
    'commands/run-plan.md debe chequear el estado y ofrecer bin/plan-remainder.js para reanudar'
  );
});

test('run-plan.md maneja allDone lanzando con finishOnly en vez de fallar por tasks vacío (final review, hallazgo Important #2)', () => {
  const runPlan = readFileSync(path.join(root, 'commands', 'run-plan.md'), 'utf8');
  assert.ok(
    runPlan.includes('allDone') && runPlan.includes('finishOnly: true'),
    'run-plan.md debe detectar allDone y lanzar con finishOnly en vez de reintentar tareas ya mergeadas'
  );
});

test('cada comando del plugin tiene frontmatter con description', () => {
  const commandsDir = path.join(root, 'commands');
  const files = readdirSync(commandsDir).filter((f) => f.endsWith('.md'));
  assert.ok(files.includes('flow.md'), 'el comando /cys:flow debe existir');
  assert.ok(files.includes('run-plan.md'), 'el comando /cys:run-plan debe existir');
  for (const file of files) {
    const fm = parseFrontmatter(readFileSync(path.join(commandsDir, file), 'utf8'));
    assert.ok(fm, `commands/${file} necesita frontmatter ---`);
    assert.ok(fm.description && fm.description.length >= 20, `commands/${file}: la description guía la invocación`);
  }
});

test('guide y ship documentan que se superponen cuando cys:run corre con openPr: true', () => {
  const guide = readFileSync(path.join(skillsDir, 'guide', 'SKILL.md'), 'utf8');
  const ship = readFileSync(path.join(skillsDir, 'ship', 'SKILL.md'), 'utf8');
  assert.ok(
    guide.includes('openPr: true') && guide.includes('Handoff agent'),
    'cys:guide debe explicar cuándo cys:ship es redundante con el Handoff automático'
  );
  assert.ok(
    ship.includes('openPr: true') && ship.includes('Not needed'),
    'cys:ship debe aclarar que no hace falta invocarlo si cys:run ya abrió el PR solo'
  );
});

test('guide documenta la convención .cys/pending.md y sus tres secciones fijas', () => {
  const guide = readFileSync(path.join(skillsDir, 'guide', 'SKILL.md'), 'utf8');
  assert.ok(
    guide.includes('.cys/pending.md') &&
      guide.includes('## Bugs') &&
      guide.includes('## Gaps') &&
      guide.includes('## Tareas'),
    'cys:guide debe documentar el archivo de pendientes y sus tres secciones fijas'
  );
});

test('check documenta que un hallazgo diferido se registra en .cys/pending.md', () => {
  const check = readFileSync(path.join(skillsDir, 'check', 'SKILL.md'), 'utf8');
  assert.ok(
    check.includes('.cys/pending.md'),
    'cys:check debe anotar en .cys/pending.md los hallazgos que el usuario decide no corregir ahora'
  );
});

test('run-plan.md y flow.md ofrecen el texto de reintento manual (Routine Local) al terminar de lanzar (Fase 4c)', () => {
  const runPlan = readFileSync(path.join(root, 'commands', 'run-plan.md'), 'utf8');
  const flow = readFileSync(path.join(root, 'commands', 'flow.md'), 'utf8');
  for (const [name, content] of [['run-plan.md', runPlan], ['flow.md', flow]]) {
    assert.ok(
      content.includes('Desktop Local Routine') &&
        content.includes('Check whether <repo-path>/.cys/state.json exists') &&
        content.includes("don't have one this time"),
      `commands/${name} debe ofrecer el texto de reintento manual, chequear .cys/state.json y no dar autorización de merge en el prompt generado`
    );
  }
});
