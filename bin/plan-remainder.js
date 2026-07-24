#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePlanWithDiagnostics } from '../src/plan-parser.js';
import { buildGraphWithDiagnostics, computeParallelWidth } from '../src/graph-builder.js';

const [, , planPath, stateJsonPath] = process.argv;
if (!planPath || !stateJsonPath) {
  console.error('Usage: node bin/plan-remainder.js <path-to-plan.md> <path-to-state.json>');
  process.exit(1);
}

const planText = readFileSync(planPath, 'utf8');
const { tasks, warnings: parseWarnings } = parsePlanWithDiagnostics(planText);
const { graph, warnings: graphWarnings } = buildGraphWithDiagnostics(tasks);

const state = JSON.parse(readFileSync(stateJsonPath, 'utf8'));
// Comparación por ruta resuelta, no por string literal: un comando que compara "a ojo"
// (LLM) puede juzgar dos formas de la misma ruta como equivalentes (relativa vs
// absoluta, "./" adelante, separadores de Windows) y volver a invocar con un token
// distinto al que quedó guardado en state.json. Final review, hallazgo Important #1.
// realpathSync (no solo resolve): en macOS /var es symlink de /private/var, así que
// process.cwd() en el hijo devuelve la forma canonicalizada mientras que el argumento
// de la CLI puede llegar sin canonicalizar — mismo archivo real, string distinto.
// resolve() no resuelve symlinks; realpathSync sí. Reportado por un usuario real
// instalando en Mac.
const resolvedPlanPath = realpathSync(resolve(planPath));
let statePlanMatches;
try {
  statePlanMatches = realpathSync(resolve(state.planPath)) === resolvedPlanPath;
} catch {
  statePlanMatches = false; // state.planPath ya no existe — no es "el mismo plan"
}
if (!statePlanMatches) {
  console.error(`state.json is for a different plan ("${state.planPath}"), not "${planPath}"`);
  process.exit(1);
}

// Solo "done" sale del remanente: una tarea failed/pending todavía necesita
// que el scheduler la vuelva a intentar (o decida de nuevo si corresponde saltearla).
const doneIds = new Set(
  Object.entries(state.tasks ?? {})
    .filter(([, entry]) => entry.status === 'done')
    .map(([id]) => Number(id))
);

const remainingTasks = tasks.filter((t) => !doneIds.has(t.id));
const remainingGraph = {};
for (const task of remainingTasks) {
  remainingGraph[task.id] = (graph[task.id] ?? []).filter((depId) => !doneIds.has(depId));
}

// Un remanente vacío es ambiguo por sí solo: puede ser "no queda nada porque ya se
// mergeó todo, solo falta el cierre" (recuperable) o un plan sin tareas (error). Como
// tasks.length siempre es > 0 acá (parsePlanWithDiagnostics ya lo garantiza), un
// remainingTasks vacío solo puede significar la primera opción — se lo marcamos
// explícito al llamador en vez de dejarlo inferir de una lista vacía. Final review,
// hallazgo Important #2.
const allDone = remainingTasks.length === 0;

const warnings = [...parseWarnings, ...graphWarnings];
// Warnings a stderr: stdout es el JSON que se pipea y debe quedar limpio.
for (const warning of warnings) {
  console.error(`WARNING: ${warning}`);
}
console.log(JSON.stringify(
  { tasks: remainingTasks, graph: remainingGraph, warnings, allDone, parallelWidth: computeParallelWidth(remainingGraph) },
  null,
  2
));
