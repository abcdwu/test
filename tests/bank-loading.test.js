import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createBankLoader } from '../bank-loader.js';
const { bankFixture } = createRequire(import.meta.url)('./bank-fixture.cjs');
const question = { id: 'test', subject: 'torts', stem: 'Test question', choices: ['A','B','C','D'], answer: 'A', explanation: 'Full explanation' };
const fixture = bankFixture([question]);
const origins = ['https://primary.invalid/bank/', 'https://mirror.invalid/bank/'];
const noCache = { get: async () => null, set: async () => {} };
const options = { origins, cache: noCache, mirrorDelay: 2, timeoutMs: 80 };
function response(url) {
  const file = new URL(url).pathname.split('/').pop();
  return file === 'manifest.json' ? Response.json(fixture.manifest) : new Response(fixture.files.get(file));
}

test('an interrupted subject body recovers from the independent mirror with full content', async () => {
  let mirrorFiles = 0;
  const loader = createBankLoader({ ...options, fetcher: async url => {
    if (!url.includes('manifest.json') && url.includes('primary.invalid')) return { ok: true, arrayBuffer: async () => { throw new TypeError('Load failed'); } };
    if (!url.includes('manifest.json') && url.includes('mirror.invalid')) mirrorFiles++;
    return response(url);
  } });
  assert.deepEqual(await loader.bank('torts'), [question]); assert.equal(mirrorFiles, 1);
});

test('a stalled primary does not hold up the mirror, and pending requests are cancelled', async () => {
  let cancelled = 0;
  const loader = createBankLoader({ ...options, fetcher: (url, { signal }) => {
    if (url.includes('primary.invalid')) {
      signal.addEventListener('abort', () => cancelled++);
      return new Promise(() => {});
    }
    return Promise.resolve(response(url));
  } });
  assert.deepEqual(await loader.bank('torts'), [question]); assert.equal(cancelled, 2);
});

test('timeouts and permanent failures remain bounded and produce a retry message', async () => {
  const loader = createBankLoader({ ...options, timeoutMs: 10, fetcher: () => new Promise(() => {}) });
  await assert.rejects(loader.bank('torts'), /暂时无法下载题库/);
});

test('a working primary never waits for an unavailable Fly mirror', async () => {
  const loader = createBankLoader({ ...options, fetcher: url => url.includes('primary.invalid')
    ? Promise.resolve(response(url)) : new Promise(() => {}) });
  assert.deepEqual(await loader.bank('torts'), [question]);
});

test('verified subject cache works when both download sources fail, and damaged cache is replaced', async () => {
  const values = new Map();
  const cache = { get: async key => values.get(key), set: async (key, value) => values.set(key, value) };
  const online = createBankLoader({ ...options, cache, fetcher: async url => response(url) });
  await online.bank('torts');
  const offline = createBankLoader({ ...options, cache, fetcher: async () => { throw new TypeError('Load failed'); } });
  assert.deepEqual(await offline.bank('torts'), [question]);
  values.set(fixture.manifest.subjects.torts.sha256, new TextEncoder().encode('damaged').buffer);
  const recover = createBankLoader({ ...options, cache, fetcher: async url => response(url) });
  assert.deepEqual(await recover.bank('torts'), [question]);
});

test('downloaded bytes must match the catalogue hash; tampered data is never accepted', async () => {
  const loader = createBankLoader({ ...options, fetcher: async url => url.includes('manifest.json') ? response(url) : new Response('tampered') });
  await assert.rejects(loader.bank('torts'), /暂时无法下载题库/);
});
