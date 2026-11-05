import { createReadStream, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

const roots = new Set(['index.html', 'mistakes.html', 'styles.css', 'common.js', 'bank-loader.js',
  'practice.js', 'mistakes.js', 'browser-store.js', 'mistake-store.js', 'progress.js',
  'cloud-sync.js', 'pdf-source.js', 'cloud-config.json']);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.pdf': 'application/pdf', '.gz': 'application/gzip',
  '.wasm': 'application/wasm', '.ttf': 'font/ttf' };

export function serveStatic(request, response, directory) {
  if (!directory || !['GET', 'HEAD'].includes(request.method)) return false;
  let path;
  try { path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400); response.end(); return true; }
  if (path === '/') path = '/index.html';
  const relative = path.slice(1);
  if (!roots.has(relative) && !/^(bank|sources|vendor\/pdfjs)\/[A-Za-z0-9_.\/-]+$/.test(relative)) return false;
  const root = resolve(directory), file = resolve(root, relative);
  if (!file.startsWith(root + sep) || relative.split('/').some(part => part === '..' || part.startsWith('.'))) {
    response.writeHead(404); response.end(); return true;
  }
  let size;
  try { const stat = statSync(file); if (!stat.isFile()) return false; size = stat.size; }
  catch { response.writeHead(404); response.end(); return true; }
  const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes',
    'Cache-Control': /\.html$|(?:^|\/)manifest\.json$|^cloud-config\.json$/.test(relative)
      ? 'no-cache' : /^bank\/.+\.[a-f0-9]{16}\.json\.gz$/.test(relative)
        ? 'public, max-age=31536000, immutable' : 'public, max-age=3600' };
  let start = 0, end = size - 1, status = 200;
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(size - 1, Number(match[2])); }
    }
    if (!match || !match[1] && !match[2] || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || !size) {
      response.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` }); response.end(); return true;
    }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = Math.max(0, end - start + 1);
  response.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  response.writeHead(status, headers);
  if (request.method === 'HEAD' || !size) { response.end(); return true; }
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response);
  return true;
}
