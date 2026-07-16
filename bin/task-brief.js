#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractTaskBlock } from '../src/plan-parser.js';

const [, , planPath, taskIdRaw, outDir] = process.argv;
if (!planPath || !taskIdRaw || !outDir) {
  console.error('Usage: node bin/task-brief.js <path-to-plan.md> <taskId> <outDir>');
  process.exit(1);
}

const taskId = Number(taskIdRaw);
if (!Number.isInteger(taskId) || taskId < 1) {
  console.error(`taskId must be a positive integer, got "${taskIdRaw}"`);
  process.exit(1);
}

const planText = readFileSync(planPath, 'utf8');
const block = extractTaskBlock(planText, taskId);
if (block === null) {
  console.error(`Task ${taskId} not found in ${planPath}`);
  process.exit(1);
}

// Escribe directo en el outDir final (el .cys/ del repo destino): así el brief queda
// donde el reviewer lo va a leer, sin el paso frágil de "copialo si quedó en otro lado"
// que necesitaba el script de superpowers (piloto, hallazgo F4).
mkdirSync(outDir, { recursive: true });
const briefPath = resolve(outDir, `task-${taskId}-brief.md`);
writeFileSync(briefPath, block);
console.log(briefPath);
