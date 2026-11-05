import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createApi } from '../server/api.js';
import { MistakeStore } from '../mistake-store.js';
import { createAttempt, summarizeAttempts } from '../progress.js';

const source = readFileSync(new URL('../questions.txt', import.meta.url));
const metadata = JSON.parse(readFileSync(new URL('../question-metadata.json', import.meta.url)));
const question = { ...JSON.parse(gunzipSync(Buffer.from(source.toString(), 'base64')))[0], ...metadata.questions[0] };
const privatePassword = 'x';
const origin = 'https://test.chaoxu.me';

function device() {
  const values = new Map();
  return new MistakeStore({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
}

test('private sync requires login, merges devices exactly once and survives a server restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mbe-api-'));
  let api, base;
  async function start() {
    api = createApi({ databasePath: join(directory, 'mistakes.sqlite'), loginPassword: privatePassword, allowedOrigins: [origin] });
    await new Promise(resolve => api.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${api.server.address().port}`;
  }
  async function stop() { await new Promise(resolve => api.server.close(resolve)); api.closeDatabase(); }
  const request = (path, body, token, requestOrigin = origin, method = 'POST') => fetch(`${base}${path}`, {
    method, headers: { Origin: requestOrigin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === 'DELETE' ? undefined : JSON.stringify(body),
  });
  try {
    await start();
    assert.equal((await request('/api/sync', { entries: [] })).status, 401);
    assert.equal((await request('/auth/login', { password: privatePassword }, undefined, 'https://attacker.example')).status, 403);
    assert.equal((await request('/auth/login', { password: 'incorrect' })).status, 401);
    const login = await request('/auth/login', { password: privatePassword });
    const { token } = await login.json();
    assert.ok(token);
    const first = device(), second = device();
    first.record([question], [null], '2026-11-05T06:00:00Z');
    second.record([question], [null], '2026-11-05T07:00:00Z');
    const sync = async entries => {
      const response = await request('/api/sync', { entries }, token);
      assert.equal(response.status, 200);
      return response.json();
    };
    await sync(first.read());
    let result = await sync(second.read());
    assert.equal(result.entries[0].wrongCount, 2);
    result = await sync(second.read());
    assert.equal(result.entries[0].wrongCount, 2);
    first.merge(result.entries);
    first.record([question], [null], '2026-11-05T08:00:00Z');
    result = await sync(first.read());
    assert.equal(result.entries[0].wrongCount, 3);
    const unchanged = await request('/api/sync', { entries: [], revision: result.revision }, token);
    assert.deepEqual((await unchanged.json()).entries, []);
    await stop();
    await start();
    result = await sync([]);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].wrongCount, 3);
    assert.equal(result.entries[0].lastWrongAt, '2026-11-05T08:00:00Z');
    const invalid = await request('/api/sync', { entries: [{}] }, token);
    assert.equal(invalid.status, 400);
    assert.equal((await sync([])).entries[0].wrongCount, 3);
    assert.equal((await request('/auth/session', null, token, origin, 'DELETE')).status, 200);
    assert.equal((await request('/api/sync', { entries: [] }, token)).status, 401);
  } finally {
    if (api?.server.listening) await stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('password guessing is limited and empty password configuration is rejected', async () => {
  assert.throws(() => createApi({ databasePath: ':memory:', loginPassword: '', allowedOrigins: [origin] }));
  assert.throws(() => createApi({ databasePath: ':memory:', loginPassword: privatePassword, allowedOrigins: ['*'] }));
  const api = createApi({ databasePath: ':memory:', loginPassword: privatePassword, allowedOrigins: [origin] });
  await new Promise(resolve => api.server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${api.server.address().port}/auth/login`;
    for (let index = 0; index < 6; index++) {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong-password' }) });
      assert.equal(response.status, index < 5 ? 401 : 429);
    }
  } finally { await new Promise(resolve => api.server.close(resolve)); api.closeDatabase(); }
});

test('cloud sessions merge immutable quiz results once and preserve them across restart and legacy requests', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mbe-progress-api-'));
  let api, base;
  async function start() {
    api = createApi({ databasePath: join(directory, 'db.sqlite'), loginPassword: privatePassword, allowedOrigins: [origin] });
    await new Promise(resolve => api.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${api.server.address().port}`;
  }
  async function stop() { await new Promise(resolve => api.server.close(resolve)); api.closeDatabase(); }
  const request = (path, body, token) => fetch(base + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    await start();
    const tokens = [];
    for (let i = 0; i < 2; i++) tokens.push((await (await request('/auth/login', { password: privatePassword })).json()).token);
    const qs = n => Array(n).fill(question);
    const choices = (n, correct) => Array.from({ length: n }, (_, i) => i < correct ? 'ABCD'.indexOf(question.answer) : null);
    const a = createAttempt(qs(10), choices(10, 8), 'device-one-session', '2026-11-05T09:00:00Z');
    const b = createAttempt(qs(20), choices(20, 10), 'device-two-session', '2026-11-05T10:00:00Z');
    async function sync(attempts, token = tokens[0]) {
      const response = await request('/api/sync', { entries: [], attempts }, token);
      assert.equal(response.status, 200); return response.json();
    }
    await sync([a]); let result = await sync([b], tokens[1]);
    assert.deepEqual(summarizeAttempts(result.attempts), { correct: 18, total: 30, sessions: 2 });
    result = await sync([a, b]); assert.equal(result.attempts.length, 2);
    const unchanged = await request('/api/sync', { entries: [], attempts: [], revision: result.revision }, tokens[0]);
    assert.deepEqual((await unchanged.json()).attempts, []);
    await stop(); await start();
    assert.equal((await sync([])).attempts.length, 2);
    const legacy = await request('/api/sync', { entries: [] }, tokens[1]);
    assert.equal((await legacy.json()).attempts.length, 2);
    const conflict = { ...a, completedAt: '2026-11-05T11:00:00Z' };
    const invalid = await request('/api/sync', { entries: [], attempts: [conflict] }, tokens[0]);
    assert.equal(invalid.status, 400);
    assert.deepEqual(summarizeAttempts((await sync([])).attempts), { correct: 18, total: 30, sessions: 2 });
  } finally { if (api?.server.listening) await stop(); rmSync(directory, { recursive: true, force: true }); }
});
