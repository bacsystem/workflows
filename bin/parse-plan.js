#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parsePlanWithDiagnostics } from '../src/plan-parser.js';
import { buildGraphWithDiagnostics, computeParallelWidth } from '../src/graph-builder.js';

const [, , planPath] = process.argv;
if (!planPath) {
  console.error('Usage: node bin/parse-plan.js <path-to-plan.md>');
  process.exit(1);
}

const planText = readFileSync(planPath, 'utf8');
const { tasks, warnings: parseWarnings } = parsePlanWithDiagnostics(planText);
const { graph, warnings: graphWarnings } = buildGraphWithDiagnostics(tasks);
const warnings = [...parseWarnings, ...graphWarnings];

// Warnings a stderr: stdout es el JSON que se pipea y debe quedar limpio.
for (const warning of warnings) {
  console.error(`WARNING: ${warning}`);
}

console.log(JSON.stringify({ tasks, graph, warnings, parallelWidth: computeParallelWidth(graph) }, null, 2));
