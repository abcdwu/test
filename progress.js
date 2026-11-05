import { answerLetter, SUBJECTS } from './common.js?v=3';

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
    ids.add(attempt.id);
  }
}

export function createAttempt(questions, answers, id = crypto.randomUUID(), completedAt = new Date().toISOString()) {
  const counts = new Map();
  for (const [index, question] of questions.entries()) {
    const value = counts.get(question.subject) ?? { subject: question.subject, correct: 0, total: 0 };
    value.total++; if (answerLetter(answers[index]) === question.answer) value.correct++;
    counts.set(question.subject, value);
  }
  const attempt = { id, completedAt, correct: [...counts.values()].reduce((sum, item) => sum + item.correct, 0),
    total: questions.length, subjects: [...counts.values()] };
  validateAttempts([attempt]); return attempt;
}

export function mergeAttempts(previous, incoming) {
  validateAttempts(previous); validateAttempts(incoming);
  const merged = new Map(previous.map(attempt => [attempt.id, attempt]));
  for (const attempt of incoming) {
    const existing = merged.get(attempt.id);
    if (existing && !sameAttempt(existing, attempt)) throw new Error('同一次练习的统计不一致');
    merged.set(attempt.id, attempt);
  }
  const result = [...merged.values()]; validateAttempts(result); return result;
}

export function sameAttempt(left, right) {
  const signature = attempt => JSON.stringify([attempt.id, attempt.completedAt, attempt.correct, attempt.total,
    attempt.subjects.map(item => [item.subject, item.correct, item.total]).sort((a, b) => a[0].localeCompare(b[0]))]);
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
