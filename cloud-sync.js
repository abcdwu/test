import { esc } from './common.js?v=3';
import { mistakeStore } from './browser-store.js?v=9';

const SESSION_KEY = 'mbe.cloud.session.v1';
const panel = document.getElementById('sync-panel');
let apiBase = '', session = null, syncing = false, queued = false, merging = false;
let status = '错题自动保存在当前浏览器。', showLogin = false;
let remoteRevision = null;
const uploaded = new Map();
const uploadedAttempts = new Map();

function resetSync() { remoteRevision = null; uploaded.clear(); uploadedAttempts.clear(); }

function render() {
  if (!panel) return;
  panel.innerHTML = `<section class="sync-panel" aria-label="错题保存状态">
    <div class="sync-summary"><span role="status">${esc(status)}</span>
      ${apiBase ? `<button class="link" id="sync-toggle">${session ? '退出云同步' : '登录云同步'}</button>` : ''}</div>
    ${apiBase && !session && showLogin ? `<form id="cloud-login" class="cloud-login">
      <label for="cloud-password">私人密码</label>
      <input id="cloud-password" type="password" autocomplete="current-password" required maxlength="512" placeholder="输入密码后自动同步错题">
      <button class="secondary" type="submit">登录并记住此设备</button>
      <p class="foot">无需邮箱。此设备记住登录 30 天，之后重新输入密码即可。</p>
    </form>` : ''}
  </section>`;
  document.getElementById('sync-toggle')?.addEventListener('click', async () => {
    if (!session) { showLogin = !showLogin; render(); document.getElementById('cloud-password')?.focus(); return; }
    const token = session.token;
    session = null;
    resetSync();
    try { localStorage.removeItem(SESSION_KEY); } catch { /* Local questions remain available. */ }
    status = '已退出云同步，错题仍保存在本机。';
    render();
    try { await api('/auth/session', { method: 'DELETE', token }); } catch { /* Session also expires on the server. */ }
  });
  document.getElementById('cloud-login')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    const password = document.getElementById('cloud-password').value;
    button.disabled = true;
    try {
      const result = await api('/auth/login', { body: { password } });
      localStorage.setItem(SESSION_KEY, JSON.stringify(result));
      session = result; showLogin = false;
      resetSync();
      await sync();
    } catch (error) {
      status = error.status === 401 ? '密码不正确，请重试。'
        : error.status === 429 ? '尝试次数较多，请 15 分钟后重试。'
          : '暂时无法登录，请检查网络和浏览器存储权限。本机错题已保留。';
      render();
    }
  });
}

async function api(path, { method = 'POST', body, token = session?.token } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000), credentials: 'omit',
  });
  if (!response.ok) { const error = new Error('Sync request failed'); error.status = response.status; throw error; }
  return response.json();
}

export async function sync() {
  if (!apiBase || !session) return;
  if (syncing) { queued = true; return; }
  const activeSession = session;
  syncing = true;
  status = '正在自动同步错题…'; render();
  try {
    const outgoing = mistakeStore.read().filter(entry => uploaded.get(entry.question.id) !== JSON.stringify(entry));
    const attempts = mistakeStore.readAttempts().filter(attempt => uploadedAttempts.get(attempt.id) !== JSON.stringify(attempt));
    const result = await api('/api/sync', { body: { entries: outgoing, attempts, revision: remoteRevision } });
    if (session !== activeSession) return;
    merging = true;
    const before = JSON.stringify(mistakeStore.read());
    const beforeAttempts = JSON.stringify(mistakeStore.readAttempts());
    await mistakeStore.merge(result.entries);
    if (Array.isArray(result.attempts)) {
      await mistakeStore.mergeAttempts(result.attempts);
      for (const attempt of [...attempts, ...result.attempts]) uploadedAttempts.set(attempt.id, JSON.stringify(attempt));
    }
    for (const entry of [...outgoing, ...result.entries]) uploaded.set(entry.question.id, JSON.stringify(entry));
    remoteRevision = result.revision;
    merging = false;
    status = `错题已自动同步（含练习记录） · ${new Date(result.syncedAt).toLocaleTimeString('zh-CN')}`;
    if (attempts.length && !Array.isArray(result.attempts)) status = '错题已同步，累计统计暂仅保存在本机，服务更新后会自动补传。';
    if (JSON.stringify(mistakeStore.read()) !== before || JSON.stringify(mistakeStore.readAttempts()) !== beforeAttempts) window.dispatchEvent(new Event('mbe:cloud-synced'));
  } catch (error) {
    if (session !== activeSession) return;
    if (error.status === 401) {
      session = null;
      try { localStorage.removeItem(SESSION_KEY); } catch { /* Keep local data. */ }
      status = '云端登录已到期，请重新输入密码。本机错题已保留。';
    } else { status = '暂未同步，错题已保存在本机，联网后会自动重试。'; }
  } finally {
    merging = false; syncing = false; render();
    if (queued) { queued = false; setTimeout(sync, 500); }
  }
}

window.addEventListener('mbe:mistakes-changed', () => { if (!merging) sync(); });
window.addEventListener('online', sync);
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
window.addEventListener('storage', event => {
  if (event.key === SESSION_KEY || event.key === null) {
    try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { session = null; }
    resetSync();
    render();
  }
});
setInterval(() => { if (!document.hidden) sync(); }, 30_000);

fetch('cloud-config.json?v=4', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(async config => {
  await mistakeStore.ready;
  if (!config?.apiBase) { render(); return; }
  const url = new URL(config.apiBase);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Cloud endpoint must use HTTPS');
  }
  apiBase = url.origin;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { session = null; }
  if (!session?.token || session.expiresAt <= Date.now()) session = null;
  status = session ? '正在连接云端…' : '本机自动保存已开启，登录后自动同步到云端。';
  render(); sync();
}).catch(() => { status = '云端暂时不可用，错题自动保存在本机。'; render(); });
