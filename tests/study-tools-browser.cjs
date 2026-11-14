const { chromium } = require('playwright');
const { routeBank } = require('./bank-fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs'), zlib = require('node:zlib'), path = require('node:path');
const root = path.resolve(__dirname, '..'), origin = process.env.MBE_TEST_ORIGIN || 'http://127.0.0.1:8080';
const all = JSON.parse(zlib.gunzipSync(Buffer.from(fs.readFileSync(path.join(root, 'questions.txt'), 'utf8'), 'base64')));
const questions = all.slice(0, 30).map(({ source, ...q }) => ({ ...q, stem: 'The landlord offered consideration for a lease.',
  choices: ['Consideration supports the agreement.', 'No agreement exists.', 'There is a contract.', 'The lease is invalid.'] }));
async function hold(page, locator, word) {
  const point = await locator.evaluate((el, word) => {
    const node = el.firstChild, index = node.textContent.toLowerCase().indexOf(word.toLowerCase());
    const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + word.length);
    const rect = range.getBoundingClientRect(); return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  }, word);
  await locator.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 45, button: 0, isPrimary: true, clientX: point.x, clientY: point.y });
  await page.waitForTimeout(700);
  await locator.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 45, clientX: point.x, clientY: point.y });
  await locator.dispatchEvent('click', { clientX: point.x, clientY: point.y });
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await routeBank(context, questions); await context.route('**/cloud-config.json*', r => r.fulfill({ json: {} }));
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin); await page.locator('#start').waitFor();
    for (const value of ['0', '-1', '1.5', '']) {
      await page.locator('#question-count').fill(value); assert.equal(await page.locator('#start').isDisabled(), true);
    }
    await page.locator('#question-count').fill('7'); await page.locator('#timer-mode').selectOption('countdown');
    assert.match(await page.locator('.timing-hint').textContent(), /7 题.*12:36/);
    await page.locator('#start').click(); await page.locator('.question').waitFor(); assert.match(await page.locator('.meta').textContent(), /1 \/ 7/);
    await hold(page, page.locator('.question'), 'consideration'); await page.getByText(/对价/).waitFor();
    assert.equal(await page.locator('.option.selected').count(), 0);
    await page.getByRole('button', { name: '关闭单词释义' }).click();
    await hold(page, page.locator('.option span:last-child').first(), 'Consideration'); await page.getByText(/对价/).waitFor();
    assert.equal(await page.locator('.option.selected').count(), 0, 'long press must not answer the question');
    await page.getByRole('button', { name: '关闭单词释义' }).click(); await page.locator('[data-choice="0"]').click();
    assert.equal(await page.locator('.option.selected').count(), 1);
    page.once('dialog', d => d.accept()); await page.locator('#exit').click();
    await page.locator('#question-count').fill('27'); await page.locator('#start').click(); await page.locator('.question').waitFor();
    assert.match(await page.locator('.meta').textContent(), /1 \/ 27/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await context.close();

    const sample = all.find(q => q.subject === 'torts' && q.source.questionPages[0] > 100);
    const pdfContext = await browser.newContext(); await routeBank(pdfContext, [sample]);
    await pdfContext.route('**/cloud-config.json*', r => r.fulfill({ json: {} }));
    let wholeFiles = 0, chunks = 0;
    await pdfContext.route(url => /\/sources\/[a-z-]+\.pdf$/.test(url.pathname), r => { wholeFiles++; return r.abort(); });
    pdfContext.on('request', r => { if (/\/sources\/pages\/.+\.pdf/.test(r.url())) chunks++; });
    const pdf = await pdfContext.newPage(); pdf.on('pageerror', e => errors.push(e.message));
    await pdf.goto(origin); await pdf.locator('#start').click(); await pdf.locator('.source-question summary').click();
    await pdf.locator('.source-question .pdf-page-status[hidden]').waitFor({ state: 'attached', timeout: 60000 });
    await pdf.locator('.source-question .textLayer span').first().waitFor();
    const selectable = pdf.locator('.source-question .textLayer span').filter({ hasText: /\bthe\b/i }).first();
    await hold(pdf, selectable, 'the');
    await pdf.locator('.word-definition').filter({ hasText: '词典释义' }).waitFor();
    await pdf.getByRole('button', { name: '关闭单词释义' }).click();
    assert.equal(wholeFiles, 0); assert.ok(chunks > 0);
    const opened = pdf.waitForEvent('popup'); await pdf.locator('.source-question a').first().click();
    const viewer = await opened; await viewer.locator('.pdf-page-status[hidden]').waitFor({ state: 'attached', timeout: 60000 });
    assert.ok(viewer.url().includes('source.html?')); assert.equal(await viewer.locator('.pdf-source-page').getAttribute('data-pdf-page'), String(sample.source.questionPages[0]));
    assert.equal(await viewer.locator('.pdf-source-page').count(), sample.source.questionPages.length); assert.equal(wholeFiles, 0);
    assert.deepEqual(errors, []);
    console.log('PASS arbitrary counts, invalid-input handling, long-press Chinese legal lookup without answering, small original-page loads and exact-page viewer');
    await pdfContext.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
