import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRanges, removeRange, segmentHitsRect } from '../highlight-core.js';

test('highlight intervals merge overlap and adjacency without changing other selections', () => {
  assert.deepEqual(mergeRanges([[18, 25], [2, 7], [6, 10], [10, 13]], 30), [[2, 13], [18, 25]]);
  assert.deepEqual(removeRange([[2, 13], [18, 25]], [6, 20]), [[2, 6], [20, 25]]);
  assert.deepEqual(removeRange([[2, 13]], [5, 9]), [[2, 5], [9, 13]]);
  assert.deepEqual(removeRange([[2, 13]], [0, 30]), []);
});

test('invalid or out-of-bounds saved intervals cannot mark the wrong text', () => {
  assert.deepEqual(mergeRanges([null, [3], [-1, 2], [1.5, 3], [2, 99], [8, 2], [4, 7]], 10), [[4, 7]]);
});

test('fast pen segments hit actual glyph rows without marking text across untouched line gaps', () => {
  const glyph = { left: 20, right: 30, top: 10, bottom: 25 };
  assert.equal(segmentHitsRect({ x: 0, y: 18 }, { x: 80, y: 18 }, glyph), true);
  assert.equal(segmentHitsRect({ x: 80, y: 18 }, { x: 0, y: 18 }, glyph), true);
  assert.equal(segmentHitsRect({ x: 25, y: 18 }, { x: 25, y: 18 }, glyph), true);
  assert.equal(segmentHitsRect({ x: 0, y: 35 }, { x: 80, y: 35 }, glyph), false);
  assert.equal(segmentHitsRect({ x: 40, y: 0 }, { x: 40, y: 40 }, glyph), false);
});
