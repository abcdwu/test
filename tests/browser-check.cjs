const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');
const { createHash } = require('node:crypto');
const url = process.env.MBE_TEST_ORIGIN || 'http://127.0.0.1:8080';
const root = path.resolve(__dirname, '..');
const metadata=JSON.parse(fs.readFileSync(path.join(root,'question-metadata.json')));
const bank=JSON.parse(zlib.gunzipSync(Buffer.from(fs.readFileSync(path.join(root,'questions.txt'),'utf8'),'base64'))).map((q,i)=>({...q,...metadata.questions[i]}));
const errors=[];
async function entries(page) { return page.evaluate(async()=>{const {mistakeStore}=await import('/browser-store.js?v=3');await mistakeStore.ready;return mistakeStore.read()}); }
async function record(page,questions) {return page.evaluate(async(q)=>{const {mistakeStore}=await import('/browser-store.js?v=3');await mistakeStore.ready;await mistakeStore.record(q,q.map(()=>null));},questions);}
async function open(page,pathname='') {page.on('pageerror',e=>errors.push(e.message));await page.goto(`${url}/${pathname}`);}
async function submitAllBlank(page,count=5){await page.getByRole('button',{name:`${count} 题`,exact:true}).click();await page.getByRole('button',{name:'开始练习',exact:true}).click();for(let i=0;i<count-1;i++)await page.locator('#next').click();page.once('dialog',d=>d.accept());await page.locator('#submit').click();await page.getByRole('heading',{name:'练习完成。'}).waitFor();}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),args:['--no-sandbox']});
 const context=await browser.newContext();const page=await context.newPage();await page.clock.install();
 await open(page); await page.locator('#start').waitFor();assert.equal(await page.locator('#subject option').count(),9);
 for(const subject of [...new Set(metadata.questions.map(q=>q.subject))]){
  await page.locator('#subject').selectOption(subject);await page.locator('#start').click();
  const stem=await page.locator('.card .question').textContent();assert.equal(bank.find(q=>q.stem===stem).subject,subject);
  page.once('dialog',d=>d.accept());await page.locator('#exit').click();
 }
 console.log('PASS eight subject selections draw from the correct bank');
 await page.locator('#subject').selectOption('torts');await page.getByRole('button',{name:'5 题',exact:true}).click();await page.locator('#start').click();
 await page.clock.runFor(2200);assert.equal(await page.locator('#clock').textContent(),'00:02');
 let stem=await page.locator('.card .question').textContent();let q=bank.find(q=>q.stem===stem);await page.locator(`[data-choice="${'ABCD'.indexOf(q.answer)}"]`).click();
 await page.locator('#next').click();assert.equal(await page.locator('#clock').textContent(),'00:02');
 stem=await page.locator('.card .question').textContent();q=bank.find(q=>q.stem===stem);await page.locator(`[data-choice="${('ABCD'.indexOf(q.answer)+1)%4}"]`).click();
 await page.locator('#previous').click();assert.equal(await page.locator('.option.selected').count(),1);await page.locator('#next').click();
 for(let i=1;i<4;i++)await page.locator('#next').click();page.once('dialog',d=>d.accept());await page.locator('#submit').click();await page.getByRole('heading',{name:'练习完成。'}).waitFor();
 assert.equal((await entries(page)).length,4);assert.ok((await entries(page)).every(e=>e.question.subject==='torts'));
 await page.reload();await page.locator('#start').waitFor();assert.equal((await entries(page)).length,4);
 await page.goto(url+'/mistakes.html');await page.getByRole('heading',{name:'错题本。',exact:true}).waitFor();assert.equal(await page.locator('details.mistake').count(),4);
 await page.locator('details.mistake').first().locator(':scope > summary').click();assert.ok(await page.locator('details.mistake').first().locator('.explain').isVisible());
 await page.locator('#subject').selectOption('contracts');assert.equal(await page.locator('details.mistake').count(),0);assert.ok(await page.getByText('这里还没有错题。').isVisible());
 await page.locator('#subject').selectOption('torts');await page.getByRole('link',{name:'重练当前科目的错题 →'}).click();await page.locator('#timer-mode').selectOption('countdown');await page.getByRole('button',{name:'20 题',exact:true}).click();
 assert.match(await page.locator('.timing-hint').textContent(),/4 题.*07:12/);await page.locator('#start').click();assert.match(await page.locator('.meta').textContent(),/1 \/ 4/);
 await page.clock.fastForward(432_000);await page.getByRole('heading',{name:'练习完成。'}).waitFor();assert.ok(await page.getByText('倒计时已结束，已自动交卷。').isVisible());assert.ok((await entries(page)).every(e=>e.wrongCount===2));
 console.log('PASS natural timer, navigation, manual submission, persistence, filters, short-bank countdown and auto submission');
 await page.goto(url+'/mistakes.html');await page.getByText('手动备份与恢复（可选）').click();
 const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;const backup=fs.readFileSync(await download.path(),'utf8');assert.equal(JSON.parse(backup).entries.length,4);
 const fresh=await browser.newContext();const restored=await fresh.newPage();await open(restored,'mistakes.html');await restored.getByText('手动备份与恢复（可选）').click();await restored.locator('#backup-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});await restored.getByText('恢复完成：新增 4 道，目前共 4 道错题。').waitFor();
 assert.equal((await entries(restored)).length,4);await restored.locator('#backup-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});await restored.getByText('恢复完成：新增 0 道，目前共 4 道错题。').waitFor();assert.ok((await entries(restored)).every(e=>e.wrongCount===2));
 await restored.setViewportSize({width:390,height:844});await restored.goto(url);await restored.locator('#start').waitFor();assert.equal(await restored.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await restored.screenshot({path:'/tmp/mbe-mobile.png',fullPage:true});
 console.log('PASS backup round trip, repeated restore and mobile layout');
 const tab=await fresh.newPage();await open(tab);await tab.locator('#start').waitFor();await Promise.all([record(restored,[bank[0]]),record(tab,[bank[1]])]);
 await restored.waitForFunction(async()=>{const {mistakeStore}=await import('/browser-store.js?v=3');return mistakeStore.read().length===6});assert.equal((await entries(restored)).length,6);
 console.log('PASS simultaneous tabs preserve both edits');
 const {createApi}=await import(root+'/server/api.js');const temp=fs.mkdtempSync('/tmp/mbe-cloud-ui-');const api=createApi({databasePath:path.join(temp,'db.sqlite'),loginPassword:'test-only-private-password',allowedOrigins:[url]});await new Promise(r=>api.server.listen(0,'127.0.0.1',r));const apiBase=`http://127.0.0.1:${api.server.address().port}`;
 try{
  const cloudContext=await browser.newContext();await cloudContext.route('**/cloud-config.json*',r=>r.fulfill({json:{apiBase}}));const cloud=await cloudContext.newPage();await open(cloud);await cloud.locator('#sync-toggle').waitFor();await record(cloud,[bank[0]]);
  await cloud.locator('#sync-toggle').click();await cloud.locator('#cloud-password').fill('test-only-private-password');await cloud.getByRole('button',{name:'登录并记住此设备'}).click();await cloud.getByText(/错题已自动同步/).waitFor();
  await cloudContext.setOffline(true);await record(cloud,[bank[1]]);await cloud.getByText(/暂未同步/).waitFor();assert.equal((await entries(cloud)).length,2);await cloudContext.setOffline(false);await cloud.getByText(/错题已自动同步/).waitFor();
  const otherContext=await browser.newContext();await otherContext.route('**/cloud-config.json*',r=>r.fulfill({json:{apiBase}}));const other=await otherContext.newPage();await open(other,'mistakes.html');await other.locator('#sync-toggle').click();await other.locator('#cloud-password').fill('test-only-private-password');await other.getByRole('button',{name:'登录并记住此设备'}).click();await other.getByText(/错题已自动同步/).waitFor();await other.locator('details.mistake').nth(1).waitFor();assert.equal((await entries(other)).length,2);
  await other.reload();await other.getByText(/错题已自动同步/).waitFor();assert.equal(await other.locator('details.mistake').count(),2);
  await other.locator('details.mistake').first().locator(':scope > summary').click();await other.evaluate(async()=>{const {sync}=await import('/cloud-sync.js?v=3');await sync()});assert.ok(await other.locator('details.mistake').first().getAttribute('open')!==null);
  await cloud.screenshot({path:'/tmp/mbe-cloud-home.png',fullPage:true});await other.screenshot({path:'/tmp/mbe-mistakes.png',fullPage:true});
  console.log('PASS password login, automatic cloud save, offline retry, fresh-device restore, remembered login and stable expanded reviews');
  await cloudContext.close();await otherContext.close();
 }finally{await new Promise(r=>api.server.close(r));api.closeDatabase();fs.rmSync(temp,{recursive:true,force:true});}
 const original=bank.find(q=>q.subject==='torts'&&q.source?.explanationPages.length>1);
 assert.ok(original,'rebuilt bank includes source page references');
 const fixture=zlib.gzipSync(JSON.stringify([{stem:original.stem,choices:original.choices,answer:original.answer,explanation:original.explanation}])).toString('base64');
 const fixtureMetadata={bankSha256:createHash('sha256').update(fixture).digest('hex'),questions:[{id:original.id,subject:original.subject,source:original.source}]};
 const sourceContext=await browser.newContext({deviceScaleFactor:3});
 await sourceContext.route('**/questions.txt*',r=>r.fulfill({body:fixture}));
 await sourceContext.route('**/question-metadata.json*',r=>r.fulfill({json:fixtureMetadata}));
 const sourcePage=await sourceContext.newPage();let pdfRequests=0;sourcePage.on('request',r=>{if(r.url().includes('/sources/'))pdfRequests++});
 await open(sourcePage);await sourcePage.locator('#start').click();
 assert.equal(pdfRequests,0,'closed question pages do not download the PDF');
 assert.equal(await sourcePage.locator('.source-explanation').count(),0);
 assert.deepEqual(await sourcePage.locator('.pdf-source-page').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.pdfPage))),original.source.questionPages);
 await sourcePage.locator('.source-question summary').click();
 const questionCanvas=sourcePage.locator('.source-question canvas').first();
 await questionCanvas.waitFor({state:'visible',timeout:60_000});
 await sourcePage.locator('.source-question .pdf-page-status[hidden]').first().waitFor({state:'attached',timeout:60_000});
 assert.ok(await questionCanvas.evaluate(c=>c.width>0&&c.width<=c.clientWidth*2+2),'canvas quality caps device pixel ratio at 2');
 await questionCanvas.evaluate(c=>{c.dataset.stable='kept';window.oldSourceCanvas=c});
 await sourcePage.locator(`[data-choice="${('ABCD'.indexOf(original.answer)+1)%4}"]`).click();
 assert.equal(await sourcePage.locator('.source-question').getAttribute('open'),'');
 assert.equal(await questionCanvas.getAttribute('data-stable'),'kept','selecting an answer preserves the loaded source page');
 await sourcePage.setViewportSize({width:390,height:844});
 await sourcePage.waitForFunction(()=>{const c=document.querySelector('.source-question canvas');return c&&c.width>0&&c.width<=c.clientWidth*2+2});
 assert.equal(await sourcePage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await sourcePage.locator('#submit').click();await sourcePage.getByRole('heading',{name:'练习完成。'}).waitFor();
 assert.equal(await sourcePage.evaluate(()=>window.oldSourceCanvas.width),0,'replaced quiz canvases are released');
 const explanationPages=sourcePage.locator('.source-explanation .pdf-source-page');
 assert.deepEqual(await explanationPages.evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.pdfPage))),original.source.explanationPages);
 for(let i=0;i<original.source.explanationPages.length;i++){
  const figure=explanationPages.nth(i);await figure.scrollIntoViewIfNeeded();
  await figure.locator('.pdf-page-status[hidden]').waitFor({state:'attached',timeout:60_000});
  assert.ok(await figure.locator('canvas').evaluate(c=>c.width>0&&c.height>0));
 }
 pdfRequests=0;await sourcePage.goto(url+'/mistakes.html');await sourcePage.locator('details.mistake').waitFor();
 await sourcePage.waitForTimeout(100);assert.equal(pdfRequests,0,'closed mistakes leave all source PDFs unloaded');
 await sourcePage.locator('details.mistake > summary').click();
 await sourcePage.locator('.source-explanation .pdf-source-page').first().scrollIntoViewIfNeeded();
 await sourcePage.locator('.source-explanation .pdf-page-status[hidden]').first().waitFor({state:'attached',timeout:60_000});
 await sourcePage.screenshot({path:'/tmp/mbe-source-review-mobile.png',fullPage:true});
 console.log('PASS question-only source previews, full explanation pages, actual PDF rendering, responsive canvases, capped pixels and lazy mistake reviews');
 const fallback=await sourceContext.newPage();let failPdf=true;
 await fallback.route('**/sources/*.pdf',r=>failPdf?r.fulfill({status:404,body:'test unavailable'}):r.continue());
 await open(fallback);await fallback.locator('#start').click();await fallback.locator('.source-question summary').click();
 await fallback.locator('.pdf-page-error').waitFor({timeout:60_000});
 assert.equal(await fallback.locator('.pdf-source-page a').first().getAttribute('href'),`${original.source.pdfPath}#page=${original.source.questionPages[0]}`);
 failPdf=false;await fallback.getByRole('button',{name:'重试载入'}).first().click();
 await fallback.locator('.source-question .pdf-page-status[hidden]').first().waitFor({state:'attached',timeout:60_000});
 console.log('PASS unavailable PDF shows source link and retries successfully');await sourceContext.close();
 assert.deepEqual(errors,[]);console.log('PASS no browser errors');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
