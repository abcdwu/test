const { chromium } = require('playwright');
const { routeBank } = require('./bank-fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs'), zlib = require('node:zlib'), path = require('node:path');
const origin = process.env.MBE_TEST_ORIGIN || 'http://127.0.0.1:8080';
const all = JSON.parse(zlib.gunzipSync(Buffer.from(fs.readFileSync(path.join(__dirname, '../questions.txt'), 'utf8'), 'base64')));
const bank = [...all.filter(q => q.subject === 'torts').slice(0, 12), ...all.filter(q => q.subject === 'contracts').slice(0, 3)]
  .map(({ source, ...q }) => q);
async function attempts(page) {
  return page.evaluate(async () => {
    const { mistakeStore } = await import('/browser-store.js?v=9'); await mistakeStore.ready; return mistakeStore.readAttempts();
  });
}
async function finish(page, total, bad = []) {
  const ids = [];
  for (let i = 0; i < total; i++) {
    const id = await page.locator('.question').getAttribute('data-question-id'); ids.push(id);
    if (!bad.includes(i + 1)) await page.locator(`[data-choice="${'ABCD'.indexOf(bank.find(q => q.id === id).answer)}"]`).click();
    else if (i < total - 1) await page.locator(`[data-choice="${('ABCD'.indexOf(bank.find(q => q.id === id).answer) + 1) % 4}"]`).click();
    if (i < total - 1) await page.locator('#next').click();
  }
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#submit').click(); await page.getByRole('heading', { name: '练习完成。' }).waitFor();
  page.removeAllListeners('dialog');
  return ids;
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await routeBank(context, bank); await context.route('**/cloud-config.json*', r => r.fulfill({ json: {} }));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message)); await page.clock.install();
    await page.goto(origin + '/?subject=torts'); await page.getByRole('button', { name: '5 题', exact: true }).click(); await page.locator('#start').click();
    await page.locator('.question').waitFor(); await page.clock.fastForward(123000);
    const firstIds = await finish(page, 5, [2, 5]);
    let records = await attempts(page); assert.equal(records.length, 1);
    const first = records[0]; assert.ok(first.details.durationSeconds >= 123); assert.equal(first.total, 5);
    assert.equal(await page.locator('.wrong-numbers').first().textContent(), '2、5');
    const before = JSON.stringify(records);
    const inline = page.locator(`[data-inline-attempt="${first.id}"]`);
    await inline.locator('.history-question').nth(4).waitFor();
    assert.deepEqual(await inline.locator('.history-question').evaluateAll(nodes => nodes.map(node => node.dataset.savedQuestionId)), firstIds);
    assert.deepEqual(await inline.locator('.history-stem').allTextContents(), firstIds.map(id => bank.find(q => q.id === id).stem));
    assert.equal(await inline.locator('.history-choices li').count(), 20);
    assert.equal(JSON.stringify(await attempts(page)), before, 'showing full question content is read-only');
    for (let i = 0; i < 2; i++) {
      await page.locator(`[data-attempt-review="${first.id}"]`).click();
      await page.getByRole('heading', { name: '历史练习。' }).waitFor();
      assert.deepEqual(await page.locator('.question').evaluateAll(nodes => nodes.map(n => n.dataset.questionId)), firstIds);
      assert.equal(await page.locator('.ro.wrong').count(), 1);
      assert.equal(await page.getByText('未作答', { exact: true }).count(), 1);
      assert.equal(JSON.stringify(await attempts(page)), before);
      await page.locator('#history-back').click(); await page.locator('#history-panel > details > summary').click();
    }
    assert.match(await page.locator('#round-progress').textContent(), /已做 5 \/ 12.*剩余 7/);
    await page.locator('#start').click(); const secondIds = await finish(page, 5);
    assert.equal(firstIds.filter(id => secondIds.includes(id)).length, 0);
    await page.goto(origin + '/?subject=torts');
    assert.match(await page.locator('#round-progress').textContent(), /剩余 2/);
    await page.locator('#timer-mode').selectOption('countdown');
    assert.match(await page.locator('.timing-hint').textContent(), /2 题.*03:36/);
    await page.locator('#start').click(); await page.locator('.question').waitFor();
    const thirdIds = [await page.locator('.question').getAttribute('data-question-id')];
    await page.locator('#next').click(); thirdIds.push(await page.locator('.question').getAttribute('data-question-id'));
    await page.clock.fastForward(216000); await page.getByRole('heading', { name: '练习完成。' }).waitFor();
    assert.equal(new Set([...firstIds, ...secondIds, ...thirdIds]).size, 12);
    records = await attempts(page); assert.equal(records.length, 3);
    const automatic = records.find(a => a.total === 2);
    assert.equal(automatic.details.durationSeconds, 216); assert.equal(automatic.details.timerMode, 'countdown');
    assert.equal(await page.locator('.wrong-numbers').first().textContent(), '1、2');
    await page.locator('#again').click(); assert.match(await page.locator('#round-progress').textContent(), /本轮 12 题已完成/);
    await page.getByRole('button', { name: '5 题', exact: true }).click(); await page.locator('#start').click(); await page.locator('.question').waitFor();
    page.once('dialog', d => d.accept()); await page.locator('#exit').click();
    assert.equal((await attempts(page)).length, 3, 'unsubmitted exit consumes nothing');
    await page.locator('#start').click(); await finish(page, 5);
    records = await attempts(page); const round2 = records.find(a => a.details.questions[0].round === 2);
    assert.ok(round2); await page.locator('#again').click();
    assert.match(await page.locator('#round-progress').textContent(), /第 2 轮.*已做 5 \/ 12.*剩余 7/);
    await page.locator('#subject').selectOption('all'); await page.getByRole('button', { name: '20 题', exact: true }).click();
    await page.locator('#start').click(); const mixedIds = await finish(page, 10);
    assert.equal(mixedIds.filter(id => round2.details.questions.some(q => q.id === id)).length, 0);
    assert.equal(mixedIds.filter(id => bank.find(q => q.id === id).subject === 'contracts').length, 3);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('#history-panel').scrollIntoViewIfNeeded(); await page.screenshot({ path: '/tmp/mbe-history-mobile.png' });

    // A fresh browser fetches no question bank while the history is closed.
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const original = all.find(question => question.id === firstIds[0]);
    await routeBank(fresh, bank.map(question => question.id === original.id ? original : question));
    await fresh.route('**/cloud-config.json*', r => r.fulfill({ json: {} }));
    const restored = await fresh.newPage(); let downloads = 0;
    restored.on('request', request => { if (/\/bank\/.+\.gz/.test(request.url())) downloads++; });
    await restored.goto(origin + '/?subject=torts'); await restored.locator('#start').waitFor();
    await restored.evaluate(async record => {
      const { mistakeStore } = await import('/browser-store.js?v=9'); await mistakeStore.mergeAttempts([record]);
      window.dispatchEvent(new Event('mbe:cloud-synced'));
    }, first);
    assert.equal(downloads, 0);
    await restored.locator('#history-panel > details > summary').click();
    await restored.locator('.history-question').nth(4).waitFor();
    assert.equal(downloads, 1, 'only the required subject is downloaded, once');
    assert.deepEqual(await restored.locator('.history-stem').allTextContents(), firstIds.map(id => bank.find(q => q.id === id).stem));
    assert.equal(await restored.locator('.history-source a').getAttribute('href'), `${original.source.pdfPath}#page=${original.source.questionPages[0]}`);
    assert.equal(await restored.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(await attempts(restored), [first]);
    await restored.locator('#history-panel').scrollIntoViewIfNeeded();
    await restored.screenshot({ path: '/tmp/mbe-inline-history-mobile.png' });
    await fresh.close();
    assert.deepEqual(errors, []);
    console.log('PASS inline full stems/options in original order, lazy subject loading, read-only history, repeated review, 5+5+2 unique questions, reload, countdown, rollover and mobile layout');
    await context.close();
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
