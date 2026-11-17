const { chromium } = require('playwright');
const { routeBank } = require('./bank-fixture.cjs');
const assert = require('node:assert/strict');
const origin = process.env.MBE_TEST_ORIGIN || 'http://127.0.0.1:8086';
const questions = Array.from({ length: 12 }, (_, index) => ({ id: 'workspace-' + index, subject: 'torts',
  stem: 'A landlord offered consideration for a lease. Which rule applies? ' + 'The tenant had agreed to the terms. '.repeat(5),
  choices: ['The agreement is supported by consideration.', 'No contract exists.', 'The tenant owes nothing.', 'The lease is void.'], answer: 'A', explanation: 'Original explanation: A is correct because consideration supports the agreement. B, C and D are incorrect under the stated facts.' }));
const store = page => page.evaluate(async () => { const { mistakeStore } = await import('/browser-store.js?v=14'); await mistakeStore.ready; return { attempts: mistakeStore.readAttempts(), study: mistakeStore.readStudy(), marks: mistakeStore.readHighlights() }; });
async function setup(browser, mobile = false) {
  const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 1050 } });
  await routeBank(context, questions); await context.route('**/cloud-config.json*', r => r.fulfill({ json: {} }));
  const page = await context.newPage(); await page.goto(origin); await page.locator('#start').waitFor(); return { context, page };
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const { context, page } = await setup(browser); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.locator('#study-mode').selectOption('exam'); await page.locator('#question-count').fill('3'); await page.locator('#start').click(); await page.locator('.exam-layout').waitFor();
    assert.equal(await page.locator('.explain').count(), 0, 'exam must not reveal answers before submission');
    assert.equal(await page.locator('#translate-question, .word-translation').count(), 0, 'translation UI must not interfere with text selection');
    assert.ok(await page.locator('.exam-sidebar').isVisible()); await page.locator('#flag-question').click();
    await page.locator('[data-choice="0"]').click(); assert.ok(await page.locator('[data-jump="0"]').getAttribute('class').then(s => s.includes('answered')));
    await page.locator('[data-exclude="0"]').click(); assert.equal(await page.locator('.option.selected').count(), 0);
    await page.locator('[data-choice="0"]').click(); assert.equal(await page.locator('.option.selected').count(), 0, 'eliminated option is not an answer');
    await page.locator('[data-exclude="0"]').click(); await page.locator('[data-choice="0"]').click(); await page.locator('[data-exclude="1"]').click();
    await page.locator('.choice-text').first().evaluate(el => { const range = document.createRange(); range.setStart(el.firstChild, 0); range.setEnd(el.firstChild, 13); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
    const choiceTools = page.locator('.option-row').first().locator('.choice-highlight-tools'); await choiceTools.locator('[data-highlight="add"]').click();
    assert.equal(await page.locator('.option-row').first().locator('mark').textContent(), 'The agreement'); assert.equal(await page.locator('.option.selected').count(), 1);
    await page.locator('#toggle-timer').click(); assert.equal(await page.locator('[role="timer"]').isVisible(), false);
    const beforeClock = await page.locator('#clock').textContent(); await page.waitForTimeout(2300); assert.notEqual(await page.locator('#clock').textContent(), beforeClock, 'hiding the clock does not pause the countdown');
    await page.screenshot({ path: '/tmp/mbe-exam-desktop.png', fullPage: true });
    await page.locator('[data-jump="2"]').click(); assert.match(await page.locator('.quiz-meta').textContent(), /3 \/ 3/); await page.locator('[data-choice="1"]').click();
    await page.locator('[data-jump="0"]').click(); assert.equal(await page.locator('[data-exclude="1"]').getAttribute('aria-pressed'), 'true'); assert.equal(await page.locator('#flag-question').getAttribute('aria-pressed'), 'true');
    page.once('dialog', dialog => dialog.accept()); await page.locator('#end-test').click(); await page.locator('#session-rate').waitFor(); assert.equal(await page.locator('#session-rate').textContent(), '33.3%');
    let saved = await store(page); assert.equal(saved.attempts.length, 1); assert.equal(saved.attempts[0].details.questions[0].flagged, true); assert.deepEqual(saved.attempts[0].details.questions[0].excluded, [1]);
    await page.locator('#report-filter').selectOption('flagged'); assert.equal(await page.locator('[data-result-index]:visible').count(), 1);
    await page.locator('#report-filter').selectOption('wrong'); assert.equal(await page.locator('[data-result-index]:visible').count(), 2);
    await page.locator('#again').click(); await page.locator('#study-mode').selectOption('tutor'); assert.equal(await page.locator('#timer-mode').inputValue(), 'natural'); assert.equal(await page.locator('#timer-mode').isDisabled(), true);
    await page.locator('#question-count').fill('2'); await page.locator('#start').click(); await page.locator('[data-choice="0"]').click(); assert.equal(await page.locator('.explain').count(), 0);
    await page.locator('#check-answer').click(); await page.locator('.tutor-feedback').waitFor(); assert.match(await page.locator('.feedback-verdict').textContent(), /回答正确/);
    await page.locator('[data-choice="1"]').dispatchEvent('click'); assert.equal(await page.locator('[data-choice="0"]').getAttribute('aria-pressed'), 'true');
    await page.locator('.study-tools > summary').click(); await page.locator('.study-note').fill('Consideration <private note>'); await page.locator('[data-save-note]').click();
    await page.getByText('笔记已保存在本机；登录后自动云同步。', { exact: true }).waitFor(); await page.locator('[data-make-card]').click(); await page.getByText(/闪卡已保存，含原始解析与图表入口/).waitFor();
    await page.locator('.study-note').fill('Autosaved when navigating'); await page.locator('#next').click(); await page.waitForFunction(() => document.querySelector('.quiz-meta')?.textContent.includes('2 / 2')); assert.equal((await store(page)).study[0].revisions.filter(edit => edit.kind === 'note').at(-1).value, 'Autosaved when navigating');
    await page.locator('[data-choice="1"]').click(); await page.locator('#check-answer').click(); assert.match(await page.locator('.feedback-verdict').textContent(), /回答错误/);
    await page.locator('#previous').click(); assert.match(await page.locator('.feedback-verdict').textContent(), /回答正确/); assert.equal(await page.locator('[data-choice="0"]').isDisabled(), true);
    await page.locator('#end-test').click(); await page.locator('#session-rate').waitFor(); assert.equal(await page.locator('#session-rate').textContent(), '50.0%'); saved = await store(page); assert.equal(saved.attempts.length, 2); assert.equal(saved.attempts[1].details.studyMode, 'tutor');
    const notebook = await context.newPage(); await notebook.goto(origin + '/notebook.html'); await notebook.locator('.notebook-item').waitFor(); assert.equal(await notebook.locator('.flashcard-back').isVisible(), false);
    await notebook.locator('.flashcard-answer summary').click(); assert.match(await notebook.locator('.flashcard-back').textContent(), /Original explanation/);
    await notebook.locator('.notebook-note').fill('Updated <script>alert(1)</script>'); await notebook.locator('[data-save-note]').click(); await notebook.getByText('笔记已保存，登录后自动云同步。', { exact: true }).waitFor();
    await notebook.reload(); assert.equal(await notebook.locator('.notebook-note').inputValue(), 'Updated <script>alert(1)</script>');
    await notebook.locator('.notebook-note').fill('Saved before changing filters'); await notebook.locator('#notebook-type').selectOption('cards'); assert.equal(await notebook.locator('.notebook-note').inputValue(), 'Saved before changing filters');
    await notebook.locator('.card-edit summary').click(); await notebook.locator('.card-front-input').fill('Recall prompt'); await notebook.locator('.card-back-input').fill('My reviewed rule'); await notebook.locator('[data-save-card]').click(); await notebook.getByText('闪卡已保存。', { exact: true }).waitFor(); assert.equal(await notebook.locator('.flashcard-front').textContent(), 'Recall prompt');
    const mobile = await setup(browser, true); await mobile.page.locator('#question-count').fill('7'); await mobile.page.locator('#start').click();
    assert.equal(await mobile.page.locator('.exam-sidebar').isVisible(), false); await mobile.page.locator('#toggle-navigator').click(); assert.equal(await mobile.page.locator('.exam-sidebar').isVisible(), true);
    await mobile.page.locator('[data-jump="5"]').click(); assert.match(await mobile.page.locator('.quiz-meta').textContent(), /6 \/ 7/); await mobile.page.locator('#flag-question').click();
    assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await mobile.page.screenshot({ path: '/tmp/mbe-exam-mobile.png', fullPage: true });
    assert.deepEqual(errors, []); console.log('PASS exam answer isolation, option strike/highlight, flag/grid/jumps, hidden timer, tutor locking, score/round history, notebook/card saves and versions, safe text and mobile navigation/layout');
    await context.close(); await mobile.context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
