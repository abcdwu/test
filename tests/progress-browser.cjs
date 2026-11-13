const { routeBank } = require('./bank-fixture.cjs');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const origin = process.env.MBE_TEST_ORIGIN || 'http://127.0.0.1:8080';
const bank = JSON.parse(zlib.gunzipSync(Buffer.from(fs.readFileSync(path.join(root, 'questions.txt'), 'utf8'), 'base64')))
  .slice(0, 80).map(({ source, answerEvidence, ...question }) => question);
const source = zlib.gzipSync(JSON.stringify(bank)).toString('base64');
const metadata = { bankSha256: crypto.createHash('sha256').update(source).digest('hex'),
  questions: bank.map(({ id, subject }) => ({ id, subject })) };

async function context(browser, apiBase = '') {
  const context = await browser.newContext();
  await routeBank(context, bank);
  await context.route('**/cloud-config.json*', r => r.fulfill({ json: { apiBase } }));
  return context;
}
async function quiz(page, total, correct, expected) {
  await page.getByRole('button', { name: `${total} 题`, exact: true }).click(); await page.locator('#start').click();
  for (let index = 0; index < total; index++) {
    const stem = await page.locator('.card .question').textContent();
    const question = bank.find(q => q.stem === stem);
    if (index < correct) await page.locator(`[data-choice="${'ABCD'.indexOf(question.answer)}"]`).click();
    if (index < total - 1) await page.locator('#next').click();
  }
  if (correct < total) page.once('dialog', dialog => dialog.accept());
  await page.locator('#submit').click(); await page.getByRole('heading', { name: '练习完成。' }).waitFor();
  assert.equal(await page.locator('#session-rate').textContent(), `${(correct / total * 100).toFixed(1)}%`);
  await page.waitForFunction(value => document.querySelector('#cumulative-rate')?.textContent === value, expected);
}
async function home(page) { await page.goto(origin); await page.locator('#start').waitFor(); }
async function login(page) {
  await page.locator('#sync-toggle').click(); await page.locator('#cloud-password').fill('test-only-progress');
  await page.getByRole('button', { name: '登录并记住此设备' }).click();
  await page.getByText(/错题已自动同步/).waitFor();
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const { createApi } = await import(root + '/server/api.js');
  const directory = fs.mkdtempSync('/tmp/mbe-progress-browser-');
  const api = createApi({ databasePath: path.join(directory, 'db.sqlite'), loginPassword: 'test-only-progress', allowedOrigins: [origin] });
  await new Promise(resolve => api.server.listen(0, '127.0.0.1', resolve));
  const apiBase = `http://127.0.0.1:${api.server.address().port}`;
  const errors = [];
  try {
    const legacyContext = await context(browser); const oldTab = await legacyContext.newPage();
    await oldTab.goto(origin + '/cloud-config.json');
    await oldTab.evaluate(async question => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('mbe-mistakes', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('state');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      db.onversionchange = () => { db.close(); window.legacyClosed = true; };
      window.legacyDatabase = db;
      await new Promise((resolve, reject) => {
        const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put({ device: 'legacy-device', raw: JSON.stringify({ version: 1, entries: [{
          question, lastAnswer: null, wrongCount: 1, firstWrongAt: '2026-11-05T09:00:00Z', lastWrongAt: '2026-11-05T09:00:00Z',
        }] }) }, 'current');
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
    }, bank[0]);
    const upgraded = await legacyContext.newPage(); await home(upgraded);
    assert.equal(await oldTab.evaluate(() => window.legacyClosed), true);
    const legacy = await upgraded.evaluate(async () => {
      const { mistakeStore } = await import('/browser-store.js?v=12');
      await mistakeStore.ready;
      return { entries: mistakeStore.read(), attempts: mistakeStore.readAttempts() };
    });
    assert.equal(legacy.entries[0].wrongCount, 1); assert.deepEqual(legacy.attempts, []);
    assert.equal(await upgraded.locator('#cumulative-rate').textContent(), '—');
    await legacyContext.close();
    console.log('PASS existing database upgrades without losing old wrong records or inventing historical accuracy');
    const firstContext = await context(browser, apiBase); const first = await firstContext.newPage();
    first.on('pageerror', error => errors.push(error.message));
    await home(first); assert.equal(await first.locator('#cumulative-rate').textContent(), '—');
    await quiz(first, 10, 8, '80.0%'); await first.locator('#again').click();
    await quiz(first, 20, 10, '60.0%');
    assert.match(await first.locator('#cumulative-summary').textContent(), /累计答对 18 \/ 30 题/);
    await home(first); await first.waitForFunction(() => document.querySelector('#cumulative-rate')?.textContent === '60.0%');
    await first.setViewportSize({ width: 390, height: 844 });
    assert.equal(await first.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    console.log('PASS 8/10 then 10/20 displays cumulative 18/30 = 60.0%, persists after reload and fits mobile');

    await first.goto(origin + '/mistakes.html'); await first.getByText('手动备份与恢复（可选）').click();
    const download = first.waitForEvent('download'); await first.locator('#export').click();
    const backup = fs.readFileSync(await (await download).path());
    assert.equal(JSON.parse(backup).attempts.length, 2);
    const backupContext = await context(browser); const restore = await backupContext.newPage();
    await restore.goto(origin + '/mistakes.html'); await restore.getByText('手动备份与恢复（可选）').click();
    for (let index = 0; index < 2; index++) {
      await restore.locator('#backup-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
      await restore.getByText(/恢复完成/).waitFor();
    }
    await home(restore); await restore.waitForFunction(() => document.querySelector('#cumulative-rate')?.textContent === '60.0%');
    console.log('PASS backup and repeated restore preserve cumulative results without double counting');

    await home(first); await login(first);
    const secondContext = await context(browser, apiBase); const second = await secondContext.newPage();
    second.on('pageerror', error => errors.push(error.message)); await home(second); await login(second);
    await second.waitForFunction(() => document.querySelector('#cumulative-rate')?.textContent === '60.0%');
    await quiz(second, 5, 5, '65.7%'); await second.getByText(/错题已自动同步/).waitFor();
    await first.evaluate(() => dispatchEvent(new Event('online')));
    await first.waitForFunction(() => document.querySelector('#cumulative-rate')?.textContent === '65.7%');
    await firstContext.setOffline(true); await quiz(first, 5, 0, '57.5%');
    await first.getByText(/暂未同步/).waitFor(); await firstContext.setOffline(false);
    await first.getByText(/错题已自动同步/).waitFor();
    await second.evaluate(() => dispatchEvent(new Event('online')));
    await second.waitForFunction(() => document.querySelector('#cumulative-rate')?.textContent === '57.5%');
    await second.evaluate(async () => { const { sync } = await import('/cloud-sync.js?v=12'); await sync(); await sync(); });
    assert.match(await second.locator('#cumulative-summary').textContent(), /累计答对 23 \/ 40 题/);
    assert.match(await second.locator('#cumulative-summary').textContent(), /已完成 4 次练习/);
    const history = await second.evaluate(async () => {
      const { mistakeStore } = await import('/browser-store.js?v=12'); return mistakeStore.readAttempts();
    });
    assert.ok(history.every(record => record.details && record.details.questions.length === record.total));
    const ids = history.flatMap(record => record.details.questions.map(question => question.id));
    assert.equal(ids.length, 40); assert.equal(new Set(ids).size, 40, 'two devices share round exclusions after sync');
    assert.ok(history.every(record => record.details.questions.every(question => question.round === 1)));
    console.log('PASS two-device accumulation, perfect-session sync, offline catch-up and repeated sync without inflation');
    assert.deepEqual(errors, []); console.log('PASS no browser errors');
  } finally {
    await browser.close(); await new Promise(resolve => api.server.close(resolve)); api.closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
