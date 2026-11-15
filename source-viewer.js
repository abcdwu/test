import { SUBJECTS, esc } from './common.js?v=11';
import { mountSourcePages } from './pdf-source.js?v=4';
import './word-translation.js?v=2';
const app = document.getElementById('source-app'), params = new URLSearchParams(location.search);
const subject = SUBJECTS.find(item => item.id === params.get('subject'));
const pages = [...new Set((params.get('pages') || '').split(',').map(Number))];
try {
  if (!subject || !pages.length || pages.length > 32 || pages.some(page => !Number.isSafeInteger(page) || page < 1)) throw new Error('原页链接不完整，请从题目页面重新打开。');
  const focus = pages.includes(Number(params.get('focus'))) ? Number(params.get('focus')) : pages[0];
  app.innerHTML = `<h1>原始题目页面。</h1><p class="sub">${esc(subject.label)} · 原 PDF 第 ${pages.join('、')} 页</p>
    <p><a class="text-link" href="sources/${subject.id}.pdf" target="_blank" rel="noopener">下载整份原始 PDF ↗</a></p>
    <div class="source-pages">${pages.map(page => `<figure class="pdf-source-page" data-pdf-path="sources/${subject.id}.pdf" data-pdf-page="${page}" id="page-${page}"><figcaption>原 PDF 第 ${page} 页</figcaption><div class="pdf-page-surface" aria-label="原 PDF 第 ${page} 页"><p class="pdf-page-status" role="status">正在载入对应原页…</p></div></figure>`).join('')}</div>`;
  mountSourcePages(app);
  requestAnimationFrame(() => document.getElementById('page-' + focus).scrollIntoView({ block: 'start' }));
} catch (error) { app.innerHTML = `<p class="notice error" role="alert">${esc(error.message)}</p>`; }
