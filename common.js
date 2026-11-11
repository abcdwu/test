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
    <figcaption><span>${label} · PDF 第 ${page} 页</span><a class="text-link" href="${esc(question.source.pdfPath)}#page=${page}" target="_blank" rel="noopener">打开原始 PDF ↗</a><a class="text-link" href="https://abcdwu-mbe-mistakes.fly.dev/${esc(question.source.pdfPath)}#page=${page}" target="_blank" rel="noopener">备用 PDF ↗</a></figcaption>
    <div class="pdf-page-surface" aria-label="${label}原文 PDF 第 ${page} 页">
      <p class="pdf-page-status" role="status">浏览到这里时载入原文页面…</p>
    </div>
  </figure>`).join('')}</div>`;
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
  return `<p class="question" data-question-id="${esc(question.id)}">${esc(question.stem)}</p>
    <div class="result-options">${question.choices.map((choice, index) => {
      const letter = 'ABCD'[index];
      return `<div class="ro ${letter === question.answer ? 'correct' : selected === letter ? 'wrong' : ''}">
        ${letter}. ${esc(choice)} ${letter === question.answer ? ' ✓ 正确答案' : selected === letter ? ' ✕ 你的答案' : ''}
      </div>`;
    }).join('')}</div>
    ${questionSource(question)}
    ${sourcePages(question, 'explanation').length
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
