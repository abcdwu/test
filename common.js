export const SUBJECTS = [
  { id: 'civil-procedure', label: '民事诉讼法 · Civil Procedure' },
  { id: 'constitutional-law', label: '宪法 · Constitutional Law' },
  { id: 'contracts', label: '合同法 · Contracts' },
  { id: 'criminal-law', label: '刑法 · Criminal Law' },
  { id: 'criminal-procedure', label: '刑事诉讼法 · Criminal Procedure' },
  { id: 'evidence', label: '证据法 · Evidence' },
  { id: 'real-property', label: '不动产法 · Real Property' },
  { id: 'torts', label: '侵权法 · Torts' },
];

export const esc = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
export const subjectLabel = id => SUBJECTS.find(subject => subject.id === id)?.label || '全部科目';
export const filterSubject = (questions, subject) => subject === 'all'
  ? questions : questions.filter(question => question.subject === subject);
export const answerLetter = answer => Number.isInteger(answer) && answer >= 0 && answer < 4
  ? 'ABCD'[answer] : null;

export function subjectOptions(selected, questions, counts = null) {
  return [{ id: 'all', label: '全部科目' }, ...SUBJECTS].map(subject => {
    const available = counts ? (subject.id === 'all' ? Object.values(counts).reduce((sum, count) => sum + count, 0) : counts[subject.id] ?? 0) : filterSubject(questions, subject.id).length;
    return `<option value="${subject.id}" ${subject.id === selected ? 'selected' : ''}>${esc(subject.label)}（${available} 题）</option>`;
  }).join('');
}

export function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

export class QuizTimer {
  constructor(mode, questionCount, now = () => Date.now()) {
    this.mode = mode;
    this.limitMs = questionCount * 108 * 1000;
    this.now = now;
    this.startedAt = now();
    this.stoppedAt = null;
  }

  get elapsedMs() { return Math.max(0, (this.stoppedAt ?? this.now()) - this.startedAt); }
  get expired() { return this.mode === 'countdown' && this.elapsedMs >= this.limitMs; }
  get displaySeconds() {
    return this.mode === 'countdown'
      ? Math.max(0, Math.ceil((this.limitMs - this.elapsedMs) / 1000))
      : Math.floor(this.elapsedMs / 1000);
  }
  stop() { if (this.stoppedAt === null) this.stoppedAt = this.now(); }
}

export async function loadCatalog(options) {
  return (await import('./bank-loader.js?v=7')).loadCatalog(options);
}

export async function loadBank(subject = 'all') {
  return (await import('./bank-loader.js?v=7')).loadBank(subject);
}

function sourcePages(question, kind) {
  const source = question.source;
  if (!source || !/^sources\/[a-z0-9-]+\.pdf$/.test(source.pdfPath)) return [];
  const pages = source[kind === 'question' ? 'questionPages' : 'explanationPages'];
  if (!Array.isArray(pages) || !pages.length || pages.some(page => !Number.isInteger(page) || page < 1)) return [];
  return [...new Set(pages)];
}

function originalPages(question, kind) {
  const label = kind === 'question' ? '题目' : '解析';
  return `<div class="source-pages">${sourcePages(question, kind).map(page => `<figure class="pdf-source-page" data-pdf-path="${esc(question.source.pdfPath)}" data-pdf-page="${page}">
    <figcaption><span>${label} · PDF 第 ${page} 页</span><a class="text-link" href="${esc(sourcePageUrl(question, kind, page))}" target="_blank" rel="noopener">打开原始 PDF ↗</a><a class="text-link" href="https://abcdwu-mbe-mistakes.fly.dev/${esc(sourcePageUrl(question, kind, page))}" target="_blank" rel="noopener">备用原页 ↗</a><a class="text-link" href="${esc(question.source.pdfPath)}" target="_blank" rel="noopener">下载整份 PDF ↗</a></figcaption>
    <div class="pdf-page-surface" aria-label="${label}原文 PDF 第 ${page} 页">
      <p class="pdf-page-status" role="status">浏览到这里时载入原文页面…</p>
    </div>
  </figure>`).join('')}</div>`;
}

export function sourcePageUrl(question, kind = 'question', page = null) {
  const pages = sourcePages(question, kind);
  // Classification can differ from the PDF that actually contains the question.
  const pdfSubject = /^sources\/([a-z0-9-]+)\.pdf$/.exec(question.source?.pdfPath ?? '')?.[1];
  return 'source.html?' + new URLSearchParams({ subject: pdfSubject || question.subject, pages: pages.join(','), focus: String(page && pages.includes(page) ? page : pages[0]) }).toString();
}

