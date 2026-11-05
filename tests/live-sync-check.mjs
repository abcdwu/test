// Read-only production check. Passwords, sessions and question contents never enter logs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const { apiBase } = JSON.parse(readFileSync(new URL('../cloud-config.json', import.meta.url)));
assert.equal(apiBase, 'https://abcdwu-mbe-mistakes.fly.dev');
assert.ok(process.env.LOGIN_PASSWORD, 'Configure LOGIN_PASSWORD in repository secrets');
const origin = 'https://test.chaoxu.me';
const sessions = [];
async function request(path, { token, body, method = 'POST', requestOrigin = origin } = {}) {
  return fetch(apiBase + path, {
    method, headers: { 'Content-Type': 'application/json', Origin: requestOrigin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
}
async function read(token) {
  const response = await request('/api/sync', { token, body: { entries: [] } });
  assert.equal(response.status, 200, 'Authenticated sync must succeed');
  const result = await response.json();
  assert.ok(Array.isArray(result.entries));
  assert.ok(Number.isSafeInteger(result.revision));
  return result;
}
try {
  const health = await request('/health', { method: 'GET' });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  assert.equal((await request('/api/sync', { body: { entries: [] } })).status, 401);
  const preflight = await request('/api/sync', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal((await request('/api/sync', { method: 'OPTIONS', requestOrigin: 'https://untrusted.invalid' })).status, 403);
  for (let index = 0; index < 2; index++) {
    const response = await request('/auth/login', { body: { password: process.env.LOGIN_PASSWORD } });
    assert.equal(response.status, 200, 'Configured private password must work');
    const session = await response.json();
    assert.equal(typeof session.token, 'string');
    sessions.push(session.token);
  }
  assert.ok(sessions[0] !== sessions[1], 'Each device receives an independent session');
  const first = await read(sessions[0]);
  const second = await read(sessions[1]);
  const digest = entries => createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  assert.equal(digest(second.entries), digest(first.entries), 'Both sessions must recover the same cloud notebook');
  assert.equal(second.revision, first.revision);
  console.log('PASS production health, allowed-origin CORS, private login and consistent reads from two independent sessions');
} finally {
  for (const token of sessions) {
    const logout = await request('/auth/session', { token, method: 'DELETE' });
    assert.equal(logout.status, 200);
    assert.equal((await request('/api/sync', { token, body: { entries: [] } })).status, 401);
  }
}
console.log('PASS session revocation; no mistake records were written or changed');
