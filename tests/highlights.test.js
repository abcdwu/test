import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRanges, removeRange } from '../highlights.js';

test('highlight intervals merge overlap and adjacency without changing other selections', () => {
  assert.deepEqual(mergeRanges([[18, 25], [2, 7], [6, 10], [10, 13]], 30), [[2, 13], [18, 25]]);
  assert.deepEqual(removeRange([[2, 13], [18, 25]], [6, 20]), [[2, 6], [20, 25]]);
  assert.deepEqual(removeRange([[2, 13]], [5, 9]), [[2, 5], [9, 13]]);
  assert.deepEqual(removeRange([[2, 13]], [0, 30]), []);
});

test('invalid or out-of-bounds saved intervals cannot mark the wrong text', () => {
  assert.deepEqual(mergeRanges([null, [3], [-1, 2], [1.5, 3], [2, 99], [8, 2], [4, 7]], 10), [[4, 7]]);
});
