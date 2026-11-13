import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../server/api.js';
import { highlightChange, highlightRanges } from '../highlight-core.js';
import { createAttempt } from '../progress.js';

test('cloud highlight additions, clears and legacy clients survive restart with atomic conflict rejection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mbe-highlight-api-'));
  let api, base;
  async function start() {
    api = createApi({ databasePath: join(directory, 'db.sqlite'), loginPassword: 'test-only', allowedOrigins: ['https://test.chaoxu.me'] });
    await new Promise(resolve => api.server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${api.server.address().port}`;
  }
  async function stop() { await new Promise(resolve => api.server.close(resolve)); api.closeDatabase(); }
  const request = (path, body, token) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    await start();
    assert.ok((await (await fetch(base + '/health')).json()).features.includes('highlights'));
    assert.equal((await request('/api/sync', { entries: [], highlights: [] })).status, 401);
    const tokens = [];
    for (let i = 0; i < 2; i++) tokens.push((await (await request('/auth/login', { password: 'test-only' })).json()).token);
    async function sync(highlights, token = tokens[0]) {
      const response = await request('/api/sync', { entries: [], highlights }, token);
      assert.equal(response.status, 200); return response.json();
    }
    const blank = { questionId: 'sample', text: 'Alpha beta gamma delta.', operations: [] };
    const a = highlightChange(blank, 'add', [[0, 5]], 'device-a');
    const b = highlightChange(blank, 'add', [[6, 10]], 'device-b');
    await sync([a]); let result = await sync([b], tokens[1]);
    assert.deepEqual(highlightRanges(result.highlights[0]), [[0, 5], [6, 10]]);
    const revision = result.revision;
    assert.equal((await sync([a])).revision, revision, 'repeating a sync does not create a new revision');
    const conflicting = structuredClone(a); conflicting.operations[0].ranges = [[17, 22]];
    const attempt = createAttempt([{ subject: 'torts', answer: 'A' }], [0], 'must-rollback');
    assert.equal((await request('/api/sync', { entries: [], attempts: [attempt], highlights: [conflicting] }, tokens[0])).status, 400);
    assert.equal((await sync([])).attempts.length, 0, 'a conflicting highlight rolls back the entire request');
    const clear = highlightChange(result.highlights[0], 'remove', [[0, blank.text.length]], 'clear');
    result = await sync([clear]);
    assert.deepEqual(highlightRanges(result.highlights[0]), []);
    assert.deepEqual(highlightRanges((await sync([b], tokens[1])).highlights[0]), []);
    const oldClient = await request('/api/sync', { entries: [] }, tokens[1]);
    assert.deepEqual(highlightRanges((await oldClient.json()).highlights[0]), []);
    await stop(); await start();
    result = await sync([]);
    assert.deepEqual(result.highlights, [clear]);
    const afterClear = highlightChange(clear, 'add', [[17, 22]], 'after-clear');
    assert.deepEqual(highlightRanges((await sync([afterClear])).highlights[0]), [[17, 22]]);
  } finally {
    if (api?.server.listening) await stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
