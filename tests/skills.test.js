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

test('los comandos crean la integrationBranch con --no-track, para no heredar el upstream de origin/develop en silencio (hallazgo real de persons-crud)', () => {
  const flow = readFileSync(path.join(root, 'commands', 'flow.md'), 'utf8');
  const runPlan = readFileSync(path.join(root, 'commands', 'run-plan.md'), 'utf8');
  for (const [name, content] of [['flow.md', flow], ['run-plan.md', runPlan]]) {
    assert.ok(
      content.includes('branch --no-track <integration-branch> develop'),
      `commands/${name}: sin --no-track, si solo existe origin/develop (no develop local), git resuelve la rama y ` +
        `por defecto le pone el tracking apuntando a origin/develop — un push sin refspec explícito empujaría ahí`
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

test('.cursor-plugin/plugin.json comparte el mismo directorio de skills, sin fork (Cursor portability)', () => {
  const cursorManifest = JSON.parse(readFileSync(path.join(root, '.cursor-plugin', 'plugin.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(cursorManifest.name, 'cys');
  assert.equal(cursorManifest.skills, './skills/', 'debe apuntar al mismo directorio que usa Claude Code, sin fork');
  assert.equal(
    cursorManifest.version,
    pkg.version,
    'sin este candado, un bump de versión deja el manifest de Cursor desincronizado en silencio'
  );
});

test('guide documenta la alternativa manual cuando cys:run no está disponible (Cursor, Gemini CLI)', () => {
  const guide = readFileSync(path.join(skillsDir, 'guide', 'SKILL.md'), 'utf8');
  assert.ok(
    guide.includes('Cursor') &&
      guide.includes('Gemini CLI') &&
      guide.includes('execute its tasks yourself in dependency order'),
    'cys:guide debe explicar qué hacer cuando cys:run no está disponible (Cursor, Gemini CLI)'
  );
});

test('code-standards documenta que la unicidad de negocio necesita respaldo a nivel de base de datos, no solo un chequeo en la capa de servicio (TOCTOU, hallazgo real de persons-crud)', () => {
  const codeStandards = readFileSync(path.join(skillsDir, 'check', 'references', 'code-standards.md'), 'utf8');
  assert.ok(
    codeStandards.includes('TOCTOU') && codeStandards.includes('database-level backstop'),
    'code-standards.md debe advertir sobre invariantes de unicidad sin respaldo de base de datos'
  );
});

test('plan exige un test por fila cuando el spec afirma cobertura exhaustiva de una tabla (hallazgo real de persons-crud)', () => {
  const plan = readFileSync(path.join(skillsDir, 'plan', 'SKILL.md'), 'utf8');
  assert.ok(
    plan.includes('Exhaustive-coverage claims'),
    'cys:plan debe exigir enumerar cada fila como test explícito cuando el spec afirma cobertura exhaustiva'
  );
});

test('plan exige forzar mecánicamente una versión de lenguaje/runtime fijada en Global Constraints, no solo declararla (hallazgo real de persons-crud, JDK 17 sin enforcer)', () => {
  const plan = readFileSync(path.join(skillsDir, 'plan', 'SKILL.md'), 'utf8');
  assert.ok(
    plan.includes('Version/toolchain enforcement'),
    'cys:plan debe exigir que una versión fijada en Global Constraints quede forzada mecánicamente, no solo declarada'
  );
});

test('plan exige revisar las aristas reales del grafo en el dry-run, no confiar solo en "warnings": [] (hallazgo real de persons-crud)', () => {
  const plan = readFileSync(path.join(skillsDir, 'plan', 'SKILL.md'), 'utf8');
  assert.ok(
    plan.includes('An empty warnings array is not proof the graph is right'),
    'cys:plan debe advertir explícitamente que un array de warnings vacío no prueba que el grafo esté bien'
  );
});

test('design exige verificar empíricamente restricciones de entorno en vez de heredarlas de un spec/pilot anterior (hallazgo real de persons-crud: Docker asumido bloqueado sin chequear)', () => {
  const design = readFileSync(path.join(skillsDir, 'design', 'SKILL.md'), 'utf8');
  assert.ok(
    design.includes('Environment-dependent constraints are verified, not inherited'),
    'cys:design debe exigir verificar restricciones de entorno en vez de heredarlas de otro spec/pilot'
  );
});

test('los comandos aseguran que .cys/ esté en .gitignore del repo destino antes de lanzar (hallazgo real: 21 archivos untracked listos para commitearse por accidente)', () => {
  const flow = readFileSync(path.join(root, 'commands', 'flow.md'), 'utf8');
  const runPlan = readFileSync(path.join(root, 'commands', 'run-plan.md'), 'utf8');
  for (const [name, content] of [['flow.md', flow], ['run-plan.md', runPlan]]) {
    assert.ok(
      content.includes('Ensure `.cys/` is gitignored'),
      `commands/${name} debe verificar y asegurar que .cys/ esté en .gitignore antes de que el run escriba ahí`
    );
  }
});

test('gemini-extension.json declara la extensión cys, en lockstep de versión (Gemini CLI portability)', () => {
  const geminiManifest = JSON.parse(readFileSync(path.join(root, 'gemini-extension.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(geminiManifest.name, 'cys');
  assert.ok(geminiManifest.description && geminiManifest.description.length > 0);
  assert.equal(
    geminiManifest.version,
    pkg.version,
    'sin este candado, un bump de versión deja el manifest de Gemini desincronizado en silencio'
  );
});

test('skills/run/ no existe: cys:run queda fuera del auto-discovery de Gemini CLI', () => {
  assert.equal(
    existsSync(path.join(skillsDir, 'run')),
    false,
    'una carpeta skills/run/ expondría cys:run por convención de Gemini, rompiendo el scope de este port'
  );
});

test('plan documenta el fallback de hand-off cuando cys:run no está disponible (Cursor, Gemini CLI)', () => {
  const plan = readFileSync(path.join(skillsDir, 'plan', 'SKILL.md'), 'utf8');
  assert.ok(
    plan.includes('Cursor') && plan.includes('Gemini CLI'),
    'cys:plan debe mencionar qué hacer en plataformas sin cys:run (Cursor, Gemini CLI)'
  );
});

test('guide dice honestamente cuándo cys:run es overhead y conviene un fix a mano', () => {
  const guide = readFileSync(path.join(skillsDir, 'guide', 'SKILL.md'), 'utf8');
  assert.ok(
    guide.includes('When cys is overhead'),
    'cys:guide debe decir cuándo el flujo completo no vale la pena, no solo cuándo usarlo'
  );
});
