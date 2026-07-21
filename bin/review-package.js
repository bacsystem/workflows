#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const [, , repoPath, baseSha, headSha, outDir] = process.argv;
if (!repoPath || !baseSha || !headSha || !outDir) {
  console.error('Usage: node bin/review-package.js <repoPath> <baseSha> <headSha> <outDir>');
  process.exit(1);
}

// execFile (sin shell) con -C: los SHAs y rutas llegan de otros agentes — nada se
// interpola en una línea de shell.
function git(...args) {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
}

let commits, stat, diff;
try {
  commits = git('log', '--oneline', `${baseSha}..${headSha}`);
  stat = git('diff', '--stat', `${baseSha}..${headSha}`);
  diff = git('diff', `${baseSha}..${headSha}`);
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const pkgPath = resolve(outDir, `review-${baseSha.slice(0, 7)}..${headSha.slice(0, 7)}.diff`);
writeFileSync(
  pkgPath,
  [
    `# Review package: ${baseSha} -> ${headSha}`,
    '',
    '## Commits',
    '',
    commits.trimEnd(),
    '',
    '## Stat',
    '',
    stat.trimEnd(),
    '',
    '## Diff',
    '',
    diff,
  ].join('\n')
);
console.log(pkgPath);
