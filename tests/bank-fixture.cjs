const { gzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const SUBJECTS = ['civil-procedure','constitutional-law','contracts','criminal-law','criminal-procedure','evidence','real-property','torts'];

function bankFixture(questions) {
  const files = new Map(), subjects = {};
  for (const subject of SUBJECTS) {
    const subset = questions.filter(q => q.subject === subject);
    const body = gzipSync(Buffer.from(JSON.stringify(subset)));
    const sha256 = createHash('sha256').update(body).digest('hex');
    const file = `${subject}.${sha256.slice(0,16)}.json.gz`;
    files.set(file, body); subjects[subject] = { count: subset.length, file, sha256, bytes: body.length };
  }
  return { manifest: { version: 1, total: questions.length, subjects }, files };
}
async function routeBank(context, questions) {
  const fixture = bankFixture(questions);
  await context.route('**/bank/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (name === 'manifest.json') return route.fulfill({ json: fixture.manifest, headers: { 'Access-Control-Allow-Origin': '*' } });
    const body = fixture.files.get(name);
    return body ? route.fulfill({ body, contentType: 'application/gzip', headers: { 'Access-Control-Allow-Origin': '*' } }) : route.fulfill({ status: 404 });
  });
  return fixture;
}
module.exports = { bankFixture, routeBank };
