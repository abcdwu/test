const { routeBank } = require('./bank-fixture.cjs');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { gunzipSync, gzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const origin = process.env.MBE_TEST_ORIGIN || 'http://127.0.0.1:8080';
const bank = JSON.parse(gunzipSync(Buffer.from(readFileSync(path.join(root, 'questions.txt'), 'utf8'), 'base64')));
const samples = bank.filter(question => question.subject === 'torts').slice(0, 3);
const timestamp = '2026-11-05T06:00:00Z';
const legacyEntry = (question, wrongCount = 2) => {
  const legacy = { ...question, explanation: 'Old incomplete explanation' };
  delete legacy.source;
  delete legacy.answerEvidence;
  return { question: legacy, lastAnswer: null, wrongCount, firstWrongAt: timestamp, lastWrongAt: timestamp };
};

async function contextWithBank(browser, questions) {
  const context = await browser.newContext();
  await routeBank(context, questions);
  await context.route('**/cloud-config.json*', route => route.fulfill({ json: {} }));
  return context;
}

async function entries(page) {
  return page.evaluate(async () => {
    const { mistakeStore } = await import('/browser-store.js?v=5');
    await mistakeStore.ready;
    return mistakeStore.read();
  });
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox'],
  });
  try {
    const context = await contextWithBank(browser, samples);
    const page = await context.newPage();
    await page.goto(`${origin}/mistakes.html`);
    await page.getByRole('heading', { name: '错题本。', exact: true }).waitFor();
    await page.getByText('手动备份与恢复（可选）').click();
    const backup = { format: 'mbe-mistakes', version: 1, entries: [legacyEntry(samples[0])] };
    await page.locator('#backup-file').setInputFiles({
      name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
    });
    await page.getByText('恢复完成：新增 1 道，目前共 1 道错题。').waitFor();
    let saved = await entries(page);
    assert.deepEqual(saved[0].question, samples[0]);
    assert.equal(saved[0].wrongCount, 2);
    assert.equal(saved[0].firstWrongAt, timestamp);
    assert.equal(await page.locator('.source-explanation').count(), 1);

    // This is the same merge operation used when a cloud response arrives after initialization.
    await page.evaluate(async entry => {
      const { mistakeStore } = await import('/browser-store.js?v=5');
      await mistakeStore.merge([entry]);
      window.dispatchEvent(new Event('mbe:cloud-synced'));
    }, legacyEntry(samples[1], 3));
    saved = await entries(page);
    assert.deepEqual(saved.find(entry => entry.question.id === samples[1].id).question, samples[1]);
    assert.equal(saved.find(entry => entry.question.id === samples[1].id).wrongCount, 3);
    assert.equal(await page.locator('.source-explanation').count(), 2);

    // An unbound store represents an older tab that has not loaded the rebuilt bank.
    const olderTab = await context.newPage();
    await olderTab.goto(`${origin}/mistakes.html`);
    await olderTab.getByRole('heading', { name: '错题本。', exact: true }).waitFor();
    await olderTab.evaluate(async entry => {
      const { mistakeStore } = await import('/browser-store.js?legacy-tab-test');
      await mistakeStore.ready;
      await mistakeStore.merge([entry]);
    }, legacyEntry(samples[2], 4));
    await page.waitForFunction(async id => {
      const { mistakeStore } = await import('/browser-store.js?v=5');
      return Boolean(mistakeStore.read().find(entry => entry.question.id === id)?.question.source);
    }, samples[2].id);
    saved = await entries(page);
    assert.deepEqual(saved.find(entry => entry.question.id === samples[2].id).question, samples[2]);
    assert.equal(saved.find(entry => entry.question.id === samples[2].id).wrongCount, 4);
    console.log('PASS late legacy backup restore, cloud merge and older-tab merge restore current source content without changing history');
    await context.close();

    for (const asset of ['pdf.mjs', 'pdf.worker.mjs']) {
      const retryContext = await contextWithBank(browser, [samples[0]]);
      const retryPage = await retryContext.newPage();
      let fail = true, requests = 0;
      await retryContext.route(`**/vendor/pdfjs/${asset}*`, route => {
        requests++;
        return fail ? route.fulfill({ status: 503, body: 'Temporary download failure' }) : route.continue();
      });
      await retryPage.goto(origin);
      await retryPage.locator('#start').click();
      await retryPage.locator('.source-question summary').click();
      await retryPage.locator('.pdf-page-error').waitFor({ timeout: 60_000 });
      const failedRequests = requests;
      fail = false;
      await retryPage.getByRole('button', { name: '重试载入' }).click();
      await retryPage.locator('.source-question .pdf-page-status[hidden]').waitFor({ state: 'attached', timeout: 60_000 });
      assert.ok(requests > failedRequests, `${asset} is downloaded again after its failed import`);
      assert.ok(await retryPage.locator('canvas').evaluate(canvas => canvas.width > 0 && canvas.height > 0));
      console.log(`PASS temporary ${asset} download failure recovers with Retry without reloading the page`);
      await retryContext.close();
    }

    const downloadContext = await contextWithBank(browser, [samples[0]]);
    const downloadPage = await downloadContext.newPage();
    let failDownload = true;
    await downloadContext.route('**/sources/*.pdf', route => failDownload
      ? route.fulfill({ status: 503, body: 'Temporary PDF failure' }) : route.continue());
    await downloadPage.goto(origin);
    await downloadPage.locator('#start').click();
    await downloadPage.locator('.source-question summary').click();
    for (let attempt = 0; attempt < 3; attempt++) {
      await downloadPage.locator('.pdf-page-error').waitFor({ timeout: 60_000 });
      assert.equal(downloadPage.workers().length, 0, 'failed PDF loading tasks release their workers');
      if (attempt < 2) await downloadPage.getByRole('button', { name: '重试载入' }).click();
    }
    failDownload = false;
    await downloadPage.getByRole('button', { name: '重试载入' }).click();
    await downloadPage.locator('.source-question .pdf-page-status[hidden]').waitFor({ state: 'attached', timeout: 60_000 });
    assert.equal(downloadPage.workers().length, 1);
    console.log('PASS repeated PDF download failures release workers and recover with Retry');
    await downloadContext.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
