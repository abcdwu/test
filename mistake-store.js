import { mergeHighlights, validateHighlights } from './highlight-core.js?v=1';
import { answerLetter, SUBJECTS } from './common.js?v=3';
import { createAttempt, mergeAttempts, sameAttempt, validateAttempts } from './progress.js?v=9';

export const STORAGE_KEY = 'mbe.mistakes.v1';
export const BACKUP_FORMAT = 'mbe-mistakes';
const DEVICE_KEY = 'mbe.device.v1';

function validEntry(entry) {
  const question = entry?.question;
  return typeof question?.id === 'string'
    && SUBJECTS.some(subject => subject.id === question.subject)
    && typeof question.stem === 'string' && typeof question.explanation === 'string'
    && Array.isArray(question.choices) && question.choices.length === 4
    && question.choices.every(choice => typeof choice === 'string')
    && /^[ABCD]$/.test(question.answer)
    && (entry.lastAnswer === null || /^[ABCD]$/.test(entry.lastAnswer))
    && Number.isSafeInteger(entry.wrongCount) && entry.wrongCount > 0
    && (entry.deviceCounts === undefined || (entry.deviceCounts && !Array.isArray(entry.deviceCounts)
      && typeof entry.deviceCounts === 'object'
      && Object.entries(entry.deviceCounts).every(([key, value]) => /^[a-zA-Z0-9-]{1,80}$/.test(key)
        && Number.isSafeInteger(value) && value > 0)))
    && (entry.legacyCount === undefined || (Number.isSafeInteger(entry.legacyCount) && entry.legacyCount >= 0))
    && (entry.deviceCounts === undefined || entry.wrongCount === (entry.legacyCount ?? 0)
      + Object.values(entry.deviceCounts).reduce((sum, value) => sum + value, 0))
    && Number.isFinite(Date.parse(entry.firstWrongAt)) && Number.isFinite(Date.parse(entry.lastWrongAt));
}

export function validateEntries(entries) {
  if (!Array.isArray(entries) || !entries.every(validEntry)
      || new Set(entries.map(entry => entry.question.id)).size !== entries.length) {
    throw new Error('错题本数据格式不正确');
  }
}

function counts(entry) {
  return { legacyCount: entry.legacyCount ?? (entry.deviceCounts ? 0 : entry.wrongCount), deviceCounts: entry.deviceCounts ?? {} };
}

export function mergeEntry(previous, incoming) {
  if (!previous) return incoming;
  const left = counts(previous), right = counts(incoming);
  const deviceCounts = { ...left.deviceCounts };
  for (const [device, count] of Object.entries(right.deviceCounts)) {
    deviceCounts[device] = Math.max(deviceCounts[device] ?? 0, count);
  }
  const legacyCount = Math.max(left.legacyCount, right.legacyCount);
  const latest = Date.parse(incoming.lastWrongAt) > Date.parse(previous.lastWrongAt) ? incoming : previous;
  return {
    ...latest, legacyCount, deviceCounts,
    // A newer attempt from an older device must not discard restored source
    // page references carried by the same question's current snapshot.
    question: latest.question.source ? latest.question
      : previous.question.source ? previous.question : incoming.question,
    wrongCount: legacyCount + Object.values(deviceCounts).reduce((sum, count) => sum + count, 0),
    firstWrongAt: Date.parse(incoming.firstWrongAt) < Date.parse(previous.firstWrongAt)
      ? incoming.firstWrongAt : previous.firstWrongAt,
  };
}

export function backupText(entries, attempts = [], highlights = []) {
  validateEntries(entries);
  validateAttempts(attempts); validateHighlights(highlights);
  return JSON.stringify({
    format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), entries, attempts, highlights,
  }, null, 2);
}

export function parseBackup(text) {
  return parseBackupData(text).entries;
}

export function parseBackupData(text) {
  const data = JSON.parse(text);
  if (data?.format !== BACKUP_FORMAT || data.version !== 1) throw new Error('请选择 MBE 错题本导出的备份文件');
  validateEntries(data.entries);
  validateAttempts(data.attempts ?? []);
  validateHighlights(data.highlights ?? []);
  return { entries: data.entries, attempts: data.attempts ?? [], highlights: data.highlights ?? [] };
}

