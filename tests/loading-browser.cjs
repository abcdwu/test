const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const origin = process.env.MBE_TEST_ORIGIN || 'http://127.0.0.1:8081';
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    await context.route('**/cloud-config.json*', route => route.fulfill({ json: {} }));
    let requests = 0, failures = 2;
    await context.route('**/questions.txt*', route => {
      requests++; return requests <= failures ? route.abort('failed') : route.continue();
    });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin); await page.locator('#start').waitFor({ timeout: 30000 });
    assert.equal(requests, 3); assert.match(await page.locator('#subject option').first().textContent(), /1803/);
    console.log('PASS two interrupted downloads recover automatically on a mobile viewport');

    requests = 0; failures = Infinity;
    await page.reload(); await page.locator('#retry-bank').waitFor(); assert.equal(requests, 3);
    assert.match(await page.locator('#app [role=alert]').textContent(), /题库文件未能下载完成/);
    await page.evaluate(() => { dispatchEvent(new Event('mbe:cloud-synced')); dispatchEvent(new Event('mbe:local-refreshed')); });
    assert.ok(await page.locator('#retry-bank').isVisible(), 'sync events must not replace the failure screen with an empty bank');
    failures = 0; await page.locator('#retry-bank').click(); await page.locator('#start').waitFor();
    assert.equal(requests, 4);
    console.log('PASS persistent failure shows a Chinese message and Retry recovers without reloading the page');

    requests = 0; failures = Infinity;
    await page.reload(); await page.locator('#retry-bank').waitFor();
    failures = 0; await page.evaluate(() => dispatchEvent(new Event('online')));
    await page.locator('#start').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log('PASS returning online retries the bank; mobile layout and runtime checks pass');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
