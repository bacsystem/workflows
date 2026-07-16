import { assertAcyclic, assertUniqueTaskIds } from './graph-builder.js';

// El workflow recibe tasks/graph como JSON pegado a mano por el usuario (ver README);
// un ciclo en ese grafo deja a runDag esperando su propia promesa memoizada para
// siempre — deadlock sin error ni log. Esta validación corre antes de lanzar cualquier
// agente para que el fallo sea inmediato y explicable.
export function validateWorkflowArgs({ tasks, graph, integrationBranch, openPr, pr }) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('args.tasks must be a non-empty array');
  }
  if (!graph || typeof graph !== 'object') {
    throw new Error('args.graph must be an object');
  }
  if (typeof integrationBranch !== 'string' || integrationBranch.trim() === '') {
    // Sin rama explícita, cada agente de merge (y el review final) "adivina" cuál es la
    // rama de integración — en un repo con master y develop pueden elegir distinto y
    // ambos reportar MERGED. Mejor exigirla de entrada.
    throw new Error('args.integrationBranch must name the branch merges target (e.g. "develop")');
  }
  if (openPr !== undefined && typeof openPr !== 'boolean') {
    // Crear un PR es un acto hacia afuera: el consentimiento debe ser explícito e
    // inequívoco, no un string truthy accidental.
    throw new Error('args.openPr must be a boolean when present');
  }
  if (pr !== undefined && (pr === null || typeof pr !== 'object' || Array.isArray(pr))) {
    throw new Error('args.pr must be an object ({ base, assignees, labels, milestone, closes }) when present');
  }

  assertUniqueTaskIds(tasks);
  const taskIds = new Set(tasks.map((t) => t.id));

  for (const key of Object.keys(graph)) {
    const id = Number(key);
    if (!taskIds.has(id)) {
      throw new Error(`Graph references task ${id}, which is not present in tasks`);
    }
    for (const dep of graph[key]) {
      if (!taskIds.has(dep)) {
        throw new Error(`Task ${id} declares dependency ${dep}, which is not present in tasks`);
      }
    }
  }

  for (const id of taskIds) {
    if (graph[id] === undefined) {
      throw new Error(`Task ${id} is missing from the graph`);
    }
  }

  assertAcyclic(graph); // falla ruidosamente antes de que runDag pueda deadlockear
}
