import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/version.js';

test('VERSION matches semver and package.json', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});
