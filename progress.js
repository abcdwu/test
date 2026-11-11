import { answerLetter, SUBJECTS, esc, formatTime, subjectLabel } from './common.js?v=8';

const subjects = new Set(SUBJECTS.map(subject => subject.id));
const count = value => Number.isSafeInteger(value) && value >= 0;
export function validateAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length > 100000) throw new Error('练习统计格式不正确');
  const ids = new Set();
  for (const attempt of attempts) {
    if (!attempt || typeof attempt.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(attempt.id)
      || ids.has(attempt.id) || typeof attempt.completedAt !== 'string' || !Number.isFinite(Date.parse(attempt.completedAt))
      || !count(attempt.correct) || !count(attempt.total) || !attempt.total || attempt.total > 10000
      || attempt.correct > attempt.total || !Array.isArray(attempt.subjects) || !attempt.subjects.length) {
      throw new Error('练习统计格式不正确');
    }
    const seen = new Set(); let correct = 0, total = 0;
    for (const item of attempt.subjects) {
      if (!subjects.has(item.subject) || seen.has(item.subject) || !count(item.correct)
        || !count(item.total) || !item.total || item.correct > item.total) throw new Error('练习科目统计格式不正确');
      seen.add(item.subject); correct += item.correct; total += item.total;
    }
    if (correct !== attempt.correct || total !== attempt.total) throw new Error('练习统计总数不一致');
    if (attempt.details !== undefined) {
      const details = attempt.details;
      if (!details || !['bank', 'mistakes'].includes(details.source)
        || !['natural', 'countdown'].includes(details.timerMode)
        || typeof details.startedAt !== 'string' || !Number.isFinite(Date.parse(details.startedAt))
        || Date.parse(details.startedAt) > Date.parse(attempt.completedAt)
        || !count(details.durationSeconds) || !Array.isArray(details.questions)
        || details.questions.length !== attempt.total) throw new Error('练习记录格式不正确');
      const questions = new Set(), totals = new Map(), rounds = new Map();
      for (const [index, question] of details.questions.entries()) {
        if (!question || typeof question.id !== 'string' || !question.id.length || question.id.length > 160
          || questions.has(question.id) || !subjects.has(question.subject) || question.number !== index + 1
          || typeof question.correct !== 'boolean' || !Number.isSafeInteger(question.round) || question.round < 1
          || !(question.selected === null || /^[ABCD]$/.test(question.selected)) || question.selected === null && question.correct
          || rounds.has(question.subject) && rounds.get(question.subject) !== question.round) throw new Error('练习题目记录格式不正确');
        questions.add(question.id); rounds.set(question.subject, question.round);
        const value = totals.get(question.subject) ?? { total: 0, correct: 0 };
        value.total++; if (question.correct) value.correct++;
        totals.set(question.subject, value);
      }
      if (totals.size !== attempt.subjects.length || attempt.subjects.some(item => {
        const value = totals.get(item.subject);
        return !value || value.correct !== item.correct || value.total !== item.total;
      })) throw new Error('练习题目与成绩不一致');
    }
    ids.add(attempt.id);
  }
}

export function createAttempt(questions, answers, id = crypto.randomUUID(), completedAt = new Date().toISOString(), options = null) {
  const counts = new Map();
  for (const [index, question] of questions.entries()) {
    const value = counts.get(question.subject) ?? { subject: question.subject, correct: 0, total: 0 };
    value.total++; if (answerLetter(answers[index]) === question.answer) value.correct++;
    counts.set(question.subject, value);
  }
  const attempt = { id, completedAt, correct: [...counts.values()].reduce((sum, item) => sum + item.correct, 0),
    total: questions.length, subjects: [...counts.values()] };
  if (options) attempt.details = {
    startedAt: options.startedAt, durationSeconds: options.durationSeconds, source: options.source, timerMode: options.timerMode || 'natural',
    questions: questions.map((question, index) => ({ id: question.id, subject: question.subject, number: index + 1,
      selected: answerLetter(answers[index]), correct: answerLetter(answers[index]) === question.answer, round: options.rounds[question.subject] })),
  };
  validateAttempts([attempt]); return attempt;
}

export function mergeAttempts(previous, incoming) {
  validateAttempts(previous); validateAttempts(incoming);
  const merged = new Map(previous.map(attempt => [attempt.id, attempt]));
  for (const attempt of incoming) {
    const existing = merged.get(attempt.id);
    if (existing && !sameAttempt(existing, attempt)) {
      if (!sameAttempt({ ...existing, details: undefined }, { ...attempt, details: undefined })
        || existing.details && attempt.details) throw new Error('同一次练习的统计不一致');
    }
    merged.set(attempt.id, existing?.details ? existing : attempt);
  }
  const result = [...merged.values()]; validateAttempts(result); return result;
}

