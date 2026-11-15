import { esc, SUBJECTS, subjectLabel, loadBank, reviewQuestion } from './common.js?v=10';
import { mistakeStore } from './browser-store.js?v=14';
import { studyValue } from './study-core.js?v=1';
import { studyHistory, mountStudyTools, studyTools, flushStudyNotes } from './study-ui.js?v=1';
import { mountSourcePages, unmountSourcePages } from './pdf-source.js?v=4';
import { mountHighlights } from './highlights.js?v=4';
import './word-translation.js?v=2';
import './cloud-sync.js?v=14';
const app = document.getElementById('app'), focus = new URLSearchParams(location.search).get('question');
let subject = 'all', type = 'all';
const loaded = new Map();
async function savePending() {
  if (!await flushStudyNotes(app, [...loaded.values()].flat())) return false;
  for (const item of app.querySelectorAll('[data-notebook-id]')) {
    const record = mistakeStore.readStudy().find(record => record.questionId === item.dataset.notebookId), question = { id: record.questionId, subject: record.subject };
    const note = item.querySelector('.notebook-note'), front = item.querySelector('.card-front-input'), back = item.querySelector('.card-back-input');
    try {
      if (note.value !== note.defaultValue) { const value = note.value; await mistakeStore.saveStudy(question, 'note', value); note.defaultValue = value; }
      if (front && (front.value !== front.defaultValue || back.value !== back.defaultValue)) {
        const value = { front: front.value, back: back.value }; await mistakeStore.saveStudy(question, 'card', value); front.defaultValue = value.front; back.defaultValue = value.back;
      }
    } catch { item.querySelector('.note-status').textContent = '保存失败，已保留输入，请重试后切换。'; return false; }
  }
  return true;
}
async function original(target, record) {
  target.innerHTML = '<p class="note">正在读取题目与原始解析…</p>';
  try {
    if (!loaded.has(record.subject)) loaded.set(record.subject, await loadBank(record.subject));
    const question = loaded.get(record.subject).find(question => question.id === record.questionId);
    if (!question) throw new Error('这道题暂时无法找到，请稍后重试。');
    if (!target.isConnected) return;
    target.innerHTML = reviewQuestion(question, null) + studyTools(question);
    mountHighlights(target); mountSourcePages(target); mountStudyTools(target, [question]);
  } catch (error) {
    target.innerHTML = `<p class="notice error">${esc(error.message || '暂时无法读取，请重试。')}</p><button type="button" class="secondary">重试读取</button>`;
    target.querySelector('button').addEventListener('click', () => original(target, record));
  }
}
function render() {
  unmountSourcePages(app);
  let records; try { records = mistakeStore.readStudy(); } catch { app.innerHTML = '<p class="notice error">笔记本无法读取，请检查存储权限后刷新。</p>'; return; }
  records = records.filter(record => (subject === 'all' || record.subject === subject) && (type === 'all'
    ? studyValue(record, 'note') || studyValue(record, 'card') || record.revisions.length
    : type === 'notes' ? studyValue(record, 'note') : studyValue(record, 'card')));
  app.innerHTML = `<div class="eyebrow">My notebook</div><h1>笔记与闪卡。</h1><p class="sub">集中复习规则与易错点。保存在本机，登录后自动同步到 Fly.io；历史版本可随时查阅。</p>
    <div class="notebook-filters"><label>科目<select id="notebook-subject"><option value="all">全部科目</option>${SUBJECTS.map(item => `<option value="${item.id}" ${subject === item.id ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label><label>内容<select id="notebook-type"><option value="all">笔记与闪卡</option><option value="notes" ${type === 'notes' ? 'selected' : ''}>仅笔记</option><option value="cards" ${type === 'cards' ? 'selected' : ''}>仅闪卡</option></select></label></div>
    <p class="note">${records.length} 道题 · 从练习回顾或错题解析中保存笔记、一键制卡。</p>
    ${records.map((record, index) => {
      const card = studyValue(record, 'card');
      return `<section class="card notebook-item" id="note-${index}" data-notebook-id="${esc(record.questionId)}"><p class="subject-tag">${esc(subjectLabel(record.subject))}</p>
        <h2>${card ? '闪卡' : '我的笔记'}</h2>${card ? `<div class="flashcard-front">${esc(card.front)}</div><details class="flashcard-answer"><summary>翻面 · 查看答案</summary><div class="flashcard-back">${esc(card.back)}</div></details>
        <details class="card-edit"><summary>编辑闪卡</summary><label>正面<textarea class="card-front-input" maxlength="200000">${esc(card.front)}</textarea></label><label>背面<textarea class="card-back-input" maxlength="400000">${esc(card.back)}</textarea></label><button type="button" class="secondary" data-save-card>保存闪卡</button><p role="status" class="card-status note"></p></details>` : ''}
        <label class="label">我的笔记<textarea class="notebook-note" rows="4" maxlength="30000">${esc(studyValue(record, 'note'))}</textarea></label><button type="button" class="secondary" data-save-note>保存笔记</button><p class="note note-status" role="status"></p>
        <details class="notebook-original"><summary>查看完整题目、解析与原始图表</summary><div class="notebook-source"></div></details>${studyHistory(record)}</section>`;
    }).join('') || '<section class="card empty"><h2>从一个易错点开始。</h2><p class="sub">做题后，在解析下方保存笔记或一键制卡。</p><a class="text-link" href="index.html">开始练习 →</a></section>'}`;
  document.getElementById('notebook-subject').onchange = async event => { const value = event.target.value; if (await savePending()) { subject = value; render(); } else event.target.value = subject; };
  document.getElementById('notebook-type').onchange = async event => { const value = event.target.value; if (await savePending()) { type = value; render(); } else event.target.value = type; };
  app.querySelectorAll('[data-notebook-id]').forEach((item, index) => {
    const record = records[index], question = { id: record.questionId, subject: record.subject };
    item.querySelector('[data-save-note]').onclick = async event => {
      event.target.disabled = true; const status = item.querySelector('.note-status');
      try { const input = item.querySelector('.notebook-note'), value = input.value; await mistakeStore.saveStudy(question, 'note', value); input.defaultValue = value; status.textContent = '笔记已保存，登录后自动云同步。'; refreshHistory(item, question.id); }
      catch { status.textContent = '保存失败，文字已保留，请重试。'; } finally { event.target.disabled = false; }
    };
    item.querySelector('[data-save-card]')?.addEventListener('click', async event => {
      event.target.disabled = true; const status = item.querySelector('.card-status');
      try { const front = item.querySelector('.card-front-input'), back = item.querySelector('.card-back-input'), value = { front: front.value, back: back.value }; await mistakeStore.saveStudy(question, 'card', value); front.defaultValue = value.front; back.defaultValue = value.back; item.querySelector('.flashcard-front').textContent = value.front; item.querySelector('.flashcard-back').textContent = value.back; status.textContent = '闪卡已保存。'; refreshHistory(item, question.id); }
      catch { status.textContent = '保存失败，文字已保留，请重试。'; } finally { event.target.disabled = false; }
    });
    item.querySelector('.notebook-original').addEventListener('toggle', event => {
      const target = item.querySelector('.notebook-source'); if (event.target.open && !target.hasChildNodes()) original(target, record);
    });
  });
  if (focus) requestAnimationFrame(() => [...app.querySelectorAll('[data-notebook-id]')].find(item => item.dataset.notebookId === focus)?.scrollIntoView({ block: 'start' }));
}
// Incoming sync never replaces an editor containing unsaved text.
const unsaved = () => [...app.querySelectorAll('textarea')].some(input => input.value !== input.defaultValue);
function refreshHistory(item, id) { item.querySelector(':scope > .study-revisions').outerHTML = studyHistory(mistakeStore.readStudy().find(record => record.questionId === id)); }
window.addEventListener('beforeunload', event => { if (unsaved()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('mbe:cloud-synced', () => { if (!unsaved()) render(); });
window.addEventListener('mbe:study-changed', () => {
  if (!unsaved() && !app.querySelector('textarea:focus')) render();
});
mistakeStore.ready.then(render);
