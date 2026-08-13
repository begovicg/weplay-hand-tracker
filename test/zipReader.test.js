'use strict';

const assert = require('assert');
const { createZip } = require('../src/zipWriter');
const { extractTextFiles } = require('../src/zipReader');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  -', name);
}

test('round-trip: files written by createZip are read back identically', () => {
  const original = [
    { name: 'hand1.txt', content: 'Weplay Hand #1: test content\n'.repeat(30) }, // large enough to trigger deflate
    { name: 'hand2.txt', content: 'short' }, // small enough that store may win out
  ];
  const zipBuf = createZip(original);
  const extracted = extractTextFiles(zipBuf);
  assert.strictEqual(extracted.length, 2);
  assert.strictEqual(extracted.find((f) => f.name === 'hand1.txt').content, original[0].content);
  assert.strictEqual(extracted.find((f) => f.name === 'hand2.txt').content, original[1].content);
});

test('nested folders inside the zip are flattened to just the filename', () => {
  const zipBuf = createZip([{ name: 'weplay-hands/2026-08/hand.txt', content: 'Weplay Hand #1: nested\n' }]);
  const extracted = extractTextFiles(zipBuf);
  assert.strictEqual(extracted.length, 1);
  assert.strictEqual(extracted[0].name, 'hand.txt');
});

test('non-.txt entries and known junk files are skipped, not surfaced as hand histories', () => {
  const zipBuf = createZip([
    { name: 'hand.txt', content: 'Weplay Hand #1: real\n' },
    { name: 'readme.pdf', content: 'not a hand history' },
    { name: '__MACOSX/._hand.txt', content: 'mac resource fork junk' },
    { name: '.DS_Store', content: 'mac junk' },
  ]);
  const extracted = extractTextFiles(zipBuf);
  assert.strictEqual(extracted.length, 1);
  assert.strictEqual(extracted[0].name, 'hand.txt');
});

test('an empty zip (no entries) extracts to an empty array, not an error', () => {
  const zipBuf = createZip([]);
  const extracted = extractTextFiles(zipBuf);
  assert.deepStrictEqual(extracted, []);
});

test('a non-zip buffer throws a clear, descriptive error instead of crashing silently', () => {
  const notAZip = Buffer.from('this is definitely not a zip file, just plain text', 'utf-8');
  assert.throws(() => extractTextFiles(notAZip), /doesn't look like a valid \.zip file/);
});

test('a zip containing many files (matching a real large batch) all round-trip correctly', () => {
  const files = [];
  for (let i = 0; i < 50; i++) {
    files.push({ name: `HH2026080${i % 10} Table ${i}.txt`, content: `Weplay Hand #${1000 + i}: content for hand ${i}\n`.repeat(5) });
  }
  const zipBuf = createZip(files);
  const extracted = extractTextFiles(zipBuf);
  assert.strictEqual(extracted.length, 50);
  for (const f of files) {
    const match = extracted.find((e) => e.name === f.name);
    assert.ok(match, `expected to find ${f.name} in extracted results`);
    assert.strictEqual(match.content, f.content);
  }
});

console.log(`\n${passed} test(s) passed.`);
