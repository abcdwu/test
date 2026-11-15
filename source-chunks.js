import { publicAssets } from './public-assets.js?v=1';
let manifest;

// The location lookup is intentionally metadata-only: a native PDF fallback
// must remain available even when PDF.js cannot render or the chunk download fails.
export async function sourceChunkLocation(path, page) {
  const match = /^sources\/([a-z-]+)\.pdf$/.exec(path);
  if (!match || !Number.isInteger(page) || page < 1) throw new Error('原页参数不正确');
  if (!manifest) manifest = publicAssets.json('sources/pages/manifest.json').catch(error => { manifest = null; throw error; });
  const all = await manifest, info = all.subjects?.[match[1]];
  if (all.version !== 1 || !info || page > info.pages) throw new Error('原页目录不完整');
  const chunk = info.chunks.find(item => item.first <= page && item.last >= page);
  if (!chunk || !/^[a-z-]+\.\d+-\d+\.[a-f0-9]{16}\.pdf$/.test(chunk.file)
    || !/^[a-f0-9]{64}$/.test(chunk.sha256) || !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 1) throw new Error('原页目录格式不正确');
  return { path: 'sources/pages/' + chunk.file, key: chunk.sha256, sha256: chunk.sha256,
    bytes: chunk.bytes, first: chunk.first, last: chunk.last, pageNumber: page - chunk.first + 1 };
}

export async function sourceChunk(path, page) {
  const info = await sourceChunkLocation(path, page);
  const data = await publicAssets.bytes(info.path, info);
  return { data, key: info.key, pageNumber: info.pageNumber };
}
