import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const read = path => readFileSync(new URL('../' + path, import.meta.url));
const bank = JSON.parse(gunzipSync(Buffer.from(read('questions.txt').toString(), 'base64')));
const manifest = JSON.parse(read('bank/manifest.json'));

test('every subject download preserves all audited user-visible content and stable identities', () => {
  assert.equal(manifest.sourceSha256, createHash('sha256').update(read('questions.txt')).digest('hex'));
  assert.equal(manifest.total, bank.length);
  const ids = new Set();
  for (const [subject, info] of Object.entries(manifest.subjects)) {
    const bytes = read('bank/' + info.file);
    assert.equal(bytes.byteLength, info.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), info.sha256);
    const actual = JSON.parse(gunzipSync(bytes));
    const expected = bank.filter(q => q.subject === subject).map(({ answerEvidence, ...question }) => question);
    assert.deepEqual(actual, expected);
    assert.equal(actual.length, info.count);
    for (const question of actual) { assert.ok(!ids.has(question.id)); ids.add(question.id); }
  }
  assert.equal(ids.size, 1803);
  assert.ok(statSync(new URL('../bank/manifest.json', import.meta.url)).size < 4096, 'homepage catalogue must stay small');
  assert.ok(Object.values(manifest.subjects).every(info => info.bytes < 350000), 'subject download size budget');
});
