const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveApplicationDate } = require('../content.js');

const referenceDate = new Date(2026, 8, 1, 12, 0, 0);

test('keeps a valid ISO date', () => {
  assert.equal(resolveApplicationDate('2026-08-31', '', referenceDate), '2026-08-31');
});

test('normalizes Chinese and slash-separated full dates', () => {
  assert.equal(resolveApplicationDate('2026年8月31日', '', referenceDate), '2026-08-31');
  assert.equal(resolveApplicationDate('2026/8/31', '', referenceDate), '2026-08-31');
});

test('infers the most recent year for a month-day date', () => {
  assert.equal(resolveApplicationDate('08月31日', '', referenceDate), '2026-08-31');
  assert.equal(
    resolveApplicationDate('12月31日', '', new Date(2026, 0, 2, 12, 0, 0)),
    '2025-12-31'
  );
});

test('rejects impossible dates and uses the heuristic fallback', () => {
  assert.equal(
    resolveApplicationDate('2026年2月30日', '2026-08-30', referenceDate),
    '2026-08-30'
  );
});

test('uses the local reference date when both values are unusable', () => {
  assert.equal(resolveApplicationDate('not-a-date', '', referenceDate), '2026-09-01');
});
