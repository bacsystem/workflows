import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'bin', 'review-package.js');

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function makeRepoWithTwoCommits() {
  const repo = mkdtempSync(path.join(tmpdir(), 'review-package-'));
  execFileSync('git', ['init', repo], { encoding: 'utf8' });
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  writeFileSync(path.join(repo, 'a.txt'), 'first\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-m', 'feat: first');
  const baseSha = git(repo, 'rev-parse', 'HEAD');
  writeFileSync(path.join(repo, 'a.txt'), 'first\nsecond\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-m', 'feat: second');
  const headSha = git(repo, 'rev-parse', 'HEAD');
  return { repo, baseSha, headSha };
}

test('escribe el paquete de review con commits, stat y diff, e imprime su ruta', () => {
  const { repo, baseSha, headSha } = makeRepoWithTwoCommits();
  const outDir = path.join(repo, '.cys');

  const stdout = execFileSync('node', [cli, repo, baseSha, headSha, outDir], { encoding: 'utf8' }).trim();

  const expected = path.resolve(outDir, `review-${baseSha.slice(0, 7)}..${headSha.slice(0, 7)}.diff`);
  assert.equal(stdout, expected);
  assert.ok(existsSync(stdout));
  const content = readFileSync(stdout, 'utf8');
  assert.ok(content.includes('feat: second'), 'la lista de commits del rango debe estar');
  assert.ok(!content.includes('feat: first'), 'el commit base queda fuera del rango base..head');
  assert.ok(content.includes('a.txt'), 'el stat debe nombrar el archivo tocado');
  assert.ok(content.includes('+second'), 'el diff completo debe estar incluido');
});

test('falla ruidosamente con SHAs inválidos o args faltantes', () => {
  const { repo } = makeRepoWithTwoCommits();
  assert.throws(() => execFileSync('node', [cli], { encoding: 'utf8', stdio: 'pipe' }));
  assert.throws(() =>
    execFileSync('node', [cli, repo, 'deadbeef', 'cafebabe', path.join(repo, '.cys')], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
  );
});
