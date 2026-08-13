'use strict';

const assert = require('assert');
const { evaluate5, evaluateBest, compareRanks, categoryName } = require('../src/handEvaluator');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  -', name);
}

function beats(handA, handB) {
  return compareRanks(evaluate5(handA), evaluate5(handB)) > 0;
}

test('category ordering is correct end to end: each category beats the one below it', () => {
  const straightFlush = ['9h', '8h', '7h', '6h', '5h'];
  const quads = ['Ah', 'Ad', 'Ac', 'As', '2h'];
  const fullHouse = ['Kh', 'Kd', 'Kc', '2s', '2h'];
  const flush = ['Ah', 'Jh', '8h', '5h', '2h'];
  const straight = ['9h', '8d', '7c', '6s', '5h'];
  const trips = ['7h', '7d', '7c', 'Ks', '2h'];
  const twoPair = ['Jh', 'Jd', '4c', '4s', '2h'];
  const onePair = ['Th', 'Td', '9c', '5s', '2h'];
  const highCard = ['Ah', 'Jd', '8c', '5s', '2h'];

  const order = [straightFlush, quads, fullHouse, flush, straight, trips, twoPair, onePair, highCard];
  for (let i = 0; i < order.length - 1; i++) {
    assert.ok(beats(order[i], order[i + 1]), `${categoryName(evaluate5(order[i]))} should beat ${categoryName(evaluate5(order[i + 1]))}`);
  }
});

test('the wheel (A-2-3-4-5) is the lowest straight, not the highest', () => {
  const wheel = ['Ah', '2d', '3c', '4s', '5h'];
  const sixHigh = ['6h', '5d', '4c', '3s', '2h'];
  assert.strictEqual(categoryName(evaluate5(wheel)), 'Straight');
  assert.ok(beats(sixHigh, wheel), 'a 6-high straight should beat the wheel (A-high would be wrong)');
});

test('kicker comparisons within the same category', () => {
  const acesKingKicker = ['Ah', 'Ad', 'Kc', '5s', '2h'];
  const acesQueenKicker = ['Ac', 'As', 'Qc', '5s', '2h'];
  assert.ok(beats(acesKingKicker, acesQueenKicker), 'same pair, better kicker should win');

  const twoPairAcesKings = ['Ah', 'Ad', 'Kc', 'Ks', '2h'];
  const twoPairAcesQueens = ['Ac', 'As', 'Qc', 'Qs', '2h'];
  assert.ok(beats(twoPairAcesKings, twoPairAcesQueens), 'aces-and-kings two pair beats aces-and-queens two pair');
});

test('a tie is a tie: identical rank hands compare equal', () => {
  const a = ['Ah', 'Kd', 'Qc', 'Js', '9h'];
  const b = ['As', 'Kc', 'Qh', 'Jd', '9c'];
  assert.strictEqual(compareRanks(evaluate5(a), evaluate5(b)), 0);
});

test('evaluateBest picks the true best 5-card hand out of 7', () => {
  // Hero has trip aces available across the 7 cards, not just whatever the
  // first 5 happen to be.
  const sevenCards = ['Ah', 'Ad', 'Ac', '7s', '4h', '3d', '2c'];
  const best = evaluateBest(sevenCards);
  assert.strictEqual(categoryName(best), 'Three of a Kind');
});

test('evaluateBest: a made flush beats a made straight when both are possible from 7 cards', () => {
  const sevenCards = ['Ah', 'Kh', '9h', '8h', '5h', '7d', '6c']; // flush in hearts, and a 9-8-7-6-5 straight is also there
  const best = evaluateBest(sevenCards);
  assert.strictEqual(categoryName(best), 'Flush', 'should pick the flush over the straight, since flush outranks straight');
});

console.log(`\n${passed} test(s) passed.`);
