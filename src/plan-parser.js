import { assertUniqueTaskIds } from './graph-builder.js';

const TASK_HEADER_RE = /^### Task (\d+): (.+)$/m;

export function parsePlanWithDiagnostics(planText) {
  planText = planText.replace(/\r\n/g, '\n');
  const parts = planText.split(TASK_HEADER_RE);
  const tasks = [];
  const warnings = [];
  // parts = [preamble, id1, title1, body1, id2, title2, body2, ...]
  for (let i = 1; i < parts.length; i += 3) {
    const id = Number(parts[i]);
    const title = parts[i + 1].trim();
    const body = parts[i + 2];
    tasks.push({
      id,
      title,
      files: parseFiles(body),
      interfaces: parseInterfaces(body, id, warnings),
    });
  }
  assertUniqueTaskIds(tasks);
  return { tasks, warnings };
}

export function parsePlan(planText) {
  return parsePlanWithDiagnostics(planText).tasks;
}

// El terminador solo reconoce un header bold que ocupa la línea completa (p. ej.
// **Global Constraints:** o **Non-Goals:**) — una anotación bold con texto detrás
// ("**Watch Out:** no tocar...") no corta la sección; [^*\n] admite dígitos, guiones
// y '&' en el nombre del header.
const SECTION_END = '(?=\\n\\*\\*[A-Z][^*\\n]*:\\*\\*(?:\\n|$)|\\n- \\[ \\]|$)';
const FILES_SECTION_RE = new RegExp(`\\*\\*Files:\\*\\*\\n([\\s\\S]*?)${SECTION_END}`);
const INTERFACES_SECTION_RE = new RegExp(`\\*\\*Interfaces:\\*\\*\\n([\\s\\S]*?)${SECTION_END}`);

function extractSection(body, sectionRe) {
  const match = body.match(sectionRe);
  return match ? match[1] : '';
}

function parseFiles(body) {
  const section = extractSection(body, FILES_SECTION_RE);
  const files = { create: [], modify: [], test: [] };
  for (const line of section.split('\n')) {
    const m = line.match(/^-\s*(Create|Modify|Test):\s*`([^`]+)`/);
    if (!m) continue;
    const kind = m[1].toLowerCase();
    // Quita solo un sufijo de rangos de líneas (":123", ":123-145" o ":10-20,40-55")
    // al final; un split por ":" truncaba rutas absolutas de Windows ("C:/app.py").
    const filePath = m[2].replace(/:\d+(?:-\d+)?(?:,\s*\d+(?:-\d+)?)*$/, '');
    files[kind].push(filePath);
  }
  return files;
}

// Solo cuenta como símbolo lo que está entre backticks: extraer cualquier identificador
// de la prosa convertía palabras como "the", "task" o "None" en símbolos, creando
// dependencias espurias entre tareas sin relación (y hasta falsos ciclos que rechazaban
// planes válidos). Known limitation: a value that wraps onto a second line is not
// captured (Consumes/Produces are matched line-by-line, see below) — a missed dependency
// here does not silently misorder tasks: the affected task fails loudly (or reports
// BLOCKED) and its transitive dependents are skipped, all surfaced in the final report.
const BACKTICK_SPAN_RE = /`([^`]+)`/g;
const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_.]*/g;

function extractSymbols(line) {
  const symbols = [];
  for (const [, rawSpan] of line.matchAll(BACKTICK_SPAN_RE)) {
    // Drop parenthesized call-argument lists first (e.g. the "name" in
    // `createWidget(name)`) so parameter names aren't mistaken for separate
    // produced/consumed symbols.
    const span = rawSpan.replace(/\([^)]*\)/g, '').trim();
    if (/[\\/]/.test(span)) {
      // Una ruta entre backticks es UN símbolo (la ruta completa): fragmentarla
      // convertía "src" en un símbolo compartido por medio plan.
      symbols.push(span);
      continue;
    }
    for (const [identifier] of span.matchAll(IDENTIFIER_RE)) {
      if (identifier.length > 1) symbols.push(identifier);
    }
  }
  return symbols;
}

// "None"/"N/A"/"nothing" al comienzo del valor significa deliberadamente vacío.
const NO_SYMBOLS_RE = /^(none|n\/a|nothing)\b/i;

function parseInterfaces(body, taskId, warnings) {
  const section = extractSection(body, INTERFACES_SECTION_RE);
  const interfaces = { consumes: [], produces: [] };
  for (const line of section.split('\n')) {
    const consumes = line.match(/^-\s*Consumes:\s*(.*)$/);
    const produces = line.match(/^-\s*Produces:\s*(.*)$/);
    const match = consumes ?? produces;
    if (!match) continue;
    const value = match[1].trim();
    if (!value || NO_SYMBOLS_RE.test(value)) continue;
    const symbols = extractSymbols(value);
    if (symbols.length === 0) {
      // La línea tiene contenido pero ningún backtick: se ignora, pero avisando — una
      // dependencia perdida en silencio es justo lo que este parser debe evitar.
      warnings.push(
        `Task ${taskId}: ${consumes ? 'Consumes' : 'Produces'} line has no backtick-quoted ` +
        `symbols and was ignored: "${value}"`
      );
      continue;
    }
    (consumes ? interfaces.consumes : interfaces.produces).push(...symbols);
  }
  return interfaces;
}

// Devuelve el bloque completo de una tarea ("### Task N: <título>" + cuerpo hasta el
// próximo header de tarea o EOF), o null si el id no existe. Es la fuente del
// task-brief: el implementador lee SOLO su tarea, nunca el plan entero.
export function extractTaskBlock(planText, taskId) {
  planText = planText.replace(/\r\n/g, '\n');
  const parts = planText.split(TASK_HEADER_RE);
  // parts = [preámbulo, id1, título1, cuerpo1, id2, título2, cuerpo2, ...]
  for (let i = 1; i < parts.length; i += 3) {
    if (Number(parts[i]) !== taskId) continue;
    // El separador "---" entre tareas pertenece al plan, no a la tarea.
    const body = parts[i + 2].replace(/\n---\s*$/, '\n');
    return `### Task ${parts[i]}: ${parts[i + 1]}${body}`;
  }
  return null;
}
