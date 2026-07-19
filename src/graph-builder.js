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
      if (producerId === undefined) {
        // Igual de silencioso que un typo hasta ahora: la tarea sigue sin esa dependencia
        // y nadie se entera. No es error — un símbolo ya presente en el repo antes del
        // plan es un consumo legítimo sin productor — pero merece el mismo aviso que ya
        // existe para un productor duplicado o un valor vacío.
        warnings.push(
          `Task ${task.id} consumes \`${symbol}\` but no task produces it — ` +
          `likely a typo or a missing producer task; no dependency was created`
        );
        continue;
      }
      if (producerId !== task.id) {
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

  for (const startId of Object.keys(graph).map(Number)) {
    if (state.get(startId) === DONE) continue;

    // Pila explícita en vez de recursión: cada frame lleva el id y un cursor sobre sus
    // dependencias, para poder "volver" a la mitad de un nodo sin usar la pila de
    // llamadas de JS — una cadena de miles de tareas encadenadas no debe reventarla.
    const stack = [{ id: startId, depIndex: 0, chain: [] }];
    state.set(startId, VISITING);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const deps = graph[frame.id] ?? [];

      if (frame.depIndex >= deps.length) {
        state.set(frame.id, DONE);
        stack.pop();
        continue;
      }

      const dep = deps[frame.depIndex];
      frame.depIndex++;

      const depState = state.get(dep) ?? UNVISITED;
      if (depState === DONE) continue;
      if (depState === VISITING) {
        throw new Error(`Cycle detected in plan dependency graph: ${[...frame.chain, frame.id, dep].join(' -> ')}`);
      }

      state.set(dep, VISITING);
      stack.push({ id: dep, depIndex: 0, chain: [...frame.chain, frame.id] });
    }
  }
}

export function computeParallelWidth(graph) {
  const layer = new Map();
  function layerOf(id) {
    if (layer.has(id)) return layer.get(id);
    const deps = graph[id] ?? [];
    const value = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(layerOf));
    layer.set(id, value);
    return value;
  }
  const counts = new Map();
  for (const id of Object.keys(graph).map(Number)) {
    const l = layerOf(id);
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}
