const TASK_HEADER_RE = /^### Task (\d+): (.+)$/m;

export function parsePlan(planText) {
  planText = planText.replace(/\r\n/g, '\n');
  const parts = planText.split(TASK_HEADER_RE);
  const tasks = [];
  // parts = [preamble, id1, title1, body1, id2, title2, body2, ...]
  for (let i = 1; i < parts.length; i += 3) {
    const id = Number(parts[i]);
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
  const re = new RegExp(`\\*\\*${name}:\\*\\*\\n([\\s\\S]*?)(?=\\n\\*\\*[A-Z][a-zA-Z]*:\\*\\*|\\n- \\[ \\]|$)`);
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
    const filePath = m[2].split(':')[0]; // strip trailing ":123-145" line ranges
    files[kind].push(filePath);
  }
  return files;
}

// Heuristic: pulls bare identifiers (dotted names) out of the Consumes/Produces prose;
// parenthesized call-argument lists are already stripped by extractSymbols before this
// regex runs (see below), so it never has parens to match. Known limitation: a value
// that wraps onto a second line is not captured (Consumes/Produces are matched
// line-by-line, see below) — a missed dependency here does not silently misorder tasks:
// the affected task fails loudly (or reports BLOCKED) and its transitive dependents are
// skipped, all surfaced in the final report.
const IDENTIFIER_RE = /`?([A-Za-z_][A-Za-z0-9_.]*)\(?/g;

function extractSymbols(line) {
  // Drop parenthesized call-argument lists first (e.g. the "name" in
  // `createWidget(name)`) so parameter names aren't mistaken for separate
  // produced/consumed symbols.
  const withoutArgs = line.replace(/\([^)]*\)/g, '');
  const symbols = [];
  let m;
  IDENTIFIER_RE.lastIndex = 0;
  while ((m = IDENTIFIER_RE.exec(withoutArgs))) {
    if (m[1].length > 1) symbols.push(m[1]);
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
