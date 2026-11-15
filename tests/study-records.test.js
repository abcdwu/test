import test from 'node:test';
import assert from 'node:assert/strict';
import { studyChange, studyValue, mergeStudy, validateStudy } from '../study-core.js';
import { MistakeStore, backupText } from '../mistake-store.js';
import { createAttempt } from '../progress.js';
const blank = { questionId: 'sample', subject: 'torts', revisions: [] };
const question = { id: 'sample', subject: 'torts', stem: 'The facts.', choices: ['One', 'Two', 'Three', 'Four'], answer: 'A', explanation: 'Original explanation.' };
test('offline notebook edits and cards merge deterministically, retaining every saved version', () => {
  const a = studyChange(blank, 'note', 'First offline note', 'a'), b = studyChange(blank, 'note', 'Other offline note', 'b');
  const merged = mergeStudy([a], [b]); assert.deepEqual(merged, mergeStudy([b], [a])); assert.equal(merged[0].revisions.length, 2);
  const card = studyChange(merged[0], 'card', { front: 'What rule?', back: 'Rule from source.' }, 'card');
  const clear = studyChange(card, 'note', '', 'clear');
  assert.equal(studyValue(mergeStudy([clear], [a])[0], 'note'), '');
  assert.equal(clear.revisions.filter(edit => edit.kind === 'note').length, 3); assert.deepEqual(studyValue(clear, 'card'), { front: 'What rule?', back: 'Rule from source.' });
  assert.deepEqual(mergeStudy([clear], [clear]), [clear]);
});
test('notebook backup/restore and unrelated quiz writes preserve notes, cards and exam metadata', () => {
  const values = new Map(), store = () => new MistakeStore({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  const core = store(); core.saveStudy(question, 'note', '<my private note>'); core.saveStudy(question, 'card', { front: 'Front', back: 'Back' });
  const attempt = createAttempt([question], [0], 'exam', undefined, { startedAt: new Date(Date.now() - 1000).toISOString(), durationSeconds: 1, source: 'bank', timerMode: 'natural', studyMode: 'tutor', flags: [true], excluded: [[1, 2]], rounds: { torts: 1 } });
  core.recordSession([question], [0], attempt); core.recordSession([question], [0], attempt); core.merge([]); core.mergeHighlights([]);
  const exported = backupText(core.read(), core.readAttempts(), core.readHighlights(), core.readStudy());
  const other = new Map(), restored = new MistakeStore({ getItem: key => other.get(key) ?? null, setItem: (key, value) => other.set(key, value) });
  restored.restore(exported); restored.restore(exported); assert.deepEqual(restored.readStudy(), core.readStudy()); assert.equal(restored.readAttempts().length, 1);
  assert.equal(restored.readAttempts()[0].details.studyMode, 'tutor'); assert.equal(restored.readAttempts()[0].details.questions[0].flagged, true);
  assert.deepEqual(restored.readAttempts()[0].details.questions[0].excluded, [1, 2]);
  const before = other.get('mbe.mistakes.v1'), bad = structuredClone(core.readStudy()); bad[0].revisions[0].value = 'Tampered';
  assert.throws(() => restored.mergeStudy(bad)); assert.equal(other.get('mbe.mistakes.v1'), before);
});
test('malformed notes and duplicate or conflicting revisions are rejected', () => {
  const good = studyChange(blank, 'note', 'Valid', 'valid');
  for (const change of [r => r.subject = 'other', r => r.revisions[0].clock = -1, r => r.revisions[0].kind = 'html', r => r.revisions[0].value = {}, r => r.revisions.push(r.revisions[0])]) {
    const bad = structuredClone(good); change(bad); assert.throws(() => validateStudy([bad]));
  }
  assert.throws(() => studyChange(good, 'card', { front: 'Only front' }, 'bad-card'));
});
