const { chromium } = require('playwright');
const { routeBank } = require('./bank-fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs'), zlib = require('node:zlib'), path = require('node:path');
const origin = process.env.MBE_TEST_ORIGIN || 'http://127.0.0.1:8080';
const bank = JSON.parse(zlib.gunzipSync(Buffer.from(fs.readFileSync(path.join(__dirname, '../questions.txt'), 'utf8'), 'base64')))
  .slice(0, 2).map(({ source, ...q }) => ({ ...q, stem: 'Alpha beta gamma delta epsilon. '.repeat(120) + 'Omega 😊 café e\u0301 finish.' }));

async function points(page, start, end) {
  await page.locator('.question').evaluate((stem, { start, end }) => {
    const walker = document.createTreeWalker(stem, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const locate = offset => { for (const node of nodes) { if (offset <= node.length) return [node, offset]; offset -= node.length; } };
    const range = document.createRange(); range.setStart(...locate(start)); range.setEnd(...locate(end));
    const rect = range.getBoundingClientRect(); scrollBy(0, rect.top - 190);
  }, { start, end });
  return page.locator('.question').evaluate((stem, { start, end }) => {
    const walker = document.createTreeWalker(stem, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const locate = offset => { for (const node of nodes) { if (offset <= node.length) return [node, offset]; offset -= node.length; } };
    const range = document.createRange(); range.setStart(...locate(start)); range.setEnd(...locate(end));
    const rect = range.getBoundingClientRect();
    return { x1: rect.left + 1, x2: rect.right - 1, y: (rect.top + rect.bottom) / 2 };
  }, { start, end });
}
async function marked(page) { return (await page.locator('.question mark').allTextContents()).join(''); }

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 834, height: 1112 }, isMobile: true, hasTouch: true });
    await routeBank(context, bank); await context.route('**/cloud-config.json*', r => r.fulfill({ json: {} }));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => document.addEventListener('pointerdown', e => { if (e.pointerType === 'pen') window.lastPenId = e.pointerId; }, true));
    await page.goto(origin); await page.locator('#start').click(); await page.locator('.question').waitFor();
    const id = await page.locator('.question').getAttribute('data-question-id'), text = await page.locator('.question').textContent();
    const cdp = await context.newCDPSession(page);
    const pen = (type, x, y) => cdp.send('Input.dispatchMouseEvent', { type, x, y, pointerType: 'pen',
      button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1,
      force: type === 'mouseReleased' ? 0 : 0.5 });
    const stroke = async (start, end) => {
      const p = await points(page, start, end);
      await pen('mousePressed', p.x1, p.y); await pen('mouseMoved', p.x2, p.y); await pen('mouseReleased', p.x2, p.y);
    };
    await page.locator('[data-highlight="pen"]').click();
    assert.equal(await page.locator('[data-highlight="pen"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.question').evaluate(el => getComputedStyle(el).touchAction), 'none');
    const initial = await points(page, 0, 16);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: initial.x1, y: initial.y, pointerType: 'pen', buttons: 0 });
    assert.equal(await marked(page), '', 'hover does not draw');
    await stroke(0, 16);
    assert.match(await marked(page), /Alpha beta gamma/);
    assert.ok(!(await marked(page)).includes('epsilon'), 'a fast stroke marks only intersected text');
    assert.equal(await page.locator('.option.selected').count(), 0);
    await page.screenshot({ path: '/tmp/mbe-pencil-ipad.png' });

    const beforePalm = await marked(page), scrollBeforePalm = await page.evaluate(() => scrollY);
    const p = await points(page, 17, 22); await pen('mousePressed', p.x1, p.y);
    await page.locator('.question').dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 90, isPrimary: true, clientX: 150, clientY: 250 });
    await page.locator('.question').dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 90, isPrimary: true, clientX: 150, clientY: 100 });
    assert.equal(await page.evaluate(() => scrollY), scrollBeforePalm, 'palm contact does not scroll while drawing');
    await pen('mouseMoved', p.x2, p.y); await pen('mouseReleased', p.x2, p.y);
    assert.ok((await marked(page)).length > beforePalm.length);

    const beforeFinger = await marked(page), scrollBeforeFinger = await page.evaluate(() => scrollY);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x1, y: p.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x1, y: p.y - 100 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok(await page.evaluate(() => scrollY) > scrollBeforeFinger + 20, 'finger drag scrolls in pen mode');
    assert.equal(await marked(page), beforeFinger, 'fingers never highlight');

    await page.locator('[data-highlight="eraser"]').click(); await stroke(0, 5);
    assert.ok(!(await marked(page)).includes('Alpha')); assert.match(await marked(page), /gamma/);
    await page.locator('[data-highlight="pen"]').click();
    const beforeCancel = await marked(page), cancel = await points(page, 0, 5);
    await pen('mousePressed', cancel.x1, cancel.y); await pen('mouseMoved', cancel.x2, cancel.y);
    const pointerId = await page.evaluate(() => window.lastPenId);
    await page.locator('.question').dispatchEvent('pointercancel', { pointerType: 'pen', pointerId });
    await pen('mouseReleased', cancel.x2, cancel.y);
    assert.equal(await marked(page), beforeCancel, 'cancelled strokes preserve existing saved marks');

    const emoji = text.indexOf('😊'); await stroke(emoji, emoji + 2);
    assert.ok((await marked(page)).includes('😊')); assert.ok(!(await marked(page)).includes('\ufffd'));
    assert.equal(await page.locator('.question').textContent(), text);
    const saved = await marked(page);
    await page.setViewportSize({ width: 1024, height: 768 }); assert.equal(await marked(page), saved);
    if (await page.locator('#next').count()) { await page.locator('#next').click(); await page.locator('#previous').click(); }
    else { await page.locator('#previous').click(); await page.locator('#next').click(); }
    assert.equal(await marked(page), saved);
    assert.equal(await page.locator('[data-highlight="pen"]').getAttribute('aria-pressed'), 'true');
    page.once('dialog', d => d.accept()); await page.goto(origin); await page.locator('#start').click();
    if (await page.locator('.question').getAttribute('data-question-id') !== id) await page.locator('#next').click();
    assert.equal(await marked(page), saved, 'pen marks survive reload using the existing storage format');
    await page.locator('[data-highlight="pen"]').click(); await page.locator('[data-highlight="pen"]').click();
    assert.equal(await page.locator('.question').evaluate(el => getComputedStyle(el).userSelect), 'text');
    const stored = await page.evaluate(id => JSON.parse(localStorage.getItem('mbe-highlights:v1:' + id)), id);
    assert.equal(stored.text, text); assert.ok(Array.isArray(stored.ranges));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log('PASS native pen pointer input: fast strokes, glyph-only marks, erase, palm rejection, finger scroll, cancellation, Unicode, resize, navigation, reload and no changed answers/text');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
