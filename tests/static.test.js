import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createApi } from '../server/api.js';
const root = fileURLToPath(new URL('../', import.meta.url));
test('the backup serves the public app and bank with PDF ranges, but never private server files', async () => {
  const api = createApi({ databasePath: ':memory:', loginPassword: 'test-only', allowedOrigins: ['https://test.chaoxu.me'], staticDirectory: root });
  await new Promise(resolve => api.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + api.server.address().port;
  try {
    const app = await fetch(base + '/'); assert.equal(app.status, 200); assert.match(app.headers.get('content-type'), /text\/html/);
    assert.equal(app.headers.get('cache-control'), 'no-cache');
    const highlights = await fetch(base + '/highlights.js');
    assert.equal(highlights.status, 200); assert.match(await highlights.text(), /mountHighlights/);
    const core = await fetch(base + '/highlight-core.js'); assert.equal(core.status, 200);
    const manifestResponse = await fetch(base + '/bank/manifest.json', { headers: { Origin: 'https://test.chaoxu.me' } });
    assert.equal(manifestResponse.headers.get('access-control-allow-origin'), 'https://test.chaoxu.me');
    const manifest = await manifestResponse.json(); assert.equal(manifest.total, 1803);
    const bytes = await fetch(base + '/bank/' + manifest.subjects.torts.file);
    assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), readFileSync(root + 'bank/' + manifest.subjects.torts.file));
    const pdf = await fetch(base + '/sources/torts.pdf', { headers: { Range: 'bytes=0-31' } });
    assert.equal(pdf.status, 206); assert.match(pdf.headers.get('content-range'), /^bytes 0-31\//);
    assert.equal((await pdf.arrayBuffer()).byteLength, 32);
    assert.equal((await fetch(base + '/sources/torts.pdf', { headers: { Range: 'bytes=999999999999-' } })).status, 416);
    assert.equal((await fetch(base + '/sources/torts.pdf', { headers: { Range: 'bytes=-' } })).status, 416);
    for (const path of ['/server/api.js','/.git/config','/data/mistakes.sqlite','/vendor/pdfjs/%2e%2e/%2e%2e/.git/config']) {
      const response = await fetch(base + path); assert.ok([401,404].includes(response.status));
    }
    const badOrigin = await fetch(base + '/api/sync', { method: 'OPTIONS', headers: { Origin: 'https://untrusted.invalid' } });
    assert.equal(badOrigin.status, 403);
  } finally { await new Promise(resolve => api.server.close(resolve)); api.closeDatabase(); }
});
