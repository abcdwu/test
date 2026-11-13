export const HIGHLIGHT_PREFIX = 'mbe-highlights:v1:';
export const highlightKey = record => JSON.stringify([record.questionId, record.text]);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function mergeRanges(ranges, length) {
  const sorted = ranges.filter(range => Array.isArray(range) && range.length === 2
    && Number.isInteger(range[0]) && Number.isInteger(range[1])
    && range[0] >= 0 && range[0] < range[1] && range[1] <= length)
    .map(range => [...range]).sort((a, b) => a[0] - b[0]);
  const result = [];
  for (const range of sorted) {
    const last = result.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else result.push(range);
  }
  return result;
}

export function removeRange(ranges, [start, end]) {
  return ranges.flatMap(([left, right]) => {
    if (right <= start || left >= end) return [[left, right]];
    return [...(left < start ? [[left, start]] : []), ...(right > end ? [[end, right]] : [])];
  });
}

export function validateHighlights(records) {
  if (!Array.isArray(records) || records.length > 10000) throw new Error('高亮记录格式不正确');
  const keys = new Set();
  for (const record of records) {
    if (!record || typeof record.questionId !== 'string' || !record.questionId.length || record.questionId.length > 160
      || typeof record.text !== 'string' || !record.text.length || record.text.length > 100000
      || !Array.isArray(record.operations) || record.operations.length > 20000
      || keys.has(highlightKey(record))) throw new Error('高亮记录格式不正确');
    keys.add(highlightKey(record));
    const ids = new Set();
    for (const operation of record.operations) {
      if (!operation || typeof operation.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(operation.id)
        || ids.has(operation.id) || !Number.isSafeInteger(operation.clock) || operation.clock < 0
        || (operation.id === 'legacy' ? operation.clock !== 0 || operation.action !== 'add' : operation.clock === 0)
        || !['add', 'remove'].includes(operation.action) || !Array.isArray(operation.ranges) || !operation.ranges.length
        || operation.ranges.length > record.text.length
        || JSON.stringify(mergeRanges(operation.ranges, record.text.length)) !== JSON.stringify(operation.ranges)) {
        throw new Error('高亮操作格式不正确');
      }
      if (operation.action === 'remove') {
        if (!Array.isArray(operation.targets) || !operation.targets.length || operation.targets.length > 20000
          || operation.targets.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id))
          || JSON.stringify([...new Set(operation.targets)].sort(compare)) !== JSON.stringify(operation.targets)) {
          throw new Error('高亮擦除范围格式不正确');
        }
      } else if (operation.targets !== undefined) throw new Error('高亮操作格式不正确');
      ids.add(operation.id);
    }
  }
}

export function mergeHighlights(previous, incoming) {
  validateHighlights(previous); validateHighlights(incoming);
  const records = new Map();
  for (const record of [...previous, ...incoming]) {
    const key = highlightKey(record), operations = new Map(records.get(key)?.operations.map(op => [op.id, op]) ?? []);
    for (const operation of record.operations) {
      const old = operations.get(operation.id);
      if (old && operation.id === 'legacy') operations.set('legacy', { ...old, ranges: mergeRanges([...old.ranges, ...operation.ranges], record.text.length) });
      else if (old && JSON.stringify([old.clock, old.action, old.ranges, old.targets]) !== JSON.stringify([operation.clock, operation.action, operation.ranges, operation.targets])) {
        throw new Error('同一次高亮操作内容不一致');
      } else operations.set(operation.id, operation);
    }
    records.set(key, { questionId: record.questionId, text: record.text,
      operations: [...operations.values()].sort((a, b) => a.clock - b.clock || compare(a.id, b.id)) });
  }
  const result = [...records.values()].sort((a, b) => compare(highlightKey(a), highlightKey(b)));
  validateHighlights(result); return result;
}

export function highlightRanges(record) {
  const additions = new Map(record.operations.filter(operation => operation.action === 'add').map(operation => [operation.id, operation.ranges]));
  for (const operation of record.operations) if (operation.action === 'remove') {
    for (const id of operation.targets) if (additions.has(id)) {
      additions.set(id, operation.ranges.reduce((value, range) => removeRange(value, range), additions.get(id)));
    }
  }
  return mergeRanges([...additions.values()].flat(), record.text.length);
}

export function highlightChange(record, action, ranges, id = crypto.randomUUID()) {
  const clock = Math.max(0, ...record.operations.map(op => op.clock)) + 1;
  const affected = mergeRanges(ranges, record.text.length);
  const operation = { id, clock, action, ranges: affected };
  // An erase removes observed additions only. Concurrent offline additions are
  // preserved, while the shared legacy seed can never revive an old mark.
  if (action === 'remove') operation.targets = [...new Set(['legacy', ...record.operations
    .filter(op => op.action === 'add' && op.ranges.some(([left, right]) => affected.some(([start, end]) => left < end && right > start)))
    .map(op => op.id)])].sort(compare);
  return mergeHighlights([record], [{ questionId: record.questionId, text: record.text,
    operations: [operation] }])[0];
}

// Old caches become an initial operation, ordered before any subsequent erase.
// Receiving an old device's cache later therefore cannot resurrect cleared text.
export function cachedHighlight(questionId, value) {
  if (!value || typeof value.text !== 'string' || !value.text.length) return null;
  const ranges = Array.isArray(value.ranges) ? mergeRanges(value.ranges, value.text.length) : [];
  const record = { questionId, text: value.text, operations: value.operations
    ?? (ranges.length ? [{ id: 'legacy', clock: 0, action: 'add', ranges }] : []) };
  validateHighlights([record]); return record;
}

export function cachedHighlights(storage) {
  const records = [];
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(HIGHLIGHT_PREFIX)) continue;
      try {
        const record = cachedHighlight(key.slice(HIGHLIGHT_PREFIX.length), JSON.parse(storage.getItem(key)));
        if (record?.operations.length) records.push(record);
      } catch { /* Ignore a damaged cache without overwriting it. */ }
    }
  } catch { /* IndexedDB remains usable when localStorage is disabled. */ }
  return mergeHighlights([], records);
}

// Clip a pen segment to the glyph rectangle. Testing the whole segment keeps
// fast strokes continuous even when the browser delivers few pointer events.
export function segmentHitsRect(from, to, rect, padding = 2) {
  if (Math.max(from.x, to.x) < rect.left - padding || Math.min(from.x, to.x) > rect.right + padding
    || Math.max(from.y, to.y) < rect.top - padding || Math.min(from.y, to.y) > rect.bottom + padding) return false;
  let enter = 0, exit = 1;
  for (const [axis, low, high] of [['x', rect.left - padding, rect.right + padding], ['y', rect.top - padding, rect.bottom + padding]]) {
    const delta = to[axis] - from[axis];
    if (delta === 0) { if (from[axis] < low || from[axis] > high) return false; continue; }
    const a = (low - from[axis]) / delta, b = (high - from[axis]) / delta;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return false;
  }
  return true;
}
