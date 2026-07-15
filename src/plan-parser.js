const TASK_HEADER_RE = /^### Task (\d+): (.+)$/m;

export function parsePlan(planText) {
  planText = planText.replace(/\r\n/g, '\n');
  const parts = planText.split(TASK_HEADER_RE);
  const tasks = [];
  const seenIds = new Set();
  // parts = [preamble, id1, title1, body1, id2, title2, body2, ...]
  for (let i = 1; i < parts.length; i += 3) {
    const id = Number(parts[i]);
    if (seenIds.has(id)) {
      // Dos bloques "### Task N:" con el mismo N: el grafo colapsaría ambos en una
      // entrada y una de las tareas nunca se ejecutaría, sin que nadie lo reporte.
      throw new Error(`Duplicate task id ${id} in plan`);
    }
    seenIds.add(id);
    const title = parts[i + 1].trim();
    const body = parts[i + 2];
    tasks.push({
      id,
      title,
      files: parseFiles(body),
      interfaces: parseInterfaces(body),
    });
  }
  return tasks;
}

function extractSection(body, name) {
  // El terminador acepta headers bold de varias palabras (p. ej. **Global Constraints:**),
  // no solo de una — si no, la sección anterior se los tragaba.
  const re = new RegExp(`\\*\\*${name}:\\*\\*\\n([\\s\\S]*?)(?=\\n\\*\\*[A-Z][a-zA-Z]*(?: [A-Za-z][a-zA-Z]*)*:\\*\\*|\\n- \\[ \\]|$)`);
  const match = body.match(re);
  return match ? match[1] : '';
}

function parseFiles(body) {
  const section = extractSection(body, 'Files');
  const files = { create: [], modify: [], test: [] };
  for (const line of section.split('\n')) {
    const m = line.match(/^-\s*(Create|Modify|Test):\s*`([^`]+)`/);
    if (!m) continue;
    const kind = m[1].toLowerCase();
    // Quita solo un sufijo de rango de líneas (":123" o ":123-145") al final; un split
    // por ":" truncaba rutas absolutas de Windows ("C:/app.py" quedaba en "C").
    const filePath = m[2].replace(/:\d+(?:-\d+)?$/, '');
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
  for (const [, span] of line.matchAll(BACKTICK_SPAN_RE)) {
    // Drop parenthesized call-argument lists first (e.g. the "name" in
    // `createWidget(name)`) so parameter names aren't mistaken for separate
    // produced/consumed symbols.
    const withoutArgs = span.replace(/\([^)]*\)/g, '');
    for (const [identifier] of withoutArgs.matchAll(IDENTIFIER_RE)) {
      if (identifier.length > 1) symbols.push(identifier);
    }
  }
  return symbols;
}

function parseInterfaces(body) {
  const section = extractSection(body, 'Interfaces');
  const interfaces = { consumes: [], produces: [] };
  for (const line of section.split('\n')) {
    const consumes = line.match(/^-\s*Consumes:\s*(.*)$/);
    const produces = line.match(/^-\s*Produces:\s*(.*)$/);
    if (consumes && consumes[1].trim()) interfaces.consumes.push(...extractSymbols(consumes[1]));
    if (produces && produces[1].trim()) interfaces.produces.push(...extractSymbols(produces[1]));
  }
  return interfaces;
}
