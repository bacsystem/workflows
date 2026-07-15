import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, hhmmssToSeconds } from '../src/time.js';

test('convierte HH:MM:SS a segundos', () => {
  assert.equal(hhmmssToSeconds('01:02:03'), 3723);
});

test('formatea una duración normal', () => {
  assert.equal(formatDuration('10:00:00', '10:03:05'), '3m05s');
});

test('cruza la medianoche sin dar duración negativa', () => {
  assert.equal(formatDuration('23:59:50', '00:00:10'), '0m20s');
});

test('devuelve "duration unknown" si falta algún extremo', () => {
  assert.equal(formatDuration(undefined, '10:00:00'), 'duration unknown');
  assert.equal(formatDuration('10:00:00', ''), 'duration unknown');
});

test('devuelve "duration unknown" ante timestamps malformados en vez de NaNmNaNs', () => {
  assert.equal(formatDuration('garbage', '10:00:00'), 'duration unknown');
  assert.equal(formatDuration('10:00:00', '10:00'), 'duration unknown');
  assert.equal(formatDuration('10:00:00', 'about noon'), 'duration unknown');
});

test('acepta componentes sin cero a la izquierda (salida real de agentes)', () => {
  assert.equal(formatDuration('10:5:30', '10:6:0'), '0m30s');
});

test('rechaza componentes fuera de rango en vez de calcular basura', () => {
  assert.equal(formatDuration('10:75:00', '11:00:00'), 'duration unknown');
  assert.equal(formatDuration('25:00:00', '26:00:00'), 'duration unknown');
  assert.equal(formatDuration('10:00:00', '10:00:99'), 'duration unknown');
});
