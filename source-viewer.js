import { SUBJECTS, esc } from './common.js?v=11';
import { mountSourcePages } from './pdf-source.js?v=5';
import { sourceChunkLocation } from './source-chunks.js?v=2';
import './word-translation.js?v=2';
const app = document.getElementById('source-app'), params = new URLSearchParams(location.search);
const subject = SUBJECTS.find(item => item.id === params.get('subject'));
const pages = [...new Set((params.get('pages') || '').split(',').map(Number))];
const kind = params.get('kind') === 'explanation' ? 'explanation' : 'question';
const kindLabel = kind === 'explanation' ? '解析' : '题目';
try {
  if (!subject || !pages.length || pages.length > 32 || pages.some(page => !Number.isSafeInteger(page) || page < 1)) throw new Error('原页链接不完整，请从题目页面重新打开。');
  const focus = pages.includes(Number(params.get('focus'))) ? Number(params.get('focus')) : pages[0];
  app.innerHTML = `<h1>原始${kindLabel}页面。</h1><p class="sub">${esc(subject.label)} · 原 PDF 第 ${pages.join('、')} 页</p>
    <p><a class="text-link" href="sources/${subject.id}.pdf#page=${focus}" target="_blank" rel="noopener">在 Safari 打开整份 PDF · 第 ${focus} 页 ↗</a></p>
    <p class="source-note">如果下方原页未显示，可点击每页对应的「Safari 原生 PDF」打开更小的原始页面分段，无需本站 PDF 阅读器。浏览器可能忽略页码定位，请参考链接旁的分段页码。</p>
    <div class="source-pages">${pages.map(page => `<figure class="pdf-source-page" data-pdf-path="sources/${subject.id}.pdf" data-pdf-page="${page}" id="page-${page}"><figcaption><span>原 PDF 第 ${page} 页</span><span class="pdf-native-slot" data-native-page="${page}">正在准备原生 PDF 入口…</span></figcaption><div class="pdf-page-surface" aria-label="原 PDF 第 ${page} 页"><p class="pdf-page-status" role="status">正在载入对应原页…</p></div></figure>`).join('')}</div>`;
  // Native Safari links are usable when the JS PDF renderer cannot load.
  for (const slot of app.querySelectorAll('[data-native-page]')) {
    const page = Number(slot.dataset.nativePage);
    sourceChunkLocation(`sources/${subject.id}.pdf`, page).then(chunk => {
      if (!slot.isConnected) return;
      const link = document.createElement('a');
      link.className = 'text-link';
      link.href = `${chunk.path}#page=${chunk.pageNumber}`;
      link.target = '_blank'; link.rel = 'noopener';
      link.textContent = `Safari 原生 PDF ↗（分段第 ${chunk.pageNumber} 页）`;
      slot.replaceChildren(link);
    }).catch(() => {
      if (!slot.isConnected) return;
      const link = document.createElement('a');
      link.className = 'text-link'; link.href = `sources/${subject.id}.pdf#page=${page}`;
      link.target = '_blank'; link.rel = 'noopener'; link.textContent = '打开整份 PDF ↗';
      slot.replaceChildren(link);
    });
  }
  mountSourcePages(app);
  requestAnimationFrame(() => document.getElementById('page-' + focus).scrollIntoView({ block: 'start' }));
} catch (error) { app.innerHTML = `<p class="notice error" role="alert">${esc(error.message)}</p>`; }
