import { mistakeStore } from './browser-store.js?v=12';
import { HIGHLIGHT_PREFIX as PREFIX, mergeRanges, removeRange, mergeHighlights, highlightRanges, highlightChange, cachedHighlight, segmentHitsRect } from './highlight-core.js?v=1';
export { mergeRanges, removeRange, segmentHitsRect } from './highlight-core.js?v=1';
const memory = new Map();
const controllers = new WeakMap();

function glyphs(state) {
  const nodes = [], walker = document.createTreeWalker(state.stem, NodeFilter.SHOW_TEXT);
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.length) { nodes.push({ node, start: offset, end: offset + node.length }); offset += node.length; }
  }
  if (!nodes.length) return [];
  function position(index) {
    let left = 0, right = nodes.length - 1;
    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      if (nodes[middle].end < index) left = middle + 1; else right = middle;
    }
    return [nodes[left].node, index - nodes[left].start];
  }
  let fallbackOffset = 0;
  const segments = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(state.text)]
    : Array.from(state.text, segment => { const item = { segment, index: fallbackOffset }; fallbackOffset += segment.length; return item; });
  return segments.flatMap(({ index, segment }) => {
    const range = document.createRange(), end = index + segment.length;
    range.setStart(...position(index)); range.setEnd(...position(end));
    return [...range.getClientRects()].filter(rect => rect.width && rect.height)
      .map(rect => ({ start: index, end, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }));
  });
}

function read(id, text) {
  const records = [];
  let unavailable = false;
  try { records.push(...mistakeStore.readHighlights().filter(record => record.questionId === id && record.text === text)); }
  catch { unavailable = true; }
  try {
    const cached = cachedHighlight(id, JSON.parse(localStorage.getItem(PREFIX + id) || 'null'));
    if (cached?.text === text) records.push(cached);
  } catch { /* Keep the IndexedDB copy readable. */ }
  const pending = memory.get(id);
  if (pending?.text === text) records.push(pending);
  const record = records.reduce((merged, record) => mergeHighlights(merged, [record]), [])[0] || { questionId: id, text, operations: [] };
  return { record, ranges: highlightRanges(record), unavailable };
}

function paint(state) {
  const fragment = document.createDocumentFragment();
  let offset = 0;
  for (const [start, end] of state.ranges) {
    fragment.append(document.createTextNode(state.text.slice(offset, start)));
    const mark = document.createElement('mark');
    mark.className = 'stem-highlight';
    mark.textContent = state.text.slice(start, end);
    fragment.append(mark);
    offset = end;
  }
  fragment.append(document.createTextNode(state.text.slice(offset)));
  state.stem.replaceChildren(fragment);
  state.toolbar.querySelector('[data-highlight="clear"]').disabled = !state.ranges.length;
}

