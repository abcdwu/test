// Append-only notebook revisions preserve edits from offline devices and backups.
import { SUBJECTS } from './common.js?v=11';
const subjects = new Set(SUBJECTS.map(item => item.id));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const order = (a, b) => a.clock - b.clock || compare(a.id, b.id);
export function validateStudy(records) {
  if (!Array.isArray(records) || records.length > 10000) throw new Error('笔记格式不正确');
  const keys = new Set(), revisions = new Set();
  for (const record of records) {
    if (!record || typeof record.questionId !== 'string' || !record.questionId.length || record.questionId.length > 160
      || keys.has(record.questionId) || !subjects.has(record.subject) || !Array.isArray(record.revisions) || record.revisions.length > 10000) throw new Error('笔记格式不正确');
    keys.add(record.questionId);
    for (const edit of record.revisions) {
      if (!edit || typeof edit.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(edit.id) || revisions.has(edit.id)
        || !Number.isSafeInteger(edit.clock) || edit.clock < 1 || !Number.isFinite(Date.parse(edit.updatedAt))
        || !['note', 'card'].includes(edit.kind)) throw new Error('笔记版本格式不正确');
      if (edit.kind === 'note' ? typeof edit.value !== 'string' || edit.value.length > 30000
        : edit.value !== null && (!edit.value || typeof edit.value.front !== 'string' || edit.value.front.length > 200000
          || typeof edit.value.back !== 'string' || edit.value.back.length > 400000)) throw new Error('笔记内容格式不正确');
      revisions.add(edit.id);
    }
  }
}
export function mergeStudy(previous, incoming) {
  validateStudy(previous); validateStudy(incoming);
  const merged = new Map(previous.map(record => [record.questionId, record]));
  for (const record of incoming) {
    const old = merged.get(record.questionId);
    if (old && old.subject !== record.subject) throw new Error('笔记科目不一致');
    const edits = new Map((old?.revisions || []).map(edit => [edit.id, edit]));
    for (const edit of record.revisions) {
      const prior = edits.get(edit.id);
      if (prior && JSON.stringify([prior.clock, prior.kind, prior.value, prior.updatedAt]) !== JSON.stringify([edit.clock, edit.kind, edit.value, edit.updatedAt])) throw new Error('笔记版本冲突');
      edits.set(edit.id, edit);
    }
    merged.set(record.questionId, { questionId: record.questionId, subject: record.subject, revisions: [...edits.values()].sort(order) });
  }
  const result = [...merged.values()].sort((a, b) => compare(a.questionId, b.questionId)); validateStudy(result); return result;
}
export function studyValue(record, kind) { return record?.revisions.filter(edit => edit.kind === kind).sort(order).at(-1)?.value ?? (kind === 'note' ? '' : null); }
export function studyChange(record, kind, value, id = crypto.randomUUID(), updatedAt = new Date().toISOString()) {
  const edit = { id, clock: Math.max(0, ...record.revisions.map(edit => edit.clock)) + 1, kind, value, updatedAt };
  return mergeStudy([record], [{ ...record, revisions: [edit] }])[0];
}
