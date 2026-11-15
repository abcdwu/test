import test from 'node:test';
import assert from 'node:assert/strict';
import { translateQuestion, translateEnglish, translationSegments } from '../question-translation.js';

test('translation uses UTF-8-bounded segments and keeps the original English intact', () => {
  const original = 'A purchaser signed a contract. '.repeat(45);
  const segments = translationSegments(original);
  assert.ok(segments.length > 1);
  assert.ok(segments.every(piece => new TextEncoder().encode(piece).length <= 450));
  assert.equal(segments.join(' '), original.trim().replace(/\s+/g, ' '));
  assert.ok(translationSegments('法律 terms '.repeat(80)).every(piece => new TextEncoder().encode(piece).length <= 450));
  assert.deepEqual(translationSegments(''), []);
});

test('one click translates stem and A-D separately without sending the correct answer or explanation', async () => {
  const queries = [];
  const fakeFetch = async uri => {
    const url = new URL(uri);
    assert.equal(url.hostname, 'api.mymemory.translated.net');
    assert.equal(url.searchParams.get('langpair'), 'en|zh-CN');
    queries.push(url.searchParams.get('q'));
    return { ok: true, json: async () => ({ responseStatus: 200,
      responseData: { translatedText: '中译 ' + url.searchParams.get('q') } }) };
  };
  const question = { id: 't-translation', stem: 'What is the rule for negligence?',
    choices: ['Duty', 'Breach', 'Causation', 'Damages'],
    answer: 'C', explanation: 'TOP SECRET EXPLANATION' };
  const result = await translateQuestion(question, { fetcher: fakeFetch });
  assert.equal(result.stem, '中译 ' + question.stem);
  assert.deepEqual(result.choices, question.choices.map(choice => '中译 ' + choice));
  assert.deepEqual(queries, [question.stem, ...question.choices]);
  assert.ok(!queries.includes(question.answer) && !queries.join(' ').includes(question.explanation));
  assert.equal(question.stem, 'What is the rule for negligence?');
  assert.equal((await translateQuestion(question, { fetcher: fakeFetch })).stem, result.stem);
  assert.equal(queries.length, 5, 'repeat displays use session cache');
});

test('translation API errors are surfaced rather than displaying incorrect or missing Chinese', async () => {
  await assert.rejects(() => translateEnglish('A different phrase', {
    fetcher: async () => ({ ok: true, json: async () => ({ responseStatus: 429, responseDetails: 'Quota exceeded' }) }),
  }), /额度已用尽/);
});
