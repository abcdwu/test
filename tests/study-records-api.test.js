import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApi } from '../server/api.js';
import { studyChange, studyValue } from '../study-core.js';
import { createAttempt } from '../progress.js';
test('notebook cloud sync preserves offline versions, old clients and restarts with atomic conflict rollback', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mbe-study-api-')); let api, base;
  async function start() { api = createApi({ databasePath: join(directory, 'db.sqlite'), loginPassword: 'test', allowedOrigins: ['https://test.chaoxu.me'] }); await new Promise(resolve => api.server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + api.server.address().port; }
  async function stop() { await new Promise(resolve => api.server.close(resolve)); api.closeDatabase(); }
  const request = (path, body, token) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  try {
    await start(); assert.equal((await request('/api/sync', { entries: [], study: [] })).status, 401);
    const a = (await (await request('/auth/login', { password: 'test' })).json()).token, b = (await (await request('/auth/login', { password: 'test' })).json()).token;
    const blank = { questionId: 'sample', subject: 'torts', revisions: [] };
    const first = studyChange(blank, 'note', 'Device A note', 'a'), second = studyChange(blank, 'note', 'Device B note', 'b');
    async function sync(study, token = a) { const response = await request('/api/sync', { entries: [], study }, token); assert.equal(response.status, 200); return response.json(); }
    await sync([first]); let result = await sync([second], b); assert.equal(result.study[0].revisions.length, 2);
    const card = studyChange(result.study[0], 'card', { front: 'Prompt', back: 'Answer' }, 'card'); result = await sync([card]);
    assert.equal((await sync([card])).revision, result.revision);
    const old = await request('/api/sync', { entries: [] }, a); assert.deepEqual((await old.json()).study, [card]);
    const conflict = structuredClone(first); conflict.revisions[0].value = 'conflicting';
    const attempt = createAttempt([{ subject: 'torts', answer: 'A' }], [0], 'rollback-study');
    assert.equal((await request('/api/sync', { entries: [], attempts: [attempt], study: [conflict] }, a)).status, 400);
    const unchanged = await sync([]); assert.deepEqual(unchanged.study, [card]); assert.equal(unchanged.attempts.length, 0);
    await stop(); await start(); const restored = await sync([], b); assert.equal(studyValue(restored.study[0], 'card').back, 'Answer'); assert.equal(restored.study[0].revisions.length, 3);
  } finally { if (api?.server.listening) await stop(); rmSync(directory, { recursive: true, force: true }); }
});
