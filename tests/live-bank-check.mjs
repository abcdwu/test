// Verify public deployment assets only; no login or private notebook access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(readFileSync(new URL('../bank/manifest.json', import.meta.url)));
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const entry = /src="(practice\.js\?v=\d+)"/.exec(html)[1];
const entryBytes = readFileSync(new URL('../practice.js', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const release = process.env.GITHUB_SHA || Date.now().toString();
async function get(base, path) {
  const url = new URL(path, base);
  url.searchParams.set('check', release + '-' + Date.now());
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'Cache-Control': 'no-cache' } });
  assert.equal(response.status, 200, 'Public deployment asset must be available');
  return Buffer.from(await response.arrayBuffer());
}
for (const base of ['https://test.chaoxu.me/', 'https://abcdwu-mbe-mistakes.fly.dev/']) {
  let failure;
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const page = (await get(base, '')).toString();
      assert.ok(page.includes(entry), 'Latest entry module must be published');
      assert.equal(digest(await get(base, entry)), digest(entryBytes), 'Latest entry contents must be published');
      const catalog = JSON.parse((await get(base, 'bank/manifest.json')).toString());
      assert.equal(JSON.stringify(catalog), JSON.stringify(manifest));
      const subject = catalog.subjects.torts;
      const bytes = await get(base, 'bank/' + subject.file);
      assert.equal(digest(bytes), subject.sha256);
      assert.equal(bytes.byteLength, subject.bytes);
      console.log('PASS public homepage, entry module, 1803-question catalogue and Torts hash at ' + new URL(base).hostname);
      failure = null; break;
    } catch (error) {
      failure = error;
      if (attempt < 23) await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  if (failure) throw failure;
}
