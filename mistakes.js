import { SUBJECTS, esc, loadBank, reviewQuestion, subjectLabel, subjectOptions } from './common.js?v=3';
import { mountSourcePages, unmountSourcePages } from './pdf-source.js?v=3';
import { downloadBackup, STORAGE_KEY } from './mistake-store.js?v=5';
import { mistakeStore } from './browser-store.js?v=5';
import './cloud-sync.js?v=5';

const app = document.getElementById('app');
const requested = new URLSearchParams(location.search).get('subject');
let subject = SUBJECTS.some(item => item.id === requested) ? requested : 'all';
let backupMessage = '', backupError = false;

function render() {
  unmountSourcePages(app);
  let entries;
  try { entries = mistakeStore.read(); }
  catch {
    app.innerHTML = '<h1>错题本暂时无法读取。</h1><p class="notice error" role="alert">请检查浏览器存储权限或现有数据，然后刷新重试。</p><p><a class="text-link" href="index.html">返回练习 →</a></p>';
    return;
  }
  const filtered = entries.filter(entry => subject === 'all' || entry.question.subject === subject)
    .sort((left, right) => Date.parse(right.lastWrongAt) - Date.parse(left.lastWrongAt));
  app.innerHTML = `<div class="eyebrow">Your review space</div><h1>错题本。</h1>
    <p class="sub">自动收录每次交卷的错题与未作答题目。<br>共 ${entries.length} 道错题，当前科目 ${filtered.length} 道。</p>
    <section class="card setup">
      <label class="label" for="subject">按科目查看</label>
      <select id="subject">${subjectOptions(subject, entries.map(entry => entry.question))}</select>
      ${filtered.length ? `<a class="primary button-link" href="index.html?source=mistakes&amp;subject=${subject}">重练当前科目的错题 →</a>` : ''}
      <p class="note">本机自动保存；登录云同步后可跨设备查看，清理浏览器前请确认同步完成。</p>
    </section>
    <details class="card backup-panel" ${backupMessage ? 'open' : ''}>
      <summary>手动备份与恢复（可选）</summary>
      <p class="sub">云同步启用后无需日常操作。也可自行保留 JSON 备份；恢复时合并记录、保留现有错题，重复导入不会重复累计次数。</p>
      <div class="nav">
        <button class="secondary" id="export" ${!entries.length && !mistakeStore.readAttempts().length ? 'disabled' : ''}>导出错题与累计统计</button>
        <button class="secondary" id="import">从备份恢复</button>
      </div>
      <input type="file" id="backup-file" accept=".json,application/json" hidden>
      <p class="notice ${backupError ? 'error' : ''}" id="backup-status" role="status" ${!backupMessage ? 'hidden' : ''}>${esc(backupMessage)}</p>
    </details>
    ${filtered.length ? filtered.map(entry => `<details class="card result mistake">
      <summary><span class="subject-tag">${esc(subjectLabel(entry.question.subject))}</span>
        <span class="mistake-title">${esc(entry.question.stem.slice(0, 145))}${entry.question.stem.length > 145 ? '…' : ''}</span>
        <span class="mistake-meta">累计出错 ${entry.wrongCount} 次 · 最近作答：${entry.lastAnswer ?? '未作答'} · ${esc(new Date(entry.lastWrongAt).toLocaleString('zh-CN'))}</span>
        <span class="text-link detail-hint">展开题目与解析</span>
      </summary>${reviewQuestion(entry.question, entry.lastAnswer)}</details>`).join('')
      : '<section class="card empty"><h2>这里还没有错题。</h2><p class="sub">去完成一组练习，错题就会自动出现在这里。</p><a class="text-link" href="index.html">开始练习 →</a></section>'}`;
  document.getElementById('subject').addEventListener('change', event => { subject = event.target.value; render(); });
  document.getElementById('export').addEventListener('click', () => {
    try {
      downloadBackup(mistakeStore.read(), mistakeStore.readAttempts());
      backupMessage = '已生成备份，请保留下载的 JSON 文件。'; backupError = false;
    } catch { backupMessage = '导出失败，请检查浏览器存储和下载权限。'; backupError = true; }
    render();
  });
  document.getElementById('import').addEventListener('click', () => document.getElementById('backup-file').click());
  document.getElementById('backup-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('备份文件过大');
      const result = await mistakeStore.restore(await file.text());
      backupMessage = `恢复完成：新增 ${result.added} 道，目前共 ${result.total} 道错题。`;
      backupError = false;
    } catch {
      backupMessage = '恢复失败：请使用本站导出的有效 JSON 备份，并检查浏览器存储空间。现有记录已保留。';
      backupError = true;
    }
    render();
  });
  mountSourcePages(app);
}

window.addEventListener('storage', event => { if (event.key === STORAGE_KEY || event.key === null) render(); });
window.addEventListener('mbe:cloud-synced', render);
window.addEventListener('mbe:local-refreshed', render);
mistakeStore.ready.then(async () => {
  try { await mistakeStore.refreshQuestions(await loadBank()); } catch { /* Keep existing snapshots available when the bank cannot be loaded. */ }
  render();
});
