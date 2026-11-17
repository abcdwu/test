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
const target = process.env.MBE_PUBLIC_TARGET || 'both';
assert.ok(['primary', 'fly', 'both'].includes(target), 'Invalid verification target');
const origins = {
  primary: 'https://test.chaoxu.me/',
  fly: 'https://abcdwu-mbe-mistakes.fly.dev/',
};
for (const base of (target === 'both' ? Object.values(origins) : [origins[target]])) {
  let failure;
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const page = (await get(base, '')).toString();
      assert.ok(page.includes(entry), 'Latest entry module must be published');
      assert.equal(digest(await get(base, entry)), digest(entryBytes), 'Latest entry contents must be published');
      const highlightEntry = /from '\.\/(highlights\.js\?v=\d+)'/.exec(entryBytes.toString())[1];
      assert.equal(digest(await get(base, highlightEntry)), digest(readFileSync(new URL('../highlights.js', import.meta.url))), 'Highlight controls must be published');
      for (const file of ['progress.js', 'cloud-sync.js', 'browser-store.js', 'mistake-store.js', 'highlight-core.js', 'common.js', 'pdf-source.js', 'public-assets.js', 'source-chunks.js', 'source-viewer.js', 'source.html', 'notebook.html', 'notebook.js', 'study-core.js', 'study-ui.js']) {
        assert.equal(digest(await get(base, file)), digest(readFileSync(new URL('../' + file, import.meta.url))), 'Practice history and sync modules must be published');
      }
      const catalog = JSON.parse((await get(base, 'bank/manifest.json')).toString());
      assert.equal(JSON.stringify(catalog), JSON.stringify(manifest));
      const subject = catalog.subjects.torts;
      const bytes = await get(base, 'bank/' + subject.file);
      assert.equal(digest(bytes), subject.sha256);
      assert.equal(bytes.byteLength, subject.bytes);
      for (const directory of ['dictionary', 'sources/pages']) {
        const local = JSON.parse(readFileSync(new URL('../' + directory + '/manifest.json', import.meta.url)));
        const remote = JSON.parse((await get(base, directory + '/manifest.json')).toString());
        assert.deepEqual(remote, local, 'Published reading asset catalogue must match this release');
        const asset = directory === 'dictionary' ? local : local.subjects.torts.chunks[3];
        const data = await get(base, directory + '/' + asset.file);
        assert.equal(digest(data), asset.sha256); assert.equal(data.byteLength, asset.bytes);
      }
      console.log('PASS public app, 1803-question catalogue, dictionary and verified original-page chunk at ' + new URL(base).hostname);
      failure = null; break;
    } catch (error) {
      failure = error;
      if (attempt < 23) await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  if (failure) throw failure;
}
