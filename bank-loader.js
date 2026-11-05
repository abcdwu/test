// Small subject downloads, verified local caching and an independent public mirror.
export const MIRROR_ORIGIN = 'https://abcdwu-mbe-mistakes.fly.dev';
const SUBJECTS = ['civil-procedure', 'constitutional-law', 'contracts', 'criminal-law',
  'criminal-procedure', 'evidence', 'real-property', 'torts'];
let database;
async function cacheDatabase() {
  if (typeof indexedDB === 'undefined') return null;
  if (!database) database = new Promise(resolve => {
    let finished = false;
    const complete = value => { if (!finished) { finished = true; clearTimeout(timeout); resolve(value); } else value?.close(); };
    const timeout = setTimeout(() => complete(null), 1000);
    try {
      const request = indexedDB.open('mbe-bank-cache', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files');
      request.onsuccess = () => complete(request.result);
      request.onerror = request.onblocked = () => complete(null);
    } catch { complete(null); }
  });
  return database;
}
const localCache = {
  async get(key) {
    const db = await cacheDatabase(); if (!db) return null;
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), 1000);
      try {
        const request = db.transaction('files').objectStore('files').get(key);
        request.onsuccess = () => { clearTimeout(timer); resolve(request.result ?? null); };
        request.onerror = () => { clearTimeout(timer); resolve(null); };
      } catch { clearTimeout(timer); resolve(null); }
    });
  },
  async set(key, value) {
    const db = await cacheDatabase(); if (!db) return;
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 1000);
      try {
        const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(value, key);
        tx.oncomplete = tx.onerror = tx.onabort = () => { clearTimeout(timer); resolve(); };
      } catch { clearTimeout(timer); resolve(); }
    });
  },
};

export function validateCatalog(value) {
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.total) || value.total < 1
    || !value.subjects || Object.keys(value.subjects).length !== SUBJECTS.length) throw new Error('科目清单格式不正确');
  let total = 0;
  for (const subject of SUBJECTS) {
    const item = value.subjects[subject];
    if (!item || !Number.isSafeInteger(item.count) || item.count < 0 || !/^[a-f0-9]{64}$/.test(item.sha256)
      || item.file !== `${subject}.${item.sha256.slice(0, 16)}.json.gz`
      || !Number.isSafeInteger(item.bytes) || item.bytes < 1) throw new Error('科目清单不完整');
    total += item.count;
  }
  if (total !== value.total) throw new Error('科目清单题数不一致');
  return value;
}

export function createBankLoader({ fetcher = (...args) => fetch(...args), cache = localCache,
  origins = ['bank/', `${MIRROR_ORIGIN}/bank/`], mirrorDelay = 600, timeoutMs = 12000 } = {}) {
  const base = globalThis.location?.href || 'http://localhost/';
  const sources = [...new Set(origins.map(origin => new URL(origin, base).href))];
  const pending = new Map(), loaded = new Map();
  let catalogPromise;
  const readCache = async key => { try { return await cache.get(key); } catch { return null; } };
  const saveCache = async (key, value) => { try { await cache.set(key, value); } catch { /* Optional cache. */ } };

  async function download(filename, verify) {
    const controllers = sources.map(() => new AbortController());
    let finished = false;
    try {
      return await Promise.any(sources.map(async (origin, index) => {
        if (index) await new Promise(resolve => setTimeout(resolve, mirrorDelay));
        if (finished) throw new Error('Already downloaded');
        let timer;
        try {
          const result = await Promise.race([
            (async () => {
              const response = await fetcher(new URL(filename, origin).href, {
                signal: controllers[index].signal, credentials: 'omit', referrerPolicy: 'no-referrer',
                cache: filename.startsWith('manifest.json') ? 'no-store' : 'default',
              });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return verify(await response.arrayBuffer());
            })(),
            new Promise((_, reject) => { timer = setTimeout(() => { controllers[index].abort(); reject(new Error('Timeout')); }, timeoutMs); }),
          ]);
          finished = true;
          return result;
        } finally { clearTimeout(timer); }
      }));
    } catch (cause) { throw new Error('暂时无法下载题库，请重试，或使用备用入口。', { cause }); }
    finally { finished = true; controllers.forEach(controller => controller.abort()); }
  }

  async function catalog({ refresh = false } = {}) {
    if (refresh) catalogPromise = null;
    if (!catalogPromise) catalogPromise = (async () => {
      try {
        const value = await download('manifest.json?v=7', bytes => validateCatalog(JSON.parse(new TextDecoder().decode(bytes))));
        saveCache('catalog', value); return value;
      } catch (error) {
        const cached = await readCache('catalog');
        if (cached) { try { return validateCatalog(cached); } catch { /* Reject damaged cached metadata. */ } }
        throw error;
      }
    })().catch(error => { catalogPromise = null; throw error; });
    return catalogPromise;
  }

  async function decode(bytes, info, subject) {
    const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (buffer.byteLength !== info.bytes || hash !== info.sha256) throw new Error('科目题库校验失败');
    if (typeof DecompressionStream !== 'function') throw new Error('请更新浏览器后使用练习室');
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    const questions = JSON.parse(await new Response(stream).text());
    if (!Array.isArray(questions) || questions.length !== info.count || questions.some(q => q.subject !== subject
      || typeof q.id !== 'string' || typeof q.stem !== 'string' || typeof q.explanation !== 'string'
      || !Array.isArray(q.choices) || q.choices.length !== 4 || !q.choices.every(choice => typeof choice === 'string')
      || !/^[ABCD]$/.test(q.answer)) || new Set(questions.map(q => q.id)).size !== questions.length) throw new Error('科目题目不完整');
    return questions;
  }

  async function subjectBank(subject, manifest) {
    const info = manifest.subjects[subject];
    if (!info) throw new Error('未知科目');
    if (!info.count) return [];
    if (loaded.has(info.sha256)) return loaded.get(info.sha256);
    if (!pending.has(info.sha256)) pending.set(info.sha256, (async () => {
      const cached = await readCache(info.sha256);
      if (cached) { try { const qs = await decode(cached, info, subject); loaded.set(info.sha256, qs); return qs; } catch { /* Download a clean copy. */ } }
      const result = await download(info.file, async bytes => ({ bytes, questions: await decode(bytes, info, subject) }));
      loaded.set(info.sha256, result.questions); await saveCache(info.sha256, result.bytes); return result.questions;
    })().finally(() => pending.delete(info.sha256)));
    return pending.get(info.sha256);
  }

  async function bank(subject = 'all') {
    const manifest = await catalog();
    if (subject !== 'all') return subjectBank(subject, manifest);
    // Bound concurrent downloads on mobile connections.
    const result = [];
    for (let index = 0; index < SUBJECTS.length; index += 2) {
      const pairs = await Promise.all(SUBJECTS.slice(index, index + 2).map(key => subjectBank(key, manifest)));
      result.push(...pairs.flat());
    }
    if (result.length !== manifest.total || new Set(result.map(q => q.id)).size !== result.length) throw new Error('题库总数不完整');
    return result;
  }
  return { catalog, bank };
}

const loader = createBankLoader();
export const loadCatalog = options => loader.catalog(options);
export const loadBank = subject => loader.bank(subject);
