import { answerLetter, SUBJECTS } from './common.js';

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
    wrongCount: legacyCount + Object.values(deviceCounts).reduce((sum, count) => sum + count, 0),
    firstWrongAt: Date.parse(incoming.firstWrongAt) < Date.parse(previous.firstWrongAt)
      ? incoming.firstWrongAt : previous.firstWrongAt,
  };
}

export function backupText(entries) {
  validateEntries(entries);
  return JSON.stringify({
    format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), entries,
  }, null, 2);
}

export function parseBackup(text) {
  const data = JSON.parse(text);
  if (data?.format !== BACKUP_FORMAT || data.version !== 1) throw new Error('请选择 MBE 错题本导出的备份文件');
  validateEntries(data.entries);
  return data.entries;
}

export function downloadBackup(entries) {
  const url = URL.createObjectURL(new Blob([backupText(entries)], { type: 'application/json' }));
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

  read() {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const data = JSON.parse(raw);
    if (data?.version !== 1) {
      throw new Error('错题本数据无法读取');
    }
    validateEntries(data.entries);
    return data.entries;
  }

  restore(text) {
    return this.merge(parseBackup(text));
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
    this.storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, entries: [...entries.values()] }));
    return { added: entries.size - before, total: entries.size };
  }

  record(questions, answers, now = new Date().toISOString()) {
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
    // Never replace unreadable data. setItem is atomic if storage is full or disabled.
    this.storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, entries: [...entries.values()] }));
    return added;
  }
}

