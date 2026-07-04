#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parsePlan } from '../src/plan-parser.js';
import { buildGraph } from '../src/graph-builder.js';

const [, , planPath] = process.argv;
if (!planPath) {
  console.error('Usage: node bin/parse-plan.js <path-to-plan.md>');
  process.exit(1);
}

const planText = readFileSync(planPath, 'utf8');
const tasks = parsePlan(planText);
const graph = buildGraph(tasks);

console.log(JSON.stringify({ tasks, graph }, null, 2));
