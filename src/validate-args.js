import { assertAcyclic, assertUniqueTaskIds } from './graph-builder.js';

// El workflow recibe tasks/graph como JSON pegado a mano por el usuario (ver README);
// un ciclo en ese grafo deja a runDag esperando su propia promesa memoizada para
// siempre — deadlock sin error ni log. Esta validación corre antes de lanzar cualquier
// agente para que el fallo sea inmediato y explicable.
export function validateWorkflowArgs({ tasks, graph, integrationBranch, executorPath, openPr, pr, mergeAuthorization }) {
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
  if (typeof executorPath !== 'string' || executorPath.trim() === '') {
    // Los prompts corren bin/task-brief.js y bin/review-package.js por ruta exacta; sin
    // ella cada agente tendría que escanear el disco buscando scripts (hallazgo F7).
    throw new Error('args.executorPath must be the absolute path of the parallel-plan-executor clone (its bin/ scripts are invoked by exact path)');
  }
  if (openPr !== undefined && typeof openPr !== 'boolean') {
    // Crear un PR es un acto hacia afuera: el consentimiento debe ser explícito e
    // inequívoco, no un string truthy accidental.
    throw new Error('args.openPr must be a boolean when present');
  }
  if (pr !== undefined && (pr === null || typeof pr !== 'object' || Array.isArray(pr))) {
    throw new Error('args.pr must be an object ({ base, assignees, labels, milestone, closes }) when present');
  }
  if (mergeAuthorization !== undefined && typeof mergeAuthorization !== 'string') {
    // Piloto 2026-07-16, hallazgo F8: sin este campo, el agente de merge no tiene forma
    // de saber que el usuario ya autorizó el run — y a veces se autobloquea leyendo la
    // política de "merges requieren autorización humana" de memoria, inconsistentemente
    // entre tareas. Debe ser las palabras textuales del usuario, no un booleano.
    throw new Error('args.mergeAuthorization must be a string (the user\'s own authorization words) when present');
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
