import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { mergeEntry, validateEntries } from '../mistake-store.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export function createApi({ databasePath, loginPassword, allowedOrigins, trustFlyProxy = false }) {
  if (typeof loginPassword !== 'string' || loginPassword.length < 1) {
    throw new Error('Set LOGIN_PASSWORD to a private password of at least 1 character');
  }
  if (!allowedOrigins.length || allowedOrigins.includes('*')) throw new Error('Set explicit ALLOWED_ORIGINS');
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS mistakes (id TEXT PRIMARY KEY, entry TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO sync_state VALUES (1, 0);`);
  const passwordSalt = randomBytes(32);
  const passwordHash = scryptSync(loginPassword, passwordSalt, 64);
  const failures = new Map();
  const readEntries = () => db.prepare('SELECT entry FROM mistakes ORDER BY id').all().map(row => JSON.parse(row.entry));
  const saveEntry = db.prepare('INSERT INTO mistakes(id, entry) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET entry=excluded.entry');

  function respond(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(body));
  }

  async function readJson(request, maxBytes = MAX_BODY_BYTES) {
    if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('Expected JSON');
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('Request too large');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) { respond(response, 403, { error: 'Origin not allowed' }); return; }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.setHeader('Access-Control-Max-Age', '600');
    }
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    const path = request.url?.split('?')[0];
    if (path === '/health' && request.method === 'GET') { respond(response, 200, { ok: true }); return; }
    try {
      if (path === '/auth/login' && request.method === 'POST') {
        const address = trustFlyProxy ? request.headers['fly-client-ip'] || request.socket.remoteAddress : request.socket.remoteAddress;
        const now = Date.now();
        // Bound rate-limit memory, and remove expired buckets before using them.
        for (const [key, value] of failures) if (value.until <= now) failures.delete(key);
        const key = hash(String(address));
        const bucket = failures.get(key) ?? { count: 0, until: now + 15 * 60 * 1000 };
        if (bucket.count >= 5 || failures.size >= 10_000) {
          respond(response, 429, { error: 'Too many attempts. Try again in 15 minutes.' }); return;
        }
        const body = await readJson(request, 4096);
        if (typeof body.password !== 'string' || body.password.length > 512) {
          respond(response, 400, { error: 'Invalid password format' }); return;
        }
        const candidate = scryptSync(body.password, passwordSalt, 64);
        if (!timingSafeEqual(candidate, passwordHash)) {
          failures.set(key, { ...bucket, count: bucket.count + 1 });
          respond(response, 401, { error: 'Incorrect password' }); return;
        }
        failures.delete(key);
        db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
        const token = randomBytes(32).toString('base64url');
        const expiresAt = now + SESSION_MS;
        db.prepare('INSERT INTO sessions(token_hash, expires_at) VALUES (?, ?)').run(hash(token), expiresAt);
        respond(response, 200, { token, expiresAt }); return;
      }

      const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      const session = token && db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(hash(token));
      if (!session || session.expires_at <= Date.now()) { respond(response, 401, { error: 'Please sign in' }); return; }

      if (path === '/auth/session' && request.method === 'DELETE') {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
        respond(response, 200, { ok: true }); return;
      }
      if (path === '/api/sync' && request.method === 'POST') {
        const body = await readJson(request);
        validateEntries(body.entries);
        if (body.entries.length > 10_000) throw new Error('Too many entries');
        db.exec('BEGIN IMMEDIATE');
        let revision;
        try {
          const existing = new Map(readEntries().map(entry => [entry.question.id, entry]));
          let changed = false;
          for (const entry of body.entries) {
            const merged = mergeEntry(existing.get(entry.question.id), entry);
            if (JSON.stringify(merged) !== JSON.stringify(existing.get(entry.question.id))) {
              saveEntry.run(entry.question.id, JSON.stringify(merged)); changed = true;
            }
          }
          if (changed) db.prepare('UPDATE sync_state SET revision=revision+1 WHERE id=1').run();
          revision = db.prepare('SELECT revision FROM sync_state WHERE id=1').get().revision;
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        respond(response, 200, {
          entries: body.revision === revision ? [] : readEntries(),
          revision, syncedAt: new Date().toISOString(),
        }); return;
      }
      respond(response, 404, { error: 'Not found' });
    } catch (error) {
      // Do not log request bodies, passwords, session tokens or private questions.
      console.error('API request failed', error.name);
      respond(response, 400, { error: 'Request could not be processed' });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return { server, closeDatabase: () => db.close() };
}