// This helper deliberately reads questionPages only: quiz markup must not include answer pages.
export function questionSource(question) {
  const pages = sourcePages(question, 'question');
  if (!pages.length) return '';
  const number = Number.isInteger(question.source.questionNumber) ? `原题第 ${question.source.questionNumber} 题 · ` : '';
  return `<div class="question-source"><p class="source-reference">${number}题目 PDF 第 ${pages.join('、')} 页</p>
    <details class="source-question"><summary>查看题目原始页面</summary>${originalPages(question, 'question')}</details></div>`;
}

export function reviewQuestion(question, selected) {
  const sourceLinks = [['question', '原题'], ['explanation', '解析']].map(([kind, label]) => {
    const pages = sourcePages(question, kind);
    return pages.length ? `<a class="text-link" href="${esc(sourcePageUrl(question, kind))}" target="_blank" rel="noopener">查看${label} PDF · 第 ${pages.join('、')} 页 ↗</a>` : '';
  }).filter(Boolean).join('　　');
  return `${sourceLinks ? `<p class="source-quick-links"><strong>原文定位：</strong> ${sourceLinks}</p>` : ''}<p class="question" data-question-id="${esc(question.id)}">${esc(question.stem)}</p>
    <div class="result-options">${question.choices.map((choice, index) => {
      const letter = 'ABCD'[index];
      return `<div class="ro ${letter === question.answer ? 'correct' : selected === letter ? 'wrong' : ''}">
        <span class="review-letter">${letter}.</span> <span class="choice-text" data-question-id="${esc(question.id + ':choice-' + letter)}">${esc(choice)}</span> ${letter === question.answer ? '<span class="choice-verdict"> ✓ 正确答案</span>' : selected === letter ? '<span class="choice-verdict"> ✕ 你的答案</span>' : ''}
      </div>`;
    }).join('')}</div>
    ${questionSource(question)}
    ${explanationContent(question)}`;
}
export function explanationContent(question) {
  return `${optionAnalysis(question)}${sourcePages(question, 'explanation').length
      ? `<div class="explain source-explanation"><strong>完整原文解析</strong>
          <p class="source-note">以下保留原始 PDF 的全部解析页，包括图表。页码为 PDF 文件页码。</p>
          ${originalPages(question, 'explanation')}
          <details class="extracted-text"><summary>复制解析文字（辅助文本）</summary>
            <p class="source-note">提取文字可能存在排版或识别误差，图表及准确内容请查看上方原始页面。</p>
            <div class="extracted-content">${esc(question.explanation)}</div>
          </details>
        </div>`
      : `<div class="explain"><strong>原文解析</strong>\n\n${esc(question.explanation)}</div>`}`;
}

// Only explicit line-start choice headings are grouped. Inline references and
// unlabelled paragraphs are never guessed into an incorrect option's analysis.
export function explanationExcerpts(text) {
  const markers = [...text.matchAll(/^\(Choices?\s+([A-D](?:(?:,\s*|\s+(?:and|or|&)\s+)[A-D])*)\)/gm)];
  if (!markers.length) return null;
  const stop = text.search(/^Educational objective\s*:|^References\s*$|^Copyright\s/gm);
  const end = stop >= markers[0].index ? stop : text.length;
  const options = Object.fromEntries([...'ABCD'].map(letter => [letter, []]));
  markers.forEach((marker, index) => {
    if (marker.index >= end) return;
    const excerpt = text.slice(marker.index, Math.min(markers[index + 1]?.index ?? end, end)).trim();
    for (const letter of marker[1].match(/[A-D]/g)) options[letter].push(excerpt);
  });
  return { main: text.slice(0, markers[0].index).trim(), options };
}
function optionAnalysis(question) {
  const excerpts = explanationExcerpts(question.explanation);
  if (!excerpts) return '';
  return `<details class="option-analysis"><summary>按 A / B / C / D 查看原文分析</summary><p class="source-note">仅按原文明确的选项标题整理，未补写法律解释。文字与图表请结合下方完整原页核对。</p>${[...'ABCD'].map(letter => {
    const parts = excerpts.options[letter], main = letter === question.answer && !parts.length ? excerpts.main : '';
    return `<details class="analysis-part"><summary>${letter} · ${letter === question.answer ? '正确答案' : '其他选项'}</summary><div class="extracted-content">${esc(parts.length ? parts.join('\n\n') : main || '原文未单独标记此选项的分析，请查看下方完整原文解析。')}</div></details>`;
  }).join('')}</details>`;
}
