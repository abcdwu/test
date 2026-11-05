import { MistakeStore, STORAGE_KEY } from './mistake-store.js?v=3';

// IndexedDB can retain the full question bank without localStorage's small quota.
// Each mutation reads and writes in one transaction to preserve edits from tabs.
class BrowserMistakeStore {
  constructor() {
    this.state = { raw: null, device: crypto.randomUUID() };
    this.questions = null;
    this.error = null;
    this.channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('mbe-mistakes') : null;
    this.ready = this.initialize().catch(error => { this.error = error; });
    this.channel?.addEventListener('message', async () => {
      await this.ready;
      if (!this.db) return;
      const transaction = this.db.transaction('state', 'readonly');
      const request = transaction.objectStore('state').get('current');
      request.onsuccess = async () => {
        if (request.result && request.result.raw !== this.state.raw) {
          this.state = request.result;
          // Older tabs can introduce snapshots after this tab has loaded its bank.
          if (this.questions) {
            try { await this.update('refreshQuestions', [this.questions]); } catch { /* Keep the received records readable. */ }
          }
          window.dispatchEvent(new Event('mbe:local-refreshed'));
          window.dispatchEvent(new Event('mbe:mistakes-changed'));
        }
      };
    });
  }

  core(state) {
    return new MistakeStore({
      getItem: key => key === STORAGE_KEY ? state.raw : state.device,
      setItem: (key, value) => { if (key === STORAGE_KEY) state.raw = value; else state.device = value; },
    });
  }

  async initialize() {
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mbe-mistakes', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    this.db.onversionchange = () => this.db.close();
    await this.mutate(null, []);
    // Move any older localStorage records without deleting the original copy.
    let legacy;
    try { legacy = localStorage.getItem(STORAGE_KEY); } catch { /* IndexedDB can still work. */ }
    if (legacy) {
      const old = new MistakeStore({ getItem: () => legacy });
      await this.mutate('merge', [old.read()]);
    }
  }

  read() {
    if (this.error) throw this.error;
    return this.core(this.state).read();
  }

  mutate(method, args) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction('state', 'readwrite');
      const store = transaction.objectStore('state');
      const request = store.get('current');
      let next, result, changed = false, failure;
      request.onsuccess = () => {
        try {
          next = request.result ?? { ...this.state };
          const before = next.raw;
          const core = this.core(next);
          if (method) result = core[method](...args);
          // Restore and cloud merge can introduce old snapshots at any time.
          // Upgrade them in the same transaction, preserving their attempt history.
          if (this.questions && method !== 'refreshQuestions') core.refreshQuestions(this.questions);
          changed = next.raw !== before;
          store.put(next, 'current');
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => {
        this.state = next;
        if (changed) {
          this.channel?.postMessage('changed');
          window.dispatchEvent(new Event('mbe:mistakes-changed'));
        }
        resolve(result);
      };
      transaction.onabort = transaction.onerror = () => reject(failure || transaction.error || new Error('浏览器存储写入失败'));
    });
  }

  async update(method, args) {
    await this.ready;
    if (this.error) throw this.error;
    return this.mutate(method, args);
  }
  record(...args) { return this.update('record', args); }
  merge(...args) { return this.update('merge', args); }
  restore(...args) { return this.update('restore', args); }
  refreshQuestions(questions) {
    this.questions = questions;
    return this.update('refreshQuestions', [questions]);
  }
}

export const mistakeStore = new BrowserMistakeStore();
