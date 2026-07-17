#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parsePlanWithDiagnostics } from '../src/plan-parser.js';
import { buildGraphWithDiagnostics } from '../src/graph-builder.js';

const [, , planPath, stateJsonPath] = process.argv;
if (!planPath || !stateJsonPath) {
  console.error('Usage: node bin/plan-remainder.js <path-to-plan.md> <path-to-state.json>');
  process.exit(1);
}

const planText = readFileSync(planPath, 'utf8');
const { tasks, warnings: parseWarnings } = parsePlanWithDiagnostics(planText);
const { graph, warnings: graphWarnings } = buildGraphWithDiagnostics(tasks);

const state = JSON.parse(readFileSync(stateJsonPath, 'utf8'));
if (state.planPath !== planPath) {
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

const warnings = [...parseWarnings, ...graphWarnings];
// Warnings a stderr: stdout es el JSON que se pipea y debe quedar limpio.
for (const warning of warnings) {
  console.error(`WARNING: ${warning}`);
}
console.log(JSON.stringify({ tasks: remainingTasks, graph: remainingGraph, warnings }, null, 2));
