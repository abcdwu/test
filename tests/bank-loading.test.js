import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { loadBank } from '../common.js';

const question = { stem: 'Test question', choices: ['A', 'B', 'C', 'D'], answer: 'A', explanation: 'Test explanation' };
const source = gzipSync(JSON.stringify([question])).toString('base64');
const metadata = { bankSha256: createHash('sha256').update(source).digest('hex'), questions: [{ id: 'test', subject: 'torts' }] };
const response = path => path.startsWith('questions.txt') ? new Response(source) : Response.json(metadata);
async function withFetch(mock, run) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await run(); } finally { globalThis.fetch = original; }
}

test('bank loads after a transient Safari-style fetch failure and a truncated response body', async () => {
  const calls = new Map();
  await withFetch(async path => {
    const attempt = (calls.get(path) ?? 0) + 1; calls.set(path, attempt);
    if (path.startsWith('questions.txt') && attempt === 1) throw new TypeError('Load failed');
    if (path.startsWith('questions.txt') && attempt === 2) return { ok: true, text: async () => { throw new TypeError('Load failed'); } };
    return response(path);
  }, async () => {
    const bank = await loadBank(); assert.equal(bank.length, 1); assert.equal(bank[0].id, 'test');
    assert.equal(calls.get('questions.txt?v=3'), 3);
  });
});

test('persistent network failure stops after three attempts with a useful message', async () => {
  let failures = 0;
  await withFetch(async path => {
    if (path.startsWith('questions.txt')) { failures++; throw new TypeError('Load failed'); }
    return response(path);
  }, async () => {
    await assert.rejects(loadBank(), /题库文件未能下载完成/); assert.equal(failures, 3);
  });
});

test('mixed cached bank versions are re-fetched, and consistently tampered data is never accepted', async () => {
  let metadataCalls = 0;
  await withFetch(async path => {
    if (path.startsWith('question-metadata')) {
      metadataCalls++; return Response.json(metadataCalls === 1 ? { ...metadata, bankSha256: 'stale' } : metadata);
    }
    return response(path);
  }, async () => { assert.equal((await loadBank()).length, 1); assert.equal(metadataCalls, 2); });
  await withFetch(async path => path.startsWith('questions.txt') ? new Response(source) : Response.json({ ...metadata, bankSha256: 'tampered' }),
    async () => { await assert.rejects(loadBank(), /版本不一致/); });
});
