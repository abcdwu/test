import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { MistakeStore } from '../mistake-store.js';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const manifest = read('../sources/manifest.json');
const coverage = read('../audit/source-coverage.json');
const identities = read('../audit/legacy-id-map.json').questions;
const bank = JSON.parse(gunzipSync(Buffer.from(readFileSync(new URL('../questions.txt', import.meta.url), 'utf8'), 'base64')));
const sourceKey = question => `${question.source.document}:${question.source.questionNumber}`;
const bySource = new Map(bank.map(question => [sourceKey(question), question]));

test('every original PDF has exact byte identity and every complete question appears once', () => {
  assert.equal(bySource.size, bank.length);
  assert.equal(bank.length, manifest.documents.reduce((sum, source) => sum + source.completeQuestions, 0));
  for (const source of manifest.documents) {
    assert.equal(createHash('sha256').update(readFileSync(new URL('../' + source.path, import.meta.url))).digest('hex'), source.sha256);
    for (let number = 1; number <= source.completeQuestions; number++) {
      const question = bySource.get(`${source.id}:${number}`);
      assert.ok(question, `${source.id} question ${number} missing`);
      assert.equal(question.source.sha256, source.sha256);
      assert.equal(question.source.pdfPath, source.path);
      assert.equal(question.choices.length, 4);
      assert.ok(question.choices.every(Boolean));
      assert.deepEqual(question.answerEvidence.excludedChoices, [...'ABCD'].filter(letter => letter !== question.answer));
      for (const citation of question.answerEvidence.citations) {
        assert.ok(question.source.explanationPages.includes(citation.page));
        assert.ok(question.source.explanationPages.includes(citation.endPage));
      }
    }
  }
});

test('all 5,357 original pages have explicit owners, including charts and a cross-file overlap', () => {
  assert.equal(coverage.sourcePages, 5357);
  for (const source of coverage.documents) {
    assert.equal(source.pageCoverage.length, source.pages);
    assert.deepEqual(source.pageCoverage.map(page => page.page), Array.from({ length: source.pages }, (_, index) => index + 1));
    for (const page of source.pageCoverage) {
      if (page.kind === 'document-overlap') {
        assert.equal(source.document, 'evidence');
        assert.equal(page.page, 785);
        assert.ok(bySource.has(`${page.document}:${page.questionNumber}`));
        continue;
      }
      const question = bySource.get(`${source.document}:${page.questionNumber}`);
      assert.ok(question);
      const field = page.kind === 'question' ? 'questionPages' : 'explanationPages';
      assert.ok(question.source[field].includes(page.page));
    }
  }
  assert.ok(bySource.get('torts:2').source.explanationPages.includes(5), 'image-only flowchart omitted');
  assert.ok(bySource.get('civil-procedure:79').source.explanationPages.includes(239), 'bilingual table omitted');
});

test('legacy wrong-book IDs survive, and distinct same-prefix questions are not deduplicated', () => {
  assert.equal(Object.keys(identities).length, 1635);
  for (const [key, identity] of Object.entries(identities)) assert.equal(bySource.get(key)?.id, identity.id);
  assert.equal(bank.length - Object.keys(identities).length, 168);
  for (const [left, right] of [[145, 167], [33, 182], [54, 203], [173, 242], [220, 257]]) {
    const a = bySource.get(`contracts:${left}`), b = bySource.get(`contracts:${right}`);
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.answer, b.answer);
  }
  assert.equal(bySource.get('torts:79').answer, 'C');
  assert.equal(bySource.get('criminal-procedure:58').choices[0], 'No.');
  assert.ok(bySource.get('criminal-law:32').answerEvidence.citations.some(item => item.page !== item.endPage));
});

test('old mistake snapshots acquire source pages without changing their history or count', () => {
  const values = new Map();
  const store = new MistakeStore({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  const current = bySource.get('torts:1');
  const legacy = { ...current };
  delete legacy.source;
  delete legacy.answerEvidence;
  store.record([legacy], [null], '2026-11-05T06:00:00Z');
  assert.equal(store.refreshQuestions([current]), 1);
  assert.equal(store.read()[0].wrongCount, 1);
  assert.equal(store.read()[0].firstWrongAt, '2026-11-05T06:00:00Z');
  assert.deepEqual(store.read()[0].question.source, current.source);
  const laterLegacy = { ...store.read()[0], question: legacy, lastWrongAt: '2026-11-05T07:00:00Z' };
  store.merge([laterLegacy]);
  assert.deepEqual(store.read()[0].question.source, current.source);
  assert.equal(store.read()[0].lastWrongAt, '2026-11-05T07:00:00Z');
  assert.equal(store.refreshQuestions([current]), 0);
});
