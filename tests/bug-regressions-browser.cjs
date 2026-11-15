const { chromium } = require('playwright');
const { routeBank } = require('./bank-fixture.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs'), zlib = require('node:zlib');
const origin = process.env.MBE_TEST_ORIGIN || 'http://127.0.0.1:8086';
const question = { id: 'bug-sample', subject: 'torts', stem: 'The tenant offered consideration for a lease.', choices: ['One', 'Two', 'Three', 'Four'], answer: 'A', explanation: 'Original explanation.' };
async function setup(browser, bank = [question]) {
  const context = await browser.newContext(); await routeBank(context, bank); await context.route('**/cloud-config.json*', r => r.fulfill({ json: {} }));
  await context.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
    const listeners = new Set(); window.liveSelectionHandlers = listeners;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (this === document && type === 'selectionchange') { listeners.add(listener); options?.signal?.addEventListener('abort', () => listeners.delete(listener), { once: true }); }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) { if (this === document && type === 'selectionchange') listeners.delete(listener); return remove.call(this, type, listener, options); };
  });
  const page = await context.newPage(); await page.goto(origin); await page.locator('#start').waitFor(); return { context, page };
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const failures = [];
  async function check(name, run) { try { await run(); console.log('PASS ' + name); } catch (error) { failures.push(name + ': ' + error.message); console.error('FAIL ' + name + ': ' + error.message); } }
  try {
    await check('emergency quiz export works when private study storage cannot be read', async () => {
      const { context, page } = await setup(browser); const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.locator('#start').click(); await page.locator('[data-choice="1"]').click();
      await page.evaluate(async () => { const { mistakeStore } = await import('/browser-store.js?v=16'); mistakeStore.recordSession = async () => { throw new Error('Storage full'); }; });
      await page.locator('#submit').click(); await page.locator('#retry-save').waitFor();
      await page.locator('.study-tools > summary').click(); await page.locator('.study-note').fill('Draft kept in the emergency backup');
      await page.evaluate(async () => { const { mistakeStore } = await import('/browser-store.js?v=16'); mistakeStore.readStudy = () => { throw new Error('Study read unavailable'); }; });
      const download = page.waitForEvent('download', { timeout: 3000 }); await page.locator('#save-backup').click();
      const data = JSON.parse(fs.readFileSync(await (await download).path(), 'utf8')); assert.equal(data.attempts.length, 1); assert.equal(data.entries.length, 1); assert.equal(data.entries[0].lastWrongAt, data.attempts[0].completedAt); assert.ok(data.study.some(record => record.revisions.some(edit => edit.value === 'Draft kept in the emergency backup'))); assert.deepEqual(errors, []);
      await context.close();
    });
    await check('unsaved scores prompt before reload and results navigation', async () => {
      const { context, page } = await setup(browser); await page.locator('#start').click(); await page.locator('[data-choice="0"]').click();
      await page.evaluate(async () => { const { mistakeStore } = await import('/browser-store.js?v=16'); mistakeStore.recordSession = async () => { throw new Error('Storage full'); }; });
      await page.locator('#submit').click(); await page.locator('#retry-save').waitFor();
      const protectedScore = await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); dispatchEvent(event); return event.defaultPrevented; });
      assert.equal(protectedScore, true);
      let asked = false; page.once('dialog', dialog => { asked = true; dialog.dismiss(); }); await page.locator('#again').click(); await page.waitForTimeout(100);
      assert.equal(asked, true); assert.equal(await page.locator('#retry-save').count(), 1); await context.close();
    });
    await check('retrying a failed score save preserves a review note draft and scores only once', async () => {
      const { context, page } = await setup(browser); await page.locator('#start').click(); await page.locator('[data-choice="0"]').click();
      await page.evaluate(async () => { const { mistakeStore } = await import('/browser-store.js?v=16'); window.realRecordSession = mistakeStore.recordSession.bind(mistakeStore); mistakeStore.recordSession = async () => { throw new Error('Storage full'); }; });
      await page.locator('#submit').click(); await page.locator('#retry-save').waitFor(); await page.locator('.study-tools > summary').click(); await page.locator('.study-note').fill('Keep this draft when retrying');
      await page.evaluate(async () => { const { mistakeStore } = await import('/browser-store.js?v=16'); mistakeStore.recordSession = window.realRecordSession; });
      await page.locator('#retry-save').click(); await page.locator('#retry-save').waitFor({ state: 'detached' });
      const data = await page.evaluate(async () => { const { mistakeStore } = await import('/browser-store.js?v=16'); return { attempts: mistakeStore.readAttempts(), study: mistakeStore.readStudy() }; });
      assert.equal(data.attempts.length, 1); assert.ok(data.study.some(record => record.revisions.some(edit => edit.value === 'Keep this draft when retrying')));
      await context.close();
    });
    await check('notebook refresh releases detached highlighter and PDF resources', async () => {
      const bank = JSON.parse(zlib.gunzipSync(Buffer.from(fs.readFileSync(__dirname + '/../questions.txt', 'utf8'), 'base64')));
      const original = bank.find(q => q.subject === 'torts'), { context, page } = await setup(browser, [original]);
      await page.evaluate(async q => { const { mistakeStore } = await import('/browser-store.js?v=16'); await mistakeStore.saveStudy(q, 'note', 'Saved'); await mistakeStore.saveStudy(q, 'card', { front: 'Prompt', back: 'Rule' }); }, original);
      await page.goto(origin + '/notebook.html'); await page.locator('.notebook-item').waitFor();
      const baseline = await page.evaluate(() => liveSelectionHandlers.size);
      for (let i = 0; i < 3; i++) {
        await page.locator('.notebook-original > summary').click(); await page.locator('.notebook-source .question').waitFor();
        if (i === 0) {
          const figure = page.locator('.source-explanation .pdf-source-page').first(); await figure.scrollIntoViewIfNeeded();
          await figure.locator('.pdf-page-status[hidden]').waitFor({ state: 'attached', timeout: 60000 });
          await figure.locator('canvas[role="img"]').evaluate(canvas => { window.oldNotebookCanvas = canvas; });
        }
        await page.locator('#notebook-type').selectOption(i % 2 === 0 ? 'cards' : 'all'); await page.locator('.notebook-original:not([open])').waitFor();
      }
      assert.deepEqual(await page.evaluate(() => ({ canvasWidth: oldNotebookCanvas.width, handlers: liveSelectionHandlers.size })), { canvasWidth: 0, handlers: baseline }, 'replaced canvas memory and selection handlers must be released');
      await context.close();
    });
    await check('highlighter remount reads the saved notebook once rather than once per text block', async () => {
      const { context, page } = await setup(browser); await page.locator('#start').click(); await page.locator('.question').waitFor();
      const calls = await page.evaluate(async () => {
        const { mistakeStore } = await import('/browser-store.js?v=16'), { mountHighlights } = await import('/highlights.js?v=5');
        const read = mistakeStore.readHighlights.bind(mistakeStore); let count = 0;
        mistakeStore.readHighlights = () => { count++; return read(); };
        mountHighlights(document.getElementById('app')); mistakeStore.readHighlights = read; return count;
      });
      assert.equal(calls, 1); await context.close();
    });
  } finally { await browser.close(); }
  assert.deepEqual(failures, []);
})().catch(error => { console.error(error); process.exit(1); });
