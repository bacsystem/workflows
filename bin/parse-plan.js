#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parsePlan } from '../src/plan-parser.js';
import { buildGraphWithDiagnostics } from '../src/graph-builder.js';

const [, , planPath] = process.argv;
if (!planPath) {
  console.error('Usage: node bin/parse-plan.js <path-to-plan.md>');
  process.exit(1);
}

const planText = readFileSync(planPath, 'utf8');
const tasks = parsePlan(planText);
const { graph, warnings } = buildGraphWithDiagnostics(tasks);

// Warnings a stderr: stdout es el JSON que se pipea y debe quedar limpio.
for (const warning of warnings) {
  console.error(`WARNING: ${warning}`);
}

console.log(JSON.stringify({ tasks, graph, warnings }, null, 2));
