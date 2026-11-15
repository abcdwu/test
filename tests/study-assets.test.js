import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createPublicAssets } from '../public-assets.js';
import { sourcePageUrl } from '../common.js';
const read = path => readFileSync(new URL('../' + path, import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('small PDF chunks cover every original page exactly once and match their committed hashes', () => {
  const manifest = JSON.parse(read('sources/pages/manifest.json'));
  let pages = 0;
  for (const [subject, info] of Object.entries(manifest.subjects)) {
    assert.equal(hash(read('sources/' + subject + '.pdf')), info.sourceSha256);
    let next = 1;
    for (const chunk of info.chunks) {
      assert.equal(chunk.first, next); assert.ok(chunk.last >= chunk.first); assert.ok(chunk.last - chunk.first < 32);
      const bytes = read('sources/pages/' + chunk.file); assert.equal(bytes.byteLength, chunk.bytes); assert.equal(hash(bytes), chunk.sha256);
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-'); assert.ok(chunk.bytes < 1000000);
      next = chunk.last + 1;
    }
    assert.equal(next - 1, info.pages); pages += info.pages;
  }
  assert.equal(pages, 5357); assert.equal(manifest.verifiedPages, pages);
});

test('offline Chinese dictionary has verified content, legal senses and attribution', () => {
  const info = JSON.parse(read('dictionary/manifest.json')), bytes = read('dictionary/' + info.file);
  assert.equal(bytes.length, info.bytes); assert.equal(hash(bytes), info.sha256);
  const words = JSON.parse(gunzipSync(bytes)); assert.equal(Object.keys(words).length, info.entries);
  assert.match(words.consideration.legal, /对价/); assert.match(words.damages.legal, /赔偿/);
  assert.match(words.landlord.translation, /房东|地主/); assert.match(read('dictionary/LICENSE').toString(), /MIT License/);
});

test('source links open the exact question pages in the dedicated viewer', () => {
  const q = { subject: 'torts', source: { pdfPath: 'sources/torts.pdf', questionPages: [201, 202], explanationPages: [203, 204] } };
  const url = new URL(sourcePageUrl(q, 'question', 202), 'https://test.invalid/');
  assert.equal(url.pathname, '/source.html'); assert.equal(url.searchParams.get('pages'), '201,202'); assert.equal(url.searchParams.get('focus'), '202');
  assert.equal(new URL(sourcePageUrl(q, 'explanation', 203), url).searchParams.get('pages'), '203,204');
});

test('review links use the actual PDF source and show exact question and explanation pages', async () => {
  const { reviewQuestion } = await import('../common.js');
  const question = {
    id: 'cross-file-test', subject: 'criminal-law', stem: 'Question?', choices: ['A', 'B', 'C', 'D'],
    answer: 'A', explanation: 'Explanation',
    source: { pdfPath: 'sources/criminal-procedure.pdf', questionNumber: 1,
      questionPages: [17, 18], explanationPages: [19, 20] },
  };
  const questionUrl = new URL(sourcePageUrl(question), 'https://test.invalid/');
  const explanationUrl = new URL(sourcePageUrl(question, 'explanation'), 'https://test.invalid/');
  assert.equal(questionUrl.searchParams.get('subject'), 'criminal-procedure');
  assert.equal(questionUrl.searchParams.get('pages'), '17,18');
  assert.equal(explanationUrl.searchParams.get('subject'), 'criminal-procedure');
  assert.equal(explanationUrl.searchParams.get('pages'), '19,20');
  const markup = reviewQuestion(question, null);
  assert.match(markup, /查看原题 PDF · 第 17、18 页/);
  assert.match(markup, /查看解析 PDF · 第 19、20 页/);
  assert.match(markup, /source-quick-links/);
});

test('Safari fallback identifies the precise lightweight PDF segment without downloading PDF pages', async () => {
  const { sourceChunkLocation } = await import('../source-chunks.js');
  const savedFetch = globalThis.fetch;
  const file = JSON.parse(read('sources/pages/manifest.json'));
  globalThis.fetch = async url => {
    assert.match(String(url), /sources\/pages\/manifest\.json/);
    return new Response(JSON.stringify(file), { status: 200 });
  };
  try {
    const chunk = await sourceChunkLocation('sources/torts.pdf', 154);
    assert.ok(chunk.first <= 154 && chunk.last >= 154);
    assert.equal(chunk.pageNumber, 154 - chunk.first + 1);
    assert.equal(chunk.path, 'sources/pages/' + chunk.path.split('/').pop());
    assert.equal(chunk.bytes, read(chunk.path).byteLength);
  } finally { globalThis.fetch = savedFetch; }
});

test('public assets reject corrupt cache data and use a working mirror when the primary stalls', async () => {
  const body = new TextEncoder().encode('verified payload'), info = { sha256: hash(body), bytes: body.length };
  let cancelled = 0, mirror = 0;
  const assets = createPublicAssets({ origins: ['https://primary.invalid/', 'https://mirror.invalid/'], delay: 2, timeout: 80,
    cache: { get: async () => new Response('damaged'), set: async () => {} }, fetcher: async (url, { signal }) => {
      if (url.includes('primary')) { signal.addEventListener('abort', () => cancelled++); return new Promise(() => {}); }
      mirror++; return new Response(body);
    } });
  assert.equal(new TextDecoder().decode(await assets.bytes('small.pdf', info)), 'verified payload'); assert.equal(mirror, 1); assert.equal(cancelled, 1);
});
