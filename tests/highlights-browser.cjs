const { routeBank } = require('./bank-fixture.cjs');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { gunzipSync } = require('node:zlib');
const path = require('node:path');
const origin = process.env.MBE_TEST_ORIGIN || 'http://127.0.0.1:8080';
const bank = JSON.parse(gunzipSync(Buffer.from(readFileSync(path.join(__dirname, '../questions.txt'), 'utf8'), 'base64')))
  .slice(0, 2).map(({ source, ...question }) => question);

async function select(page, start, end, outside = false) {
  await page.evaluate(({ start, end, outside }) => {
    const stem = document.querySelector(outside ? '.option span:last-child' : '.question');
    const walker = document.createTreeWalker(stem, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const locate = offset => {
      for (const node of nodes) {
        if (offset <= node.length) return [node, offset];
        offset -= node.length;
      }
      throw new Error('Bad selection offset');
    };
    const range = document.createRange();
    range.setStart(...locate(start)); range.setEnd(...locate(end));
    document.getSelection().removeAllRanges(); document.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, { start, end, outside });
}
async function marks(page) { return page.locator('.question mark').allTextContents(); }
async function openQuestion(page, id) {
  await page.goto(origin); await page.locator('#start').click();
  if (await page.locator('.question').getAttribute('data-question-id') !== id) await page.locator('#next').click();
  assert.equal(await page.locator('.question').getAttribute('data-question-id'), id);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
      await routeBank(context, bank);
      await context.route('**/cloud-config.json*', route => route.fulfill({ json: {} }));
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin); await page.locator('#start').click();
      const stem = await page.locator('.question').textContent();
      const id = await page.locator('.question').getAttribute('data-question-id');
      const press = async action => {
        const button = page.locator(`[data-highlight="${action}"]`).first();
        if (mobile) await button.tap(); else await button.click();
      };
      assert.equal(await page.locator('[data-highlight="add"]').isDisabled(), true);
      await select(page, 2, 20); await press('add');
      assert.deepEqual(await marks(page), [stem.slice(2, 20)]);
      await select(page, 12, 30); await press('add');
      assert.deepEqual(await marks(page), [stem.slice(2, 30)]);
      await select(page, 8, 15); await press('remove');
      assert.deepEqual(await marks(page), [stem.slice(2, 8), stem.slice(15, 30)]);
      assert.equal(await page.locator('.question').textContent(), stem);
      await select(page, 0, 3, true);
      assert.equal(await page.locator('[data-highlight="add"]').isDisabled(), true);
      const wrongChoice = ('ABCD'.indexOf(bank.find(q => q.id === id).answer) + 1) % 4;
      await page.locator(`[data-choice="${wrongChoice}"]`).click();
      if (await page.locator('#next').count()) {
        await page.locator('#next').click(); assert.deepEqual(await marks(page), []);
        await page.locator('#previous').click();
      } else {
        await page.locator('#previous').click(); assert.deepEqual(await marks(page), []);
        await page.locator('#next').click();
      }
      assert.deepEqual(await marks(page), [stem.slice(2, 8), stem.slice(15, 30)]);
      assert.equal(await page.locator('.option.selected').count(), 1);
      await openQuestion(page, id);
      assert.deepEqual(await marks(page), [stem.slice(2, 8), stem.slice(15, 30)]);
      if (await page.locator('#next').count()) await page.locator('#next').click();
      page.once('dialog', dialog => dialog.accept()); await page.locator('#submit').click();
      await page.getByRole('heading', { name: '练习完成。' }).waitFor();
      const reviewed = page.locator(`.question[data-question-id="${id}"]`);
      assert.deepEqual(await reviewed.locator('mark').allTextContents(), [stem.slice(2, 8), stem.slice(15, 30)]);
      await page.goto(origin + '/mistakes.html'); await page.locator('.mistake').first().waitFor();
      const wrong = page.locator('.mistake').filter({ has: page.locator(`.question[data-question-id="${id}"]`) });
      await wrong.locator('summary').first().click();
      assert.deepEqual(await wrong.locator('.question mark').allTextContents(), [stem.slice(2, 8), stem.slice(15, 30)]);
      await wrong.locator('[data-highlight="clear"]').click();
      assert.deepEqual(await wrong.locator('.question mark').allTextContents(), []);
      await openQuestion(page, id); assert.deepEqual(await marks(page), []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

      // Another tab updates the same question; a changed source stem must not inherit offsets.
      const other = await context.newPage(); await openQuestion(other, id);
      await select(page, 1, 9); await press('add');
      await other.waitForFunction(() => document.querySelectorAll('.question mark').length === 1);
      await other.locator('[data-highlight="clear"]').click();
      await page.waitForFunction(() => document.querySelectorAll('.question mark').length === 0);
      await page.evaluate(id => localStorage.setItem('mbe-highlights:v1:' + id, JSON.stringify({ text: 'different stem', ranges: [[0, 5]] })), id);
      await openQuestion(page, id); assert.deepEqual(await marks(page), []);

      // Cache quota failure falls back to the persistent IndexedDB copy.
      await page.evaluate(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key.startsWith('mbe-highlights:')) throw new DOMException('Full', 'QuotaExceededError');
          return set.call(this, key, value);
        };
      });
      await select(page, 1, 9); await press('add');
      await page.getByText('已高亮，保存在本机；登录后自动云同步。', { exact: true }).waitFor();
      if (await page.locator('#next').count()) { await page.locator('#next').click(); await page.locator('#previous').click(); }
      else { await page.locator('#previous').click(); await page.locator('#next').click(); }
      assert.deepEqual(await marks(page), [stem.slice(1, 9)]);
      assert.deepEqual(errors, []);
      console.log(`PASS ${mobile ? 'mobile touch' : 'desktop mouse'}: highlight, overlap, partial removal, per-question isolation, navigation/reload, review/wrongbook, cross-tab updates, storage failure and unchanged question text`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
