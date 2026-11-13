import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedHighlight, highlightChange, highlightRanges, mergeHighlights, validateHighlights } from '../highlight-core.js';
import { MistakeStore, STORAGE_KEY, backupText } from '../mistake-store.js';
const base = { questionId: 'sample', text: 'Alpha beta gamma delta.', operations: [] };
const ranges = record => highlightRanges(record);

test('offline devices merge independent highlight additions and repeated syncs without losing marks', () => {
  const a = highlightChange(base, 'add', [[0, 5]], 'device-a');
  const b = highlightChange(base, 'add', [[6, 10]], 'device-b');
  const merged = mergeHighlights([a], [b]);
  assert.deepEqual(merged, mergeHighlights([b], [a]));
  assert.deepEqual(ranges(merged[0]), [[0, 5], [6, 10]]);
  assert.deepEqual(mergeHighlights(merged, [a, { ...b, text: 'Different stem.' }]).length, 2);
  assert.deepEqual(mergeHighlights(merged, [a]), merged);
});

test('erase and clear operations survive stale devices and repeated old-cache migration without resurrecting marks', () => {
  const legacy = cachedHighlight(base.questionId, { text: base.text, ranges: [[0, 16]] });
  const partial = highlightChange(legacy, 'remove', [[6, 10]], 'erase');
  assert.deepEqual(ranges(mergeHighlights([partial], [legacy])[0]), [[0, 6], [10, 16]]);
  const cleared = highlightChange(partial, 'remove', [[0, base.text.length]], 'clear');
  const stale = cachedHighlight(base.questionId, { text: base.text, ranges: [[0, 5], [17, 22]] });
  assert.deepEqual(ranges(mergeHighlights([cleared], [stale])[0]), []);
  const later = highlightChange(cleared, 'add', [[17, 22]], 'new-after-clear');
  assert.deepEqual(ranges(mergeHighlights([later], [legacy])[0]), [[17, 22]]);
});

test('an offline clear does not discard a concurrent new addition, even on the same words', () => {
  const first = highlightChange(base, 'add', [[0, 5]], 'original');
  const clear = highlightChange(first, 'remove', [[0, base.text.length]], 'clear-visible');
  const concurrent = highlightChange(first, 'add', [[0, 10]], 'new-offline');
  const merged = mergeHighlights([clear], [concurrent]);
  assert.deepEqual(highlightRanges(merged[0]), [[0, 10]]);
  assert.deepEqual(merged, mergeHighlights([concurrent], [clear]));
});

test('highlights survive backup, restore and unrelated quiz writes; invalid conflicts leave the old data intact', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const store = new MistakeStore(storage), marked = highlightChange(base, 'add', [[0, 5]], 'saved');
  store.mergeHighlights([marked]); store.merge([]); store.mergeAttempts([]);
  store.restore(backupText([], [], [marked])); store.restore(backupText([], [], [marked]));
  assert.deepEqual(store.readHighlights(), [marked]);
  const old = values.get(STORAGE_KEY);
  const conflict = structuredClone(marked); conflict.operations[0].ranges = [[6, 10]];
  assert.throws(() => store.mergeHighlights([conflict])); assert.equal(values.get(STORAGE_KEY), old);
  const wrongText = highlightChange({ ...base, text: 'Changed content.', operations: [] }, 'add', [[0, 3]], 'changed');
  store.mergeHighlights([wrongText]); assert.equal(store.readHighlights().length, 2);
  const restored = new MistakeStore({ getItem: () => values.get(STORAGE_KEY), setItem: () => { throw new Error('Full'); } });
  const beforeFailure = values.get(STORAGE_KEY);
  assert.throws(() => restored.mergeHighlights([highlightChange(marked, 'remove', [[0, 5]], 'failed')]));
  assert.equal(values.get(STORAGE_KEY), beforeFailure);
});

test('malformed highlight operations are rejected, including ambiguous legacy edits and out-of-bounds ranges', () => {
  const good = highlightChange(base, 'add', [[0, 5]], 'good');
  for (const mutate of [
    record => { record.operations[0].clock = 0; }, record => { record.operations[0].action = 'erase-all'; },
    record => { record.operations[0].ranges = [[-1, 3]]; }, record => { record.operations[0].ranges = [[0, 999]]; },
    record => { record.operations.push(record.operations[0]); },
  ]) { const bad = structuredClone(good); mutate(bad); assert.throws(() => validateHighlights([bad])); }
});
