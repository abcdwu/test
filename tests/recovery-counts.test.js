import test from 'node:test';
import assert from 'node:assert/strict';
import { MistakeStore, backupText } from '../mistake-store.js';
import { createAttempt } from '../progress.js';
const q = { id: 'recover-q', subject: 'torts', stem: 'Facts', choices: ['One', 'Two', 'Three', 'Four'], answer: 'A', explanation: 'Original' };
function store() { const values = new Map(); return new MistakeStore({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }); }
test('restoring an emergency backup and retrying the same session merge as one wrong occurrence', () => {
  const attempt = createAttempt([q], [1], 'pending-session'), original = store(), restored = store();
  const emergency = { question: q, lastAnswer: 'B', wrongCount: 1, legacyCount: 0, deviceCounts: { [attempt.id]: 1 }, firstWrongAt: attempt.completedAt, lastWrongAt: attempt.completedAt };
  const text = backupText([emergency], [attempt]);
  restored.restore(text); original.recordSession([q], [1], attempt);
  restored.merge(original.read()); restored.mergeAttempts(original.readAttempts()); restored.restore(text);
  original.merge(restored.read()); original.mergeAttempts(restored.readAttempts());
  assert.equal(restored.read()[0].wrongCount, 1); assert.equal(original.read()[0].wrongCount, 1); assert.equal(restored.readAttempts().length, 1);
  const next = createAttempt([q], [2], 'next-session'); original.recordSession([q], [2], next); restored.merge(original.read()); assert.equal(restored.read()[0].wrongCount, 2);
});
test('per-session contributions preserve existing device-based and legacy wrong history', () => {
  const existing = store(), receiving = store(); existing.record([q], [1]); existing.record([q], [1]);
  const attempt = createAttempt([q], [1], 'future-session'); existing.recordSession([q], [1], attempt);
  receiving.merge(existing.read()); receiving.merge(existing.read()); assert.equal(receiving.read()[0].wrongCount, 3);
  const before = receiving.read()[0]; assert.equal(before.deviceCounts[attempt.id], 1); assert.equal(Object.values(before.deviceCounts).reduce((a, b) => a + b, 0), 3);
});
