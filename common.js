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

export function subjectOptions(selected, questions) {
  return [{ id: 'all', label: '全部科目' }, ...SUBJECTS].map(subject => {
    const available = filterSubject(questions, subject.id).length;
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

export async function loadBank() {
  const [sourceResponse, metadataResponse] = await Promise.all([
    fetch('questions.txt'), fetch('question-metadata.json?v=2'),
  ]);
  if (!sourceResponse.ok || !metadataResponse.ok) throw new Error('题库载入失败，请刷新页面重试。');
  const [source, metadata] = await Promise.all([sourceResponse.text(), metadataResponse.json()]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== metadata.bankSha256) throw new Error('题库与科目数据版本不一致，请刷新页面重试。');
  const bytes = Uint8Array.from(atob(source), character => character.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const questions = JSON.parse(await new Response(stream).text());
  if (questions.length !== metadata.questions.length) throw new Error('科目数据不完整。');
  return questions.map((question, index) => ({ ...question, ...metadata.questions[index] }));
}

export function reviewQuestion(question, selected) {
  return `<p class="question">${esc(question.stem)}</p>
    <div class="result-options">${question.choices.map((choice, index) => {
      const letter = 'ABCD'[index];
      return `<div class="ro ${letter === question.answer ? 'correct' : selected === letter ? 'wrong' : ''}">
        ${letter}. ${esc(choice)} ${letter === question.answer ? ' ✓ 正确答案' : selected === letter ? ' ✕ 你的答案' : ''}
      </div>`;
    }).join('')}</div>
    <div class="explain"><strong>原文解析</strong>\n\n${esc(question.explanation)}</div>`;
}