export function sameAttempt(left, right) {
  const signature = attempt => JSON.stringify([attempt.id, attempt.completedAt, attempt.correct, attempt.total,
    attempt.subjects.map(item => [item.subject, item.correct, item.total]).sort((a, b) => a[0].localeCompare(b[0])),
    attempt.details ? [attempt.details.startedAt, attempt.details.durationSeconds, attempt.details.source, attempt.details.timerMode,
      attempt.details.questions.map(item => [item.id, item.subject, item.number, item.selected, item.correct, item.round])] : null]);
  return signature(left) === signature(right);
}

export function summarizeAttempts(attempts, subject = 'all') {
  let correct = 0, total = 0, sessions = 0;
  for (const attempt of attempts) {
    const value = subject === 'all' ? attempt : attempt.subjects.find(item => item.subject === subject);
    if (!value) continue;
    correct += value.correct; total += value.total; sessions++;
  }
  return { correct, total, sessions };
}
export const accuracy = (correct, total) => total ? `${(correct / total * 100).toFixed(1)}%` : '—';

// Each subject and practice source has its own round. Only submitted sessions
// consume questions; using stable IDs also preserves progress after reordering.
export function roundProgress(attempts, counts, source = 'bank', validIds = null) {
  const bySubject = Object.fromEntries(Object.entries(counts).map(([subject, total]) => [subject, { round: 1, total, seen: new Set() }]));
  for (const attempt of attempts) {
    if (attempt.details?.source !== source) continue;
    for (const question of attempt.details.questions) {
      const state = bySubject[question.subject];
      if (!state || validIds && !validIds.has(question.id) || question.round < state.round) continue;
      if (question.round > state.round) { state.round = question.round; state.seen.clear(); }
      state.seen.add(question.id);
    }
  }
  const total = Object.values(bySubject).reduce((sum, state) => sum + state.total, 0);
  const completed = Object.values(bySubject).reduce((sum, state) => sum + Math.min(state.total, state.seen.size), 0);
  return { bySubject, total, completed, remaining: total - completed };
}

export function remainingPool(questions, attempts, source = 'bank') {
  const counts = {};
  for (const question of questions) counts[question.subject] = (counts[question.subject] ?? 0) + 1;
  const progress = roundProgress(attempts, counts, source, new Set(questions.map(question => question.id)));
  const nextRound = progress.total > 0 && progress.remaining === 0;
  const rounds = Object.fromEntries(Object.entries(progress.bySubject).map(([key, state]) => [key, state.round + (nextRound ? 1 : 0)]));
  return { questions: nextRound ? questions : questions.filter(question => !progress.bySubject[question.subject].seen.has(question.id)), rounds, nextRound };
}

export function historyMarkup(attempts, limit = 20) {
  const ordered = [...attempts].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt) || b.id.localeCompare(a.id));
  if (!ordered.length) return '<p class="sub">交卷后，这里会自动记录每次练习。</p>';
  return `<p class="note history-note">点击完成时间可反复回看当时题目与作答，不重复计分。错题数字为本次题号，未答计错。升级前未保存的用时与题号显示为 —，无法展开旧题目。</p>
    <table class="history-table"><thead><tr><th>完成时间</th><th>用时</th><th>题数</th><th>错题题号</th></tr></thead><tbody>${ordered.slice(0, limit).map(attempt => {
      const details = attempt.details;
      const numbers = details?.questions.filter(question => !question.correct).map(question => question.number).join('、') || '—';
      const time = `<time datetime="${esc(attempt.completedAt)}">${esc(new Date(attempt.completedAt).toLocaleString('zh-CN', { hour12: false }))}</time>`;
      return `<tr data-attempt-id="${esc(attempt.id)}"><td>${details ? `<button type="button" class="history-time" data-attempt-review="${esc(attempt.id)}">${time}</button>` : time}<small>${esc(attempt.subjects.length === 1 ? subjectLabel(attempt.subjects[0].subject) : '混合科目')}${details?.source === 'mistakes' ? ' · 错题重练' : ''}</small></td>
        <td>${details ? esc(formatTime(details.durationSeconds)) : '—'}</td><td>${attempt.total}</td><td class="wrong-numbers">${numbers}</td></tr>`;
    }).join('')}</tbody></table>
    ${ordered.length > limit ? '<button type="button" class="secondary" id="history-more">显示更多记录</button>' : ''}`;
}