export function downloadBackup(entries, attempts = [], highlights = []) {
  const url = URL.createObjectURL(new Blob([backupText(entries, attempts, highlights)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `MBE-错题备份-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class MistakeStore {
  constructor(storage) { this.storage = storage; }

  readData() {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (raw === null) return { version: 1, entries: [], attempts: [], highlights: [] };
    const data = JSON.parse(raw);
    if (data?.version !== 1) {
      throw new Error('错题本数据无法读取');
    }
    validateEntries(data.entries);
    validateAttempts(data.attempts ?? []);
    validateHighlights(data.highlights ?? []);
    return { version: 1, entries: data.entries, attempts: data.attempts ?? [], highlights: data.highlights ?? [] };
  }

  read() { return this.readData().entries; }
  readAttempts() { return this.readData().attempts; }
  readHighlights() { return this.readData().highlights; }
  write(entries, attempts = this.readAttempts(), highlights = this.readHighlights()) {
    validateEntries(entries); validateAttempts(attempts); validateHighlights(highlights);
    this.storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, entries, attempts, highlights }));
  }

  restore(text) {
    const data = parseBackupData(text), previous = this.readData();
    const attempts = mergeAttempts(previous.attempts, data.attempts);
    const entries = new Map(previous.entries.map(entry => [entry.question.id, entry]));
    for (const entry of data.entries) entries.set(entry.question.id, mergeEntry(entries.get(entry.question.id), entry));
    this.write([...entries.values()], attempts, mergeHighlights(previous.highlights, data.highlights));
    return { added: entries.size - previous.entries.length, total: entries.size };
  }

  merge(incoming) {
    validateEntries(incoming);
    const entries = new Map(this.read().map(entry => [entry.question.id, entry]));
    const before = entries.size;
    for (const entry of incoming) {
      const previous = entries.get(entry.question.id);
      if (!previous) { entries.set(entry.question.id, entry); continue; }
      entries.set(entry.question.id, mergeEntry(previous, entry));
    }
    this.write([...entries.values()]);
    return { added: entries.size - before, total: entries.size };
  }

  refreshQuestions(questions) {
    const current = new Map(questions.map(question => [question.id, question]));
    const entries = this.read();
    let updated = 0;
    const refreshed = entries.map(entry => {
      const question = current.get(entry.question.id);
      if (!question || JSON.stringify(question) === JSON.stringify(entry.question)) return entry;
      updated++;
      return { ...entry, question };
    });
    if (updated) this.write(refreshed);
    return updated;
  }

  recordEntries(questions, answers, now) {
    const entries = new Map(this.read().map(entry => [entry.question.id, entry]));
    let device = this.storage.getItem(DEVICE_KEY);
    if (!device) { device = crypto.randomUUID(); this.storage.setItem(DEVICE_KEY, device); }
    let added = 0;
    for (const [index, question] of questions.entries()) {
      const selected = answerLetter(answers[index]);
      if (selected === question.answer) continue;
      const previous = entries.get(question.id);
      const { legacyCount, deviceCounts: oldCounts } = previous ? counts(previous) : { legacyCount: 0, deviceCounts: {} };
      const deviceCounts = { ...oldCounts, [device]: (oldCounts[device] ?? 0) + 1 };
      entries.set(question.id, {
        question, lastAnswer: selected, wrongCount: (previous?.wrongCount ?? 0) + 1,
        legacyCount, deviceCounts,
        firstWrongAt: previous?.firstWrongAt ?? now, lastWrongAt: now,
      });
      added++;
    }
    return { entries: [...entries.values()], added };
  }

  record(questions, answers, now = new Date().toISOString()) {
    const result = this.recordEntries(questions, answers, now);
    this.write(result.entries); return result.added;
  }

  recordSession(questions, answers, attempt) {
    const options = attempt.details ? { ...attempt.details,
      rounds: Object.fromEntries(attempt.details.questions.map(question => [question.subject, question.round])) } : null;
    const expected = createAttempt(questions, answers, attempt.id, attempt.completedAt, options);
    if (!sameAttempt(expected, attempt)) throw new Error('练习成绩与作答不一致');
    const previous = this.readAttempts();
    const merged = mergeAttempts(previous, [attempt]);
    if (merged.length === previous.length) return questions.filter((question, index) => answerLetter(answers[index]) !== question.answer).length;
    const result = this.recordEntries(questions, answers, attempt.completedAt);
    this.write(result.entries, merged); return result.added;
  }

  mergeHighlights(incoming) {
    const previous = this.readData();
    this.write(previous.entries, previous.attempts, mergeHighlights(previous.highlights, incoming));
  }

  mergeAttempts(incoming) {
    const previous = this.readData();
    this.write(previous.entries, mergeAttempts(previous.attempts, incoming));
  }
}

