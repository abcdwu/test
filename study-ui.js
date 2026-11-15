import { esc } from './common.js?v=10';
import { mistakeStore } from './browser-store.js?v=14';
import { studyValue } from './study-core.js?v=1';
export const studyTools = (question, card = true) => `<details class="study-tools" data-study-id="${esc(question.id)}"><summary>本题笔记${card ? '与闪卡' : ''}</summary><div class="study-editor"></div></details>`;
export function mountStudyTools(root, questions, allowCard = true) {
  const bank = new Map(questions.map(question => [question.id, question]));
  for (const tools of root.querySelectorAll('[data-study-id]')) {
    const question = bank.get(tools.dataset.studyId); if (!question || tools.dataset.studyMounted) continue;
    tools.dataset.studyMounted = 'true';
    tools.addEventListener('toggle', () => { if (tools.open && !tools.querySelector('textarea')) editor(); });
    function editor() {
      let record;
      try { record = mistakeStore.readStudy().find(item => item.questionId === question.id); }
      catch { tools.querySelector('.study-editor').innerHTML = '<p class="notice error">本机存储暂不可用，请保留笔记并重试。</p>'; return; }
      const target = tools.querySelector('.study-editor');
      target.innerHTML = `<label class="label">我的笔记<textarea class="study-note" rows="5" maxlength="30000" placeholder="记下争点、规则或下次容易忽略的细节…">${esc(studyValue(record, 'note'))}</textarea></label>
        <div class="study-actions"><button type="button" class="secondary" data-save-note>保存笔记</button>${allowCard ? `<button type="button" class="secondary" data-make-card>${studyValue(record, 'card') ? '查看／编辑闪卡' : '一键制卡'}</button>` : ''}<a class="text-link" href="notebook.html" target="_blank" rel="noopener">打开笔记本 ↗</a></div>
        <p class="study-status note" role="status">保存在本机，登录后自动同步；每次保存保留历史版本。</p>`;
      const status = target.querySelector('.study-status');
      target.querySelector('[data-save-note]').addEventListener('click', async event => {
        const text = target.querySelector('textarea').value; event.target.disabled = true;
        try { await mistakeStore.saveStudy(question, 'note', text); target.querySelector('textarea').defaultValue = text; status.textContent = '笔记已保存在本机；登录后自动云同步。'; }
        catch { status.textContent = '保存失败，文字仍保留在输入框中，请重试。'; }
        finally { event.target.disabled = false; }
      });
      target.querySelector('[data-make-card]')?.addEventListener('click', async event => {
        event.target.disabled = true;
        try {
          const current = mistakeStore.readStudy().find(item => item.questionId === question.id);
          if (!studyValue(current, 'card')) await mistakeStore.saveStudy(question, 'card', {
            front: question.stem, back: `${question.answer}. ${question.choices['ABCD'.indexOf(question.answer)]}\n\n${question.explanation}`,
          });
          status.replaceChildren(document.createTextNode('闪卡已保存，含原始解析与图表入口。'));
          const link = document.createElement('a'); link.href = 'notebook.html?question=' + encodeURIComponent(question.id); link.className = 'text-link'; link.target = '_blank'; link.rel = 'noopener'; link.textContent = ' 打开闪卡 ↗'; status.append(link);
        } catch { status.textContent = '制卡失败，请检查本机存储后重试。'; }
        finally { event.target.disabled = false; }
      });
    }
  }
}
export async function flushStudyNotes(root, questions) {
  for (const tools of root.querySelectorAll('[data-study-id]')) {
    const input = tools.querySelector('textarea.study-note');
    if (!input || input.value === input.defaultValue) continue;
    const question = questions.find(question => question.id === tools.dataset.studyId);
    if (!question) continue;
    try { const value = input.value; await mistakeStore.saveStudy(question, 'note', value); input.defaultValue = value; }
    catch { tools.querySelector('.study-status').textContent = '笔记保存失败，已保留当前输入，请重试。'; return false; }
  }
  return true;
}
window.addEventListener('beforeunload', event => {
  if ([...document.querySelectorAll('textarea.study-note')].some(input => input.value !== input.defaultValue)) { event.preventDefault(); event.returnValue = ''; }
});
export function studyHistory(record) {
  return `<details class="study-revisions"><summary>保存历史（${record.revisions.length} 个版本）</summary>${[...record.revisions].reverse().map(edit => `<article><p class="note">${esc(new Date(edit.updatedAt).toLocaleString('zh-CN'))} · ${edit.kind === 'note' ? '笔记' : '闪卡'}</p><pre>${esc(edit.kind === 'note' ? edit.value : edit.value ? edit.value.front + '\n\n' + edit.value.back : '已移除闪卡')}</pre></article>`).join('')}</details>`;
}
