import { publicAssets } from './public-assets.js?v=1';
const READABLE = '.question,.choice-text,.option span:last-child,.ro,.history-stem,.history-choices li span:last-child,.extracted-content,.textLayer span,.flashcard-front,.flashcard-back';
const WORD = /^[a-z]+(?:'[a-z]+)*$/i;
let dictionary, timer, selectionTimer, press = null, request = 0, panel;
const normal = word => word.trim().replaceAll('’', "'").toLowerCase();

async function words() {
  if (!dictionary) dictionary = (async () => {
    const info = await publicAssets.json('dictionary/manifest.json');
    if (info.version !== 1 || !/^words\.[a-f0-9]{16}\.json\.gz$/.test(info.file) || !/^[a-f0-9]{64}$/.test(info.sha256)) throw new Error('词典目录格式不正确');
    const bytes = await publicAssets.bytes('dictionary/' + info.file, info);
    const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const data = JSON.parse(text);
    if (Object.keys(data).length !== info.entries) throw new Error('词典内容不完整');
    return data;
  })().catch(error => { dictionary = null; throw error; });
  return dictionary;
}

function close() { request++; clearTimeout(timer); clearTimeout(selectionTimer); if (panel) panel.hidden = true; }
function popup(word) {
  if (!panel) {
    panel = document.createElement('aside'); panel.className = 'word-translation'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '单词中文释义');
    panel.innerHTML = '<button type="button" class="word-close" aria-label="关闭单词释义">×</button><strong></strong><div class="word-definition" role="status"></div><p class="word-source">ECDICT 本地词典 · 法律词另列常用义，请结合上下文</p>';
    panel.querySelector('button').addEventListener('click', close); document.body.append(panel);
  }
  panel.hidden = false; panel.querySelector('strong').textContent = word;
  return panel.querySelector('.word-definition');
}
async function translate(word) {
  word = normal(word);
  if (!WORD.test(word) || word.length > 64) return;
  const token = ++request, target = popup(word); target.textContent = '正在载入中文释义…';
  try {
    const dictionary = await words(); if (token !== request) return;
    const entry = dictionary[word] || dictionary[word.replace(/'s$/, '')];
    target.replaceChildren();
    if (!entry) { target.textContent = '本地词典暂未收录这个词。'; return; }
    for (const [label, value] of [['法律常用义', entry.legal], ['词典释义', entry.translation]]) {
      if (typeof value !== 'string' || !value) continue;
      const p = document.createElement('p'), strong = document.createElement('b');
      strong.textContent = label + '：'; p.append(strong, document.createTextNode(value)); target.append(p);
    }
  } catch {
    if (token !== request) return;
    target.textContent = '词典暂时无法载入，请重试。';
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'secondary'; retry.textContent = '重试翻译';
    retry.addEventListener('click', () => translate(word)); target.append(retry);
  }
}

function scopeFor(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const scope = element?.closest(READABLE);
  return scope?.closest('.pen-enabled') ? null : scope;
}
function wordAtPoint(x, y) {
  const caret = document.caretPositionFromPoint?.(x, y), range = !caret && document.caretRangeFromPoint?.(x, y);
  const node = caret?.offsetNode || range?.startContainer, offset = caret?.offset ?? range?.startOffset;
  const scope = scopeFor(node);
  if (!scope || node.nodeType !== Node.TEXT_NODE) return null;
  const prefix = document.createRange(); prefix.selectNodeContents(scope); prefix.setEnd(node, offset);
  const index = prefix.toString().length;
  for (const match of scope.textContent.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)) {
    if (index >= match.index && index <= match.index + match[0].length) return match[0];
  }
  return null;
}

document.addEventListener('pointerdown', event => {
  suppressUntil = 0;
  clearTimeout(timer); press = null;
  if (event.button !== 0 || !scopeFor(event.target)) return;
  press = { id: event.pointerId, x: event.clientX, y: event.clientY, shown: false };
  timer = setTimeout(() => {
    if (!press) return;
    const word = wordAtPoint(press.x, press.y);
    if (word) { press.shown = true; translate(word); }
  }, 600);
});
document.addEventListener('pointermove', event => {
  if (press?.id === event.pointerId && Math.hypot(press.x - event.clientX, press.y - event.clientY) > 10) { clearTimeout(timer); press = null; }
}, { passive: true });
let suppressUntil = 0;
document.addEventListener('pointerup', () => { clearTimeout(timer); if (press?.shown) suppressUntil = Date.now() + 800; press = null; });
document.addEventListener('pointercancel', () => { clearTimeout(timer); press = null; });
document.addEventListener('click', event => {
  if (Date.now() < suppressUntil && scopeFor(event.target)) { suppressUntil = 0; event.preventDefault(); event.stopImmediatePropagation(); }
}, true);
document.addEventListener('selectionchange', () => {
  clearTimeout(selectionTimer);
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !scopeFor(selection.anchorNode) || !scopeFor(selection.focusNode)) return;
  const word = selection.toString().trim();
  if (WORD.test(normal(word))) selectionTimer = setTimeout(() => translate(word), 350);
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
window.addEventListener('pagehide', close);
