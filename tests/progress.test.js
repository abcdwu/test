import test from 'node:test';
import assert from 'node:assert/strict';
import { MistakeStore, STORAGE_KEY, backupText } from '../mistake-store.js';
import { accuracy, createAttempt, mergeAttempts, summarizeAttempts } from '../progress.js';

const now = '2026-11-05T09:00:00Z';
const questions = count => Array.from({ length: count }, (_, index) => ({ id: `test-${index}`, subject: 'torts',
  stem: `Question ${index}`, choices: ['One', 'Two', 'Three', 'Four'], answer: 'A', explanation: 'Explanation' }));
const answers = (total, correct) => Array.from({ length: total }, (_, index) => index < correct ? 0 : null);
function store() {
  const data = new Map();
  return { data, core: new MistakeStore({ getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }) };
}

test('10 questions with 8 correct then 20 with 10 correct is 18/30 = 60%, including repeats and blanks', () => {
  const { core } = store();
  const first = createAttempt(questions(10), answers(10, 8), 'first', now);
  core.recordSession(questions(10), answers(10, 8), first);
  assert.equal(accuracy(...[first.correct, first.total]), '80.0%');
  const second = createAttempt(questions(20), answers(20, 10), 'second', now);
  core.recordSession(questions(20), answers(20, 10), second);
  assert.deepEqual(summarizeAttempts(core.readAttempts()), { correct: 18, total: 30, sessions: 2 });
  assert.equal(accuracy(18, 30), '60.0%');
  core.recordSession(questions(20), answers(20, 10), second);
  assert.equal(core.readAttempts().length, 2);
  assert.equal(core.read().find(entry => entry.question.id === 'test-19').wrongCount, 1);
});

test('perfect sessions persist without any wrong entries; progress survives backup and repeated cloud merges', () => {
  const { core } = store();
  const attempt = createAttempt(questions(5), answers(5, 5), 'perfect', now);
  core.recordSession(questions(5), answers(5, 5), attempt);
  assert.deepEqual(core.read(), []);
  const restored = store().core;
  const backup = backupText(core.read(), core.readAttempts());
  restored.restore(backup); restored.restore(backup); restored.mergeAttempts([attempt]);
  restored.merge([]); restored.refreshQuestions(questions(5));
  assert.deepEqual(summarizeAttempts(restored.readAttempts()), { correct: 5, total: 5, sessions: 1 });
  assert.equal(accuracy(0, 0), '—');
});

test('legacy wrong books do not invent past correct counts and malformed or conflicting progress is rejected atomically', () => {
  const { core, data } = store();
  core.record(questions(1), [null], now);
  assert.deepEqual(core.readAttempts(), []);
  const good = createAttempt(questions(5), answers(5, 3), 'once', now);
  core.recordSession(questions(5), answers(5, 3), good);
  const before = data.get(STORAGE_KEY);
  const bad = { ...good, correct: 4, subjects: [{ subject: 'torts', correct: 4, total: 5 }] };
  assert.throws(() => core.mergeAttempts([bad]));
  assert.equal(data.get(STORAGE_KEY), before);
  assert.throws(() => core.restore(JSON.stringify({ format: 'mbe-mistakes', version: 1, entries: [], attempts: [{ ...good, total: 0 }] })));
  assert.equal(data.get(STORAGE_KEY), before);
  assert.equal(mergeAttempts([good], [{ subjects: good.subjects, total: good.total, correct: good.correct, completedAt: now, id: good.id }]).length, 1);
});

test('a failed write cannot count a session or change wrong counts; retry counts it once', () => {
  const { core, data } = store();
  const attempt = createAttempt(questions(5), answers(5, 2), 'retry', now);
  const failing = new MistakeStore({ getItem: key => data.get(key) ?? null, setItem: () => { throw new Error('Full'); } });
  assert.throws(() => failing.recordSession(questions(5), answers(5, 2), attempt));
  assert.deepEqual(core.read(), []); assert.deepEqual(core.readAttempts(), []);
  core.recordSession(questions(5), answers(5, 2), attempt);
  core.recordSession(questions(5), answers(5, 2), attempt);
  assert.equal(core.readAttempts().length, 1); assert.ok(core.read().every(entry => entry.wrongCount === 1));
});
