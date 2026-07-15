// Dos tareas con el mismo id colapsarían en una sola entrada del grafo (y de tasksById
// en el workflow) y una de ellas nunca se ejecutaría, sin que nadie lo reporte. Vive acá
// porque este módulo es dueño del Map que colapsa; el parser y validateWorkflowArgs lo
// reutilizan como guard de sus propios puntos de entrada.
export function assertUniqueTaskIds(tasks) {
  const seen = new Set();
  for (const task of tasks) {
    if (seen.has(task.id)) {
      throw new Error(`Duplicate task id ${task.id}`);
    }
    seen.add(task.id);
  }
}

export function buildGraphWithDiagnostics(tasks) {
  assertUniqueTaskIds(tasks);
  const warnings = [];
  const producersOf = new Map(); // symbol -> [taskIds en orden de aparición]
  for (const task of tasks) {
    for (const symbol of task.interfaces.produces) {
      if (!producersOf.has(symbol)) producersOf.set(symbol, []);
      const producers = producersOf.get(symbol);
      if (!producers.includes(task.id)) producers.push(task.id);
    }
  }

  const producedBy = new Map(); // symbol -> taskId (el primer productor gana)
  for (const [symbol, producers] of producersOf) {
    producedBy.set(symbol, producers[0]);
    if (producers.length > 1) {
      // Ambigüedad real del plan (dos tareas dicen crear lo mismo): es warning, no
      // error — no impide ejecutar, pero el usuario debe enterarse en vez de que se
      // resuelva en silencio por orden de aparición.
      warnings.push(
        `Symbol ${symbol} is declared as produced by tasks ${producers.join(', ')} — ` +
        `first producer wins (task ${producers[0]})`
      );
    }
  }

  const deps = new Map(tasks.map((t) => [t.id, new Set()]));
  const fileOwner = new Map(); // filePath -> ÚLTIMO taskId que lo tocó (encadena la serialización)

  for (const task of tasks) {
    for (const symbol of task.interfaces.consumes) {
      const producerId = producedBy.get(symbol);
      if (producerId !== undefined && producerId !== task.id) {
        deps.get(task.id).add(producerId);
      }
    }

    const touchedFiles = [...task.files.create, ...task.files.modify, ...task.files.test];
    for (const file of touchedFiles) {
      const previousOwner = fileOwner.get(file);
      if (previousOwner !== undefined && previousOwner !== task.id) {
        deps.get(task.id).add(previousOwner);
      }
      fileOwner.set(file, task.id); // el último que lo toca pasa a ser el dueño
    }
  }

  const graph = {};
  for (const [taskId, depSet] of deps) {
    graph[taskId] = [...depSet].sort((a, b) => a - b);
  }

  assertAcyclic(graph);
  return { graph, warnings };
}

export function buildGraph(tasks) {
  return buildGraphWithDiagnostics(tasks).graph;
}

export function assertAcyclic(graph) {
  const UNVISITED = 0;
  const VISITING = 1;
  const DONE = 2;
  const state = new Map();

  function visit(id, chain) {
    const current = state.get(id) ?? UNVISITED;
    if (current === DONE) return;
    if (current === VISITING) {
      throw new Error(`Cycle detected in plan dependency graph: ${[...chain, id].join(' -> ')}`);
    }
    state.set(id, VISITING);
    for (const dep of graph[id] ?? []) {
      visit(dep, [...chain, id]);
    }
    state.set(id, DONE);
  }

  for (const id of Object.keys(graph).map(Number)) {
    visit(id, []);
  }
}
