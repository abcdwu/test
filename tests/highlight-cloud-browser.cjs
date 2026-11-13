const { chromium } = require('playwright');
const { routeBank } = require('./bank-fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs'), zlib = require('node:zlib'), path = require('node:path');
const root = path.resolve(__dirname, '..'), origin = process.env.MBE_TEST_ORIGIN || 'http://127.0.0.1:8080';
const bank = JSON.parse(zlib.gunzipSync(Buffer.from(fs.readFileSync(path.join(root, 'questions.txt'), 'utf8'), 'base64')))
  .slice(0, 2).map(({ source, ...q }) => ({ ...q, stem: 'Alpha beta gamma delta epsilon. '.repeat(20) }));
const sample = bank[0];
async function select(page, start, end) {
  await page.locator('.question').evaluate((stem, { start, end }) => {
    const nodes = [], walker = document.createTreeWalker(stem, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const locate = offset => { for (const node of nodes) { if (offset <= node.length) return [node, offset]; offset -= node.length; } };
    const range = document.createRange(); range.setStart(...locate(start)); range.setEnd(...locate(end));
    getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event('selectionchange'));
  }, { start, end });
}
async function add(page, start, end) { await select(page, start, end); await page.locator('[data-highlight="add"]').click(); }
async function marked(page) { return (await page.locator('.question mark').allTextContents()).join(''); }
async function sync(page) { await page.evaluate(async () => { await (await import('/cloud-sync.js?v=12')).sync(); }); }
async function login(page) {
  await page.locator('#sync-toggle').click(); await page.locator('#cloud-password').fill('test-only-highlights');
  await page.getByRole('button', { name: '登录并记住此设备' }).click();
  await page.getByText(/错题已自动同步（含练习记录与高亮）/).waitFor();
}
async function start(page) {
  await page.locator('#start').click(); await page.locator('.question').waitFor();
  if (await page.locator('.question').getAttribute('data-question-id') !== sample.id) await page.locator('#next').click();
}
async function has(page, words) {
  await page.waitForFunction(words => {
    const marked = [...document.querySelectorAll('.question mark')].map(mark => mark.textContent).join('');
    return words.every(word => marked.includes(word));
  }, words);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const { createApi } = await import(root + '/server/api.js');
  const api = createApi({ databasePath: ':memory:', loginPassword: 'test-only-highlights', allowedOrigins: [origin] });
  await new Promise(resolve => api.server.listen(0, '127.0.0.1', resolve));
  const apiBase = `http://127.0.0.1:${api.server.address().port}`, errors = [];
  async function device(cloud = true, legacy = false) {
    const context = await browser.newContext({ viewport: { width: 834, height: 1112 }, isMobile: true, hasTouch: true });
    await routeBank(context, bank); await context.route('**/cloud-config.json*', r => r.fulfill({ json: cloud ? { apiBase } : {} }));
    if (legacy) await context.addInitScript(q => {
      if (!localStorage.getItem('legacy-seeded')) {
        localStorage.setItem('mbe-highlights:v1:' + q.id, JSON.stringify({ text: q.stem, ranges: [[0, 5]] }));
        localStorage.setItem('legacy-seeded', 'true');
      }
    }, sample);
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin); await page.locator('#start').waitFor();
    return { context, page };
  }
  try {
    const a = await device(true, true); await login(a.page); await start(a.page); assert.equal(await marked(a.page), 'Alpha');
    const b = await device(); await login(b.page); await start(b.page); assert.equal(await marked(b.page), 'Alpha');
    // Use native pen pointer input on the second device, then recover it on the first.
    await b.page.locator('[data-highlight="pen"]').click();
    const point = await b.page.locator('.question').evaluate(stem => {
      const range = document.createRange(); range.setStart(stem.lastChild, 1); range.setEnd(stem.lastChild, 5);
      const rect = range.getBoundingClientRect(); return { x1: rect.left + 1, x2: rect.right - 1, y: (rect.top + rect.bottom) / 2 };
    });
    const cdp = await b.context.newCDPSession(b.page);
    for (const [type, x] of [['mousePressed', point.x1], ['mouseMoved', point.x2], ['mouseReleased', point.x2]]) {
      await cdp.send('Input.dispatchMouseEvent', { type, x, y: point.y, pointerType: 'pen', button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, force: type === 'mouseReleased' ? 0 : 0.5 });
    }
    await has(b.page, ['beta']); await b.page.getByText('已高亮，保存在本机；登录后自动云同步。', { exact: true }).waitFor();
    await b.page.getByText(/错题已自动同步/).waitFor(); await sync(a.page); await has(a.page, ['Alpha', 'beta']);
    await b.page.locator('[data-highlight="pen"]').click();
    await a.context.setOffline(true); await b.context.setOffline(true);
    await add(a.page, 11, 16); await add(b.page, 17, 22);
    await a.page.getByText(/暂未同步/).waitFor(); await b.page.getByText(/暂未同步/).waitFor();
    await a.context.setOffline(false); await a.page.getByText(/错题已自动同步/).waitFor();
    await b.context.setOffline(false); await b.page.getByText(/错题已自动同步/).waitFor();
    await sync(a.page); await has(a.page, ['Alpha', 'beta', 'gamma', 'delta']);
    await sync(b.page); await has(b.page, ['Alpha', 'beta', 'gamma', 'delta']);
    await a.context.setOffline(true); await b.page.locator('[data-highlight="clear"]').click();
    await b.page.getByText('已取消高亮，保存在本机；登录后自动云同步。', { exact: true }).waitFor();
    await b.page.getByText(/错题已自动同步/).waitFor();
    await a.context.setOffline(false); await a.page.getByText(/错题已自动同步/).waitFor();
    await a.page.waitForFunction(() => document.querySelectorAll('.question mark').length === 0);
    await a.page.evaluate(async q => {
      localStorage.setItem('mbe-highlights:v1:' + q.id, JSON.stringify({ text: q.stem, ranges: [[0, 5]] }));
      const { mistakeStore } = await import('/browser-store.js?v=12'); await mistakeStore.importHighlightCache();
      dispatchEvent(new Event('mbe:local-refreshed'));
    }, sample);
    assert.equal(await marked(a.page), '', 'an old local cache cannot resurrect a cleared mark');
    await add(a.page, 0, 5); await a.page.getByText('已高亮，保存在本机；登录后自动云同步。', { exact: true }).waitFor();
    await a.page.getByText(/错题已自动同步/).waitFor();
    const c = await device(); await login(c.page); await start(c.page); await has(c.page, ['Alpha']);
    c.page.once('dialog', dialog => dialog.accept()); await c.page.goto(origin + '/mistakes.html');
    await c.page.getByText('手动备份与恢复（可选）').click(); assert.equal(await c.page.locator('#export').isEnabled(), true);
    const downloading = c.page.waitForEvent('download'); await c.page.locator('#export').click();
    const backup = fs.readFileSync(await (await downloading).path()); assert.equal(JSON.parse(backup).highlights.length, 1);
    const d = await device(false); await d.page.goto(origin + '/mistakes.html');
    await d.page.getByText('手动备份与恢复（可选）').click();
    await d.page.locator('#backup-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
    await d.page.getByText(/恢复完成/).waitFor(); await d.page.goto(origin); await start(d.page); await has(d.page, ['Alpha']);
    // A highlight-only sync must not close an expanded wrong-book review.
    await a.page.evaluate(async q => {
      const { mistakeStore } = await import('/browser-store.js?v=12'); await mistakeStore.record([q], [null]);
    }, sample);
    await a.page.getByText(/错题已自动同步/).waitFor();
    b.page.once('dialog', dialog => dialog.accept()); await b.page.goto(origin + '/mistakes.html');
    await b.page.locator('.mistake').waitFor(); await b.page.locator('.mistake > summary').click();
    await add(a.page, 17, 22); await a.page.getByText('已高亮，保存在本机；登录后自动云同步。', { exact: true }).waitFor();
    await a.page.getByText(/错题已自动同步/).waitFor(); await sync(b.page); await has(b.page, ['delta']);
    assert.equal(await b.page.locator('.mistake').getAttribute('open'), '');
    assert.deepEqual(errors, []);
    console.log('PASS legacy highlight migration, native pen cloud save, fresh-device restore, independent offline edits, erase propagation, stale-cache suppression and highlight-only backup/restore');
  } finally { await browser.close(); await new Promise(resolve => api.server.close(resolve)); api.closeDatabase(); }
})().catch(error => { console.error(error); process.exit(1); });
