import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { SUBJECTS, QuizTimer, formatTime, filterSubject } from '../common.js';
import { backupText, parseBackup, MistakeStore, STORAGE_KEY } from '../mistake-store.js';

const source = readFileSync(new URL('../questions.txt', import.meta.url));
const metadata = JSON.parse(readFileSync(new URL('../question-metadata.json', import.meta.url)));
const bank = JSON.parse(gunzipSync(Buffer.from(source.toString(), 'base64')))
  .map((question, index) => ({ ...question, ...metadata.questions[index] }));

function memoryStorage() {
  const entries = new Map();
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
}

test('all source questions have distinct stable IDs and one of eight subjects', () => {
  assert.equal(bank.length, 1803);
  assert.equal(createHash('sha256').update(source).digest('hex'), metadata.bankSha256);
  assert.equal(metadata.questions.length, bank.length);
  assert.equal(new Set(bank.map(question => question.id)).size, bank.length);
  assert.equal(SUBJECTS.length, 8);
  for (const question of bank) {
    assert.ok(SUBJECTS.some(subject => subject.id === question.subject));
    assert.ok(question.source?.questionNumber > 0);
  }
  assert.deepEqual(Object.fromEntries(SUBJECTS.map(subject => [subject.id, filterSubject(bank, subject.id).length])), {
    'civil-procedure': 297, 'constitutional-law': 243, contracts: 273,
    'criminal-law': 165, 'criminal-procedure': 83, evidence: 265,
    'real-property': 248, torts: 229,
  });
  assert.equal(filterSubject(bank, 'all').length, bank.length);
});

test('natural timer uses elapsed wall time, including a delayed/background tick', () => {
  let now = 1000;
  const timer = new QuizTimer('natural', 5, () => now);
  assert.equal(formatTime(timer.displaySeconds), '00:00');
  now += 125_900;
  assert.equal(formatTime(timer.displaySeconds), '02:05');
  assert.equal(timer.expired, false);
  timer.stop();
  now += 60_000;
  assert.equal(timer.elapsedMs, 125_900);
});

test('countdown allows exactly 108 seconds per actual question and expires at zero', () => {
  let now = 1000;
  const timer = new QuizTimer('countdown', 2, () => now);
  assert.equal(formatTime(timer.displaySeconds), '03:36');
  now += 215_999;
  assert.equal(timer.expired, false);
  assert.equal(timer.displaySeconds, 1);
  now++;
  assert.equal(timer.expired, true);
  assert.equal(timer.displaySeconds, 0);
  now += 100_000;
  assert.equal(timer.displaySeconds, 0);
});

test('wrong and unanswered questions persist across store instances and deduplicate on retry', () => {
  const storage = memoryStorage();
  const store = new MistakeStore(storage);
  const questions = bank.slice(0, 3);
  const correct = 'ABCD'.indexOf(questions[0].answer);
  const wrong = ('ABCD'.indexOf(questions[1].answer) + 1) % 4;
  assert.equal(store.record(questions, [correct, wrong, null], '2026-11-05T06:00:00Z'), 2);
  let saved = new MistakeStore(storage).read();
  assert.equal(saved.length, 2);
  assert.equal(saved[1].lastAnswer, null);
  assert.equal(saved[0].lastAnswer, 'ABCD'[wrong]);
  assert.deepEqual(saved[0].question, questions[1]);
  store.record([questions[1]], [null], '2026-11-05T07:00:00Z');
  saved = store.read();
  assert.equal(saved.length, 2);
  assert.equal(saved[0].wrongCount, 2);
  assert.equal(saved[0].firstWrongAt, '2026-11-05T06:00:00Z');
  assert.equal(saved[0].lastWrongAt, '2026-11-05T07:00:00Z');
  store.record([questions[1]], ['ABCD'.indexOf(questions[1].answer)]);
  assert.equal(store.read()[0].wrongCount, 2);
});

test('storage failures leave old records intact, and malformed records are never overwritten', () => {
  const storage = memoryStorage();
  const store = new MistakeStore(storage);
  storage.setItem(STORAGE_KEY, '{broken');
  assert.throws(() => store.record([bank[0]], [null]));
  assert.equal(storage.getItem(STORAGE_KEY), '{broken');
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, entries: [{}] }));
  assert.throws(() => store.read());
  const unavailable = new MistakeStore({
    getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); },
  });
  assert.throws(() => unavailable.record([bank[0]], [null]), /QuotaExceededError/);
});

test('backup restores on a new browser and repeated imports merge without inflating counts', () => {
  const first = new MistakeStore(memoryStorage());
  first.record([bank[0]], [null], '2026-11-05T06:00:00Z');
  const oldBackup = backupText(first.read());
  first.record([bank[0], bank[1]], [null, null], '2026-11-05T07:00:00Z');
  const latestBackup = backupText(first.read());
  const second = new MistakeStore(memoryStorage());
  assert.deepEqual(second.restore(latestBackup), { added: 2, total: 2 });
  second.restore(latestBackup);
  second.restore(oldBackup);
  assert.equal(second.read().length, 2);
  assert.equal(second.read()[0].wrongCount, 2);
  assert.equal(second.read()[0].lastWrongAt, '2026-11-05T07:00:00Z');
  assert.equal(second.read()[0].firstWrongAt, '2026-11-05T06:00:00Z');
});

test('invalid backup is rejected before any existing data is written', () => {
  const storage = memoryStorage();
  const store = new MistakeStore(storage);
  store.record([bank[0]], [null]);
  const before = storage.getItem(STORAGE_KEY);
  assert.throws(() => store.restore('{"format":"another-app","version":1,"entries":[]}'));
  assert.equal(storage.getItem(STORAGE_KEY), before);
  const duplicate = store.read()[0];
  assert.throws(() => parseBackup(JSON.stringify({ format: 'mbe-mistakes', version: 1, entries: [duplicate, duplicate] })));
  assert.equal(storage.getItem(STORAGE_KEY), before);
});
