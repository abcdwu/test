import test from 'node:test';
import assert from 'node:assert/strict';
import { MistakeStore, backupText } from '../mistake-store.js';
import { createAttempt, mergeAttempts, validateAttempts, remainingPool, roundProgress, historyMarkup } from '../progress.js';
const startedAt = '2026-11-11T08:00:00Z', completedAt = '2026-11-11T08:02:03Z';
const qs = Array.from({ length: 12 }, (_, i) => ({ id: `torts-${i}`, subject: 'torts', stem: `Stem ${i}`,
  choices: ['A', 'B', 'C', 'D'], answer: 'A', explanation: 'Explanation' }));
function attempt(questions, answers, id, round = 1, source = 'bank') {
  return createAttempt(questions, answers, id, completedAt, { startedAt, durationSeconds: 123, source,
    rounds: Object.fromEntries(questions.map(q => [q.subject, round])) });
}
function store() {
  const values = new Map();
  return new MistakeStore({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
}

test('history preserves start/time/count and numeric wrong indexes, including blanks, across backup and legacy merges', () => {
  const record = attempt(qs.slice(0, 5), [0, 1, 0, null, 2], 'history');
  const core = store(); core.recordSession(qs.slice(0, 5), [0, 1, 0, null, 2], record);
  const restored = store(); restored.restore(backupText(core.read(), core.readAttempts()));
  restored.restore(backupText(core.read(), core.readAttempts()));
  assert.deepEqual(restored.readAttempts(), [record]);
  const markup = historyMarkup(restored.readAttempts());
  assert.match(markup, /02:03/); assert.match(markup, /class="wrong-numbers">2、4、5</);
  assert.equal(record.details.startedAt, startedAt); assert.equal(record.total, 5);
  const { details, ...legacy } = record;
  assert.deepEqual(mergeAttempts([record], [legacy]), [record]);
  assert.deepEqual(mergeAttempts([legacy], [record]), [record]);
  assert.match(historyMarkup([legacy]), /class="wrong-numbers">—</);
  const changed = structuredClone(record); changed.details.questions[0].id = 'different';
  assert.throws(() => mergeAttempts([record], [changed]));
});

test('the remaining two questions are returned without repeats or mixing rounds, then a full new round begins', () => {
  const first = attempt(qs.slice(0, 5), Array(5).fill(null), 'first');
  const next = remainingPool(qs, [first]);
  assert.deepEqual(next.questions, qs.slice(5)); assert.equal(next.rounds.torts, 1);
  const second = attempt(qs.slice(5, 10), Array(5).fill(0), 'second');
  const tail = remainingPool(qs, [first, second]);
  assert.deepEqual(tail.questions, qs.slice(10)); assert.equal(tail.nextRound, false);
  const third = attempt(qs.slice(10), [0, 0], 'third');
  const complete = remainingPool(qs, [first, second, third]);
  assert.equal(complete.nextRound, true); assert.equal(complete.rounds.torts, 2);
  assert.deepEqual(complete.questions, qs);
  const fourth = attempt([qs[7]], [0], 'fourth', 2);
  const pool = remainingPool(qs, [fourth, third, first, second]);
  assert.equal(pool.questions.length, 11); assert.ok(!pool.questions.some(q => q.id === qs[7].id));
});

test('mixed practice shares subject progress, completed subjects wait, and wrong-book practice has a separate round', () => {
  const contracts = { ...qs[0], id: 'contracts-0', subject: 'contracts' };
  const done = attempt(qs, Array(12).fill(0), 'torts-done');
  const mixed = remainingPool([...qs, contracts], [done]);
  assert.deepEqual(mixed.questions, [contracts]);
  const review = attempt([contracts], [null], 'wrong-review', 1, 'mistakes');
  assert.deepEqual(remainingPool([...qs, contracts], [done, review]).questions, [contracts]);
  assert.equal(remainingPool([contracts], [review], 'mistakes').rounds.contracts, 2);
  const progress = roundProgress([done, done], { torts: 12 });
  assert.equal(progress.completed, 12); assert.equal(progress.remaining, 0);
  // Historic totals have no question IDs; they remain visible without inventing exclusions.
  const legacy = createAttempt(qs, Array(12).fill(0), 'old', completedAt);
  assert.deepEqual(remainingPool(qs, [legacy]).questions, qs);
});

test('malformed detail records and results that disagree with answers are rejected atomically', () => {
  const good = attempt(qs.slice(0, 2), [0, null], 'valid');
  for (const change of [
    d => { d.durationSeconds = -1; }, d => { d.startedAt = 'invalid'; },
    d => { d.questions[0].number = 5; }, d => { d.questions[1].id = d.questions[0].id; },
    d => { d.questions[0].round = 0; }, d => { d.questions[1].round = 2; },
    d => { d.questions[0].correct = false; },
  ]) {
    const bad = structuredClone(good); change(bad.details);
    assert.throws(() => validateAttempts([bad]));
  }
  const core = store();
  assert.throws(() => core.recordSession(qs.slice(0, 2), [null, 0], good));
  assert.deepEqual(core.readAttempts(), []); assert.deepEqual(core.read(), []);
});
