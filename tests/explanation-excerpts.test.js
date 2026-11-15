import test from 'node:test';
import assert from 'node:assert/strict';
import { explanationExcerpts, questionSource } from '../common.js';
test('option excerpts preserve explicit source blocks without mistaking inline references for headings', () => {
  const text = 'Main analysis (Choice A).\nMore main text.\n\n(Choice B) Exact wrong-option reason.\nSecond line.\n\n(Choices C and D) Shared exact reason.\n\nEducational objective:\nRule summary.\nReferences\nCitation.';
  const parsed = explanationExcerpts(text);
  assert.equal(parsed.main, 'Main analysis (Choice A).\nMore main text.');
  assert.equal(parsed.options.B[0], '(Choice B) Exact wrong-option reason.\nSecond line.');
  assert.deepEqual(parsed.options.C, ['(Choices C and D) Shared exact reason.']); assert.deepEqual(parsed.options.C, parsed.options.D); assert.deepEqual(parsed.options.A, []);
  assert.equal(explanationExcerpts('Main prose mentions (Choice B) inline without a heading.'), null);
  assert.equal(explanationExcerpts('Unlabelled explanation.'), null);
});
test('question previews do not expose the answer analysis or explanation-page links', () => {
  const question = { id: 'q', subject: 'torts', answer: 'B', explanation: '(Choice A) Wrong reason', source: { pdfPath: 'sources/torts.pdf', questionPages: [11], explanationPages: [12, 13] } };
  const html = questionSource(question); assert.ok(!html.includes('Wrong reason')); assert.ok(!html.includes('option-analysis')); assert.ok(!html.includes('pages=12'));
});
