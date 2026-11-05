const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const origin = process.env.MBE_TEST_ORIGIN || 'http://127.0.0.1:8081';
(async () => {
 const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try {
  const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true});
  await context.route('**/cloud-config.json*',r=>r.fulfill({json:{}}));
  let blockPrimaryFile = true, blockAll = false, fileRequests = 0, mirrorFiles = 0, legacyRequests = 0;
  await context.route('**/questions.txt*',r=>{legacyRequests++;return r.abort('failed')});
  await context.route('**/bank/**',r=>{
   const url=new URL(r.request().url()),file=url.pathname.split('/').pop();
   const mirror=url.hostname==='abcdwu-mbe-mistakes.fly.dev';
   if(file.endsWith('.gz')){fileRequests++;if(mirror)mirrorFiles++;}
   if(blockAll||!mirror&&blockPrimaryFile&&file.endsWith('.gz'))return r.abort('failed');
   if(!mirror)return r.continue();
   const body=fs.readFileSync(path.join(root,'bank',file));
   return r.fulfill({body,contentType:file==='manifest.json'?'application/json':'application/gzip',headers:{'Access-Control-Allow-Origin':origin}});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.locator('#start').waitFor();
  assert.equal(fileRequests,0,'homepage downloads only the 1.5KB catalogue');
  assert.equal(legacyRequests,0);assert.match(await page.locator('#subject option').first().textContent(),/1803/);
  await page.locator('#subject').selectOption('torts');await page.getByRole('button',{name:'5 题',exact:true}).click();
  await page.locator('#start').click();await page.locator('.card .question').waitFor();
  assert.ok(mirrorFiles>0,'failed GitHub subject download falls back to the public mirror');
  console.log('PASS homepage uses only the catalogue; subject starts through the mirror when the primary fails');
  page.once('dialog',d=>d.accept());await page.locator('#exit').click();
  blockAll=true;const before=fileRequests;
  await page.reload();await page.locator('#start').waitFor();
  await page.locator('#subject').selectOption('torts');await page.locator('#start').click();await page.locator('.card .question').waitFor();
  assert.equal(fileRequests,before,'verified local subject cache avoids every bank download');
  console.log('PASS cached catalogue and complete subject remain usable when both bank download routes fail');
  page.once('dialog',d=>d.accept());await page.locator('#exit').click();
  await page.locator('#subject').selectOption('civil-procedure');await page.locator('#start').click();
  await page.locator('#bank-status').waitFor({state:'visible'});
  assert.match(await page.locator('#bank-status').textContent(),/暂时无法下载/);
  blockAll=false;blockPrimaryFile=false;await page.locator('#start').click();await page.locator('.card .question').waitFor();
  assert.match(await page.locator('.subject-tag').first().textContent(),/Civil Procedure/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log('PASS an uncached failed subject can be retried without losing the catalogue or cached subjects');
  page.once('dialog',d=>d.accept());await page.locator('#exit').click();
  blockAll=true;await page.locator('#subject').selectOption('contracts');await page.locator('#start').click();
  await page.locator('#bank-status').waitFor({state:'visible'});
  blockAll=false;await page.evaluate(()=>dispatchEvent(new Event('online')));await page.locator('.card .question').waitFor();
  assert.match(await page.locator('.subject-tag').first().textContent(),/Contracts/);
  console.log('PASS reconnect automatically recovers an interrupted subject preparation');
  assert.deepEqual(errors,[]);console.log('PASS no browser errors');await context.close();
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