class Highlighter {
  constructor(root) {
    this.root = root;
    this.states = [];
    this.pending = null;
    this.penMode = null;
    this.stroke = null;
    this.finger = null;
    document.addEventListener('selectionchange', () => this.selection());
    // Keep the native text selection when a mouse or finger presses the toolbar.
    root.addEventListener('pointerdown', event => {
      if (event.target.closest('[data-highlight]')) {
        this.selection(); event.preventDefault(); return;
      }
      this.pointerDown(event);
    });
    root.addEventListener('pointermove', event => this.pointerMove(event), { passive: false });
    root.addEventListener('pointerup', event => this.pointerUp(event));
    root.addEventListener('pointercancel', event => this.pointerCancel(event));
    root.addEventListener('lostpointercapture', event => this.pointerCancel(event));
    root.addEventListener('contextmenu', event => {
      if (this.penMode && this.states.some(state => state.stem.contains(event.target))) event.preventDefault();
    });
    window.addEventListener('blur', () => this.cancelStroke());
    window.addEventListener('resize', () => this.cancelStroke());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancelStroke(); });
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-highlight]');
      if (!button || button.disabled) return;
      const state = this.states.find(item => item.toolbar.contains(button));
      if (!state) return;
      const action = button.dataset.highlight;
      if (action === 'pen' || action === 'eraser') {
        this.cancelStroke();
        this.penMode = this.penMode === action ? null : action;
        document.getSelection()?.removeAllRanges();
        this.updateMode(); this.selection(); return;
      }
      this.cancelStroke();
      if (action !== 'clear' && this.pending?.state !== state) return;
      this.save(state, action === 'clear' ? [[0, state.text.length]] : [this.pending.range], action === 'add');
      document.getSelection()?.removeAllRanges();
      this.selection();
    });
    window.addEventListener('mbe:cloud-synced', () => this.refreshSaved());
    window.addEventListener('mbe:local-refreshed', () => this.refreshSaved());
    window.addEventListener('mbe:highlights-changed', () => this.refreshSaved());
    mistakeStore.ready.then(() => this.refreshSaved());
    window.addEventListener('storage', event => {
      if (event.key !== null && !event.key.startsWith(PREFIX)) return;
      this.cancelStroke();
      for (const state of this.states) {
        if (event.key !== null && event.key !== PREFIX + state.id) continue;
        memory.delete(state.id);
        state.ranges = read(state.id, state.text).ranges;
        paint(state);
      }
      this.selection();
      mistakeStore.importHighlightCache().then(() => this.refreshSaved()).catch(() => {});
    });
  }

  async save(state, affected, adding) {
    const record = highlightChange(read(state.id, state.text).record, adding ? 'add' : 'remove', affected);
    memory.set(state.id, record);
    let cached = true;
    try { localStorage.setItem(PREFIX + state.id, JSON.stringify({ ...record, ranges: highlightRanges(record) })); }
    catch { cached = false; }
    for (const item of this.states.filter(item => item.id === state.id && item.text === state.text)) {
      item.ranges = highlightRanges(record); paint(item); item.status.textContent = '正在保存高亮…';
    }
    let saved = true;
    try { await mistakeStore.mergeHighlights([record]); }
    catch { saved = false; }
    for (const item of this.states.filter(item => item.id === state.id && item.text === state.text)) {
      if (this.stroke?.state === item) continue;
      const latest = read(item.id, item.text).ranges;
      if (JSON.stringify(latest) !== JSON.stringify(item.ranges)) { item.ranges = latest; paint(item); }
      item.unavailable = !saved;
      item.status.textContent = saved ? (adding ? '已高亮，保存在本机；登录后自动云同步。' : '已取消高亮，保存在本机；登录后自动云同步。')
        : cached ? '已保存在本机缓存，暂未写入同步存储，请保留页面并刷新重试。'
          : '本机保存失败，标记仅在本页暂存；请检查浏览器存储权限或空间。';
    }
  }

  refreshSaved() {
    for (const state of this.states) {
      if (!state.stem.isConnected || this.stroke?.state === state) continue;
      const stored = read(state.id, state.text);
      if (JSON.stringify(stored.ranges) !== JSON.stringify(state.ranges)) { state.ranges = stored.ranges; paint(state); }
      state.unavailable = stored.unavailable;
    }
    this.selection();
  }

  updateMode() {
    for (const state of this.states) {
      state.stem.classList.toggle('pen-enabled', Boolean(this.penMode));
      for (const action of ['pen', 'eraser']) state.toolbar.querySelector(`[data-highlight="${action}"]`)
        .setAttribute('aria-pressed', String(this.penMode === action));
      state.status.textContent = this.penMode
        ? `用 Apple Pencil 划过题干${this.penMode === 'pen' ? '高亮' : '擦除高亮'}；手指拖动可滚动。标记在本机保存，登录后自动云同步。`
        : '选中文字后可高亮；也可开启“笔高亮”使用 Apple Pencil。本机保存，登录后自动云同步。';
      if (state.unavailable) state.status.textContent = '本机存储不可用，标记仅在本页暂存。' + state.status.textContent;
    }
  }

  pointerDown(event) {
    if (!this.penMode) return;
    const state = this.states.find(item => item.stem.contains(event.target));
    if (!state) return;
    if (event.pointerType === 'touch') {
      // A resting palm must neither mark text nor scroll during a pen stroke.
      if (this.stroke || this.finger || !event.isPrimary) return;
      this.finger = { id: event.pointerId, y: event.clientY };
    } else if (event.pointerType === 'pen' && (event.button === 0 || event.button === 5)) {
      if (this.stroke) return;
      this.finger = null;
      this.stroke = { id: event.pointerId, state, base: state.ranges.map(range => [...range]), glyphs: glyphs(state),
        touched: new Map(), previous: { x: event.clientX, y: event.clientY }, erasing: this.penMode === 'eraser' || event.button === 5 };
      document.getSelection()?.removeAllRanges();
      this.pointerMove(event);
    } else return;
    event.preventDefault();
    try { state.stem.setPointerCapture(event.pointerId); } catch { /* Synthetic events and older browsers may not capture. */ }
  }

  pointerMove(event) {
    if (this.finger?.id === event.pointerId && !this.stroke) {
      event.preventDefault();
      window.scrollBy(0, this.finger.y - event.clientY); this.finger.y = event.clientY; return;
    }
    const stroke = this.stroke;
    if (!stroke || stroke.id !== event.pointerId) return;
    event.preventDefault();
    const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    for (const sample of [...samples, event]) {
      const point = { x: sample.clientX, y: sample.clientY };
      for (const glyph of stroke.glyphs) if (segmentHitsRect(stroke.previous, point, glyph)) {
        stroke.touched.set(glyph.start, [glyph.start, glyph.end]);
      }
      stroke.previous = point;
    }
    const touched = mergeRanges([...stroke.touched.values()], stroke.state.text.length);
    const ranges = stroke.erasing ? touched.reduce((ranges, range) => removeRange(ranges, range), stroke.base)
      : mergeRanges([...stroke.base, ...touched], stroke.state.text.length);
    if (JSON.stringify(ranges) !== JSON.stringify(stroke.state.ranges)) { stroke.state.ranges = ranges; paint(stroke.state); }
  }

  pointerUp(event) {
    if (this.finger?.id === event.pointerId) this.finger = null;
    if (this.stroke?.id !== event.pointerId) return;
    this.pointerMove(event);
    const stroke = this.stroke;
    this.stroke = null;
    if (stroke.touched.size) this.save(stroke.state, [...stroke.touched.values()], !stroke.erasing);
    this.selection();
  }

  pointerCancel(event) {
    if (this.finger?.id === event.pointerId) this.finger = null;
    if (this.stroke?.id === event.pointerId) this.cancelStroke();
  }

  cancelStroke() {
    this.finger = null;
    if (!this.stroke) return;
    const { state, base } = this.stroke;
    this.stroke = null; state.ranges = base; paint(state);
  }

  selection() {
    this.pending = null;
    const selection = document.getSelection();
    if (selection?.rangeCount === 1 && !selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      const state = this.states.find(item => item.stem.contains(range.startContainer)
        && item.stem.contains(range.endContainer));
      if (state) {
        const prefix = range.cloneRange();
        prefix.selectNodeContents(state.stem);
        prefix.setEnd(range.startContainer, range.startOffset);
        const start = prefix.toString().length, end = start + range.toString().length;
        if (end > start && end <= state.text.length) this.pending = { state, range: [start, end] };
      }
    }
    for (const state of this.states) {
      const selected = !this.penMode && this.pending?.state === state;
      state.toolbar.querySelector('[data-highlight="add"]').disabled = !selected;
      state.toolbar.querySelector('[data-highlight="remove"]').disabled = !selected
        || !state.ranges.some(([start, end]) => start < this.pending.range[1] && end > this.pending.range[0]);
    }
  }

  mount() {
    this.cancelStroke();
    this.root.querySelectorAll('.highlight-tools').forEach(toolbar => toolbar.remove());
    this.pending = null;
    this.states = [...this.root.querySelectorAll('.question[data-question-id]')].map(stem => {
      const text = stem.textContent, id = stem.dataset.questionId;
      const stored = read(id, text);
      const toolbar = document.createElement('div');
      toolbar.className = 'highlight-tools';
      toolbar.innerHTML = '<div class="highlight-actions" role="group" aria-label="题干高亮">'
        + '<button type="button" data-highlight="pen" aria-pressed="false">笔高亮</button>'
        + '<button type="button" data-highlight="eraser" aria-pressed="false">笔擦除</button>'
        + '<button type="button" data-highlight="add" disabled>高亮选中</button>'
        + '<button type="button" data-highlight="remove" disabled>取消选中高亮</button>'
        + '<button type="button" data-highlight="clear" disabled>清除本题高亮</button></div>'
        + '<p class="highlight-status" role="status"></p>';
      stem.before(toolbar);
      const status = toolbar.querySelector('.highlight-status');
      status.textContent = stored.unavailable ? '本机存储不可用，标记仅在本页暂存。'
        : '选中题干文字后可高亮；手机长按选择。本机保存，登录后自动云同步。';
      for (const action of ['pen', 'eraser']) toolbar.querySelector(`[data-highlight="${action}"]`).disabled = !('PointerEvent' in window);
      const state = { stem, text, id, ranges: stored.ranges, toolbar, status, unavailable: stored.unavailable };
      paint(state);
      return state;
    });
    if (this.penMode) this.updateMode();
  }
}

export function mountHighlights(root) {
  if (!controllers.has(root)) controllers.set(root, new Highlighter(root));
  controllers.get(root).mount();
}
