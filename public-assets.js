// Verified, bounded downloads shared by the dictionary and small PDF chunks.
const MIRROR = 'https://abcdwu-mbe-mistakes.fly.dev/';
const browserCache = {
  async get(path) { try { return await (await caches.open('mbe-public-assets-v1')).match(new URL(path, document.baseURI)); } catch { return null; } },
  async set(path, bytes) {
    try {
      const cache = await caches.open('mbe-public-assets-v1');
      await cache.put(new URL(path, document.baseURI), new Response(bytes));
      const pdfs = (await cache.keys()).filter(key => /\/sources\/pages\/.+\.pdf$/.test(key.url));
      for (const key of pdfs.slice(0, Math.max(0, pdfs.length - 32))) await cache.delete(key);
    } catch { /* Public caching must never block reading or private data storage. */ }
  },
};

export function createPublicAssets({ fetcher = (...args) => fetch(...args), cache = browserCache,
  origins = [globalThis.location?.href || 'http://localhost/', MIRROR], delay = 600, timeout = 12000 } = {}) {
  const sources = [...new Set(origins.map(value => new URL('.', value).href))], pending = new Map();
  async function verify(bytes, info) {
    if (!info) return bytes;
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
    if (hash !== info.sha256 || bytes.byteLength !== info.bytes) throw new Error('文件完整性校验失败');
    return bytes;
  }
  async function download(path, info) {
    const controllers = sources.map(() => new AbortController()); let finished = false;
    try {
      return await Promise.any(sources.map(async (base, index) => {
        if (index) await new Promise(resolve => setTimeout(resolve, delay));
        if (finished) throw new Error('Already loaded');
        let timer;
        try {
          const bytes = await Promise.race([
            (async () => {
              const response = await fetcher(new URL(path, base).href, { signal: controllers[index].signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
              if (!response.ok) throw new Error('HTTP ' + response.status);
              return verify(await response.arrayBuffer(), info);
            })(),
            new Promise((_, reject) => { timer = setTimeout(() => { controllers[index].abort(); reject(new Error('Timeout')); }, timeout); }),
          ]);
          finished = true; return bytes;
        } finally { clearTimeout(timer); }
      }));
    } catch (cause) { throw new Error('文件暂时无法载入，请检查网络后重试。', { cause }); }
    finally { finished = true; controllers.forEach(controller => controller.abort()); }
  }
  async function bytes(path, info = null, fresh = false) {
    if (!pending.has(path)) pending.set(path, (async () => {
      let cached;
      if (!fresh) { try { cached = await Promise.race([cache.get(path), new Promise(resolve => setTimeout(() => resolve(null), 500))]); } catch { /* Optional cache. */ } }
      if (cached) { try { return await verify(await cached.arrayBuffer(), info); } catch { /* Fetch a clean copy. */ } }
      const value = await download(path, info);
      try { Promise.resolve(cache.set(path, value)).catch(() => {}); } catch { /* Optional cache. */ }
      return value;
    })().finally(() => pending.delete(path)));
    return pending.get(path);
  }
  return { bytes, async json(path) {
    try { return JSON.parse(new TextDecoder().decode(await bytes(path))); }
    catch { return JSON.parse(new TextDecoder().decode(await bytes(path, null, true))); }
  } };
}
export const publicAssets = createPublicAssets();
