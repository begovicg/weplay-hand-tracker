'use strict';

const assert = require('assert');
const { niceNumber, computeNiceTicks, pickEvenIndices } = require('../src/chartMath');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  -', name);
}

test('niceNumber rounds to 1, 2, 5, or 10 times a power of 10', () => {
  assert.strictEqual(niceNumber(47, true), 50);
  assert.strictEqual(niceNumber(23, true), 20);
  assert.strictEqual(niceNumber(14, true), 10);
  assert.strictEqual(niceNumber(0.047, true), 0.05);
});

test('computeNiceTicks: a real-world small bankroll range ($0 to $47) gives round, readable ticks', () => {
  const ticks = computeNiceTicks(0, 47, 5);
  // Every tick must be evenly spaced and "nice" (not something like 47/4=11.75)
  const step = ticks[1] - ticks[0];
  for (let i = 2; i < ticks.length; i++) {
    assert.ok(Math.abs((ticks[i] - ticks[i - 1]) - step) < 1e-9, 'ticks must be evenly spaced');
  }
  assert.ok(ticks[0] <= 0 && ticks[ticks.length - 1] >= 47, 'ticks must fully cover the data range');
  assert.ok(ticks.includes(0), 'zero should be one of the ticks for a range that starts at/near zero');
});

test('computeNiceTicks: a range spanning negative and positive values still includes zero', () => {
  const ticks = computeNiceTicks(-56.97, 38.59, 5);
  assert.ok(ticks.includes(0), 'a real profit/loss swing must show the zero line');
  assert.ok(ticks[0] <= -56.97);
  assert.ok(ticks[ticks.length - 1] >= 38.59);
});

test('computeNiceTicks: a degenerate range (min === max, e.g. exactly one data point) does not throw or divide by zero', () => {
  const ticks = computeNiceTicks(10, 10, 5);
  assert.ok(ticks.length >= 2);
  assert.ok(ticks[0] <= 10 && ticks[ticks.length - 1] >= 10);
});

test('computeNiceTicks: min/max given in the wrong order is handled gracefully', () => {
  const ticks = computeNiceTicks(50, -10, 5);
  assert.ok(ticks[0] <= -10 && ticks[ticks.length - 1] >= 50);
});

test('computeNiceTicks: a large real bankroll range ($0 to $4,804.25, the real net result from this project\'s test batch) gives sensible ticks', () => {
  const ticks = computeNiceTicks(0, 4804.25, 6);
  const step = ticks[1] - ticks[0];
  // The step itself should be a "nice" round number, not an arbitrary fraction.
  assert.ok([100, 200, 500, 1000, 2000, 5000].includes(step), `expected a round step, got ${step}`);
});

test('pickEvenIndices: always includes the first and last index', () => {
  const idx = pickEvenIndices(100, 6);
  assert.strictEqual(idx[0], 0);
  assert.strictEqual(idx[idx.length - 1], 99);
});

test('pickEvenIndices: returns every index when there are fewer data points than the target tick count', () => {
  const idx = pickEvenIndices(3, 6);
  assert.deepStrictEqual(idx, [0, 1, 2]);
});

test('pickEvenIndices: never returns duplicate indices even with awkward lengths', () => {
  const idx = pickEvenIndices(7, 6);
  assert.strictEqual(new Set(idx).size, idx.length);
});

test('pickEvenIndices: a single data point returns just index 0, not an empty or invalid array', () => {
  const idx = pickEvenIndices(1, 6);
  assert.deepStrictEqual(idx, [0]);
});

test('computeNiceTicks: guarantees at least minCount ticks, retrying with a smaller step if needed', () => {
  // 0-100 with target 7 naturally produces 6 ticks (step=20) — below a
  // minimum of 7 unless the retry logic kicks in.
  const ticks = computeNiceTicks(0, 100, 7, 7);
  assert.ok(ticks.length >= 7, `expected at least 7 ticks, got ${ticks.length}: ${ticks}`);
  // Still evenly spaced and "nice" after the retry, not just padded with
  // arbitrary extra values.
  const step = ticks[1] - ticks[0];
  for (let i = 2; i < ticks.length; i++) {
    assert.ok(Math.abs((ticks[i] - ticks[i - 1]) - step) < 1e-9);
  }
});

test('computeNiceTicks: the minimum-count guarantee holds for the real combined 3-line range from this app\'s own data (-292.33 to 5020.02)', () => {
  const ticks = computeNiceTicks(-292.33, 5020.02, 7, 5);
  assert.ok(ticks.length >= 5);
  assert.ok(ticks.includes(0));
  assert.ok(ticks[0] <= -292.33 && ticks[ticks.length - 1] >= 5020.02);
});

console.log(`\n${passed} test(s) passed.`);
