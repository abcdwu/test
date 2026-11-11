const PREFIX = 'mbe-highlights:v1:';
const memory = new Map();
const controllers = new WeakMap();

export function mergeRanges(ranges, length) {
  const sorted = ranges.filter(range => Array.isArray(range) && range.length === 2
    && Number.isInteger(range[0]) && Number.isInteger(range[1])
    && range[0] >= 0 && range[0] < range[1] && range[1] <= length)
    .map(range => [...range]).sort((a, b) => a[0] - b[0]);
  const result = [];
  for (const range of sorted) {
    const last = result.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else result.push(range);
  }
  return result;
}

export function removeRange(ranges, [start, end]) {
  return ranges.flatMap(([left, right]) => {
    if (right <= start || left >= end) return [[left, right]];
    return [...(left < start ? [[left, start]] : []), ...(right > end ? [[end, right]] : [])];
  });
}

function read(id, text) {
  let record, unavailable = false;
  try { record = JSON.parse(localStorage.getItem(PREFIX + id) || 'null'); }
  catch { unavailable = true; }
  if (unavailable || memory.get(id)?.unavailable) {
    record = memory.get(id);
    unavailable = true;
  }
  return { ranges: record?.text === text && Array.isArray(record.ranges)
    ? mergeRanges(record.ranges, text.length) : [], unavailable };
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
    document.addEventListener('selectionchange', () => this.selection());
    // Keep the native text selection when a mouse or finger presses the toolbar.
    root.addEventListener('pointerdown', event => {
      if (!event.target.closest('[data-highlight]')) return;
      this.selection();
      event.preventDefault();
    });
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-highlight]');
      if (!button || button.disabled) return;
      const state = this.states.find(item => item.toolbar.contains(button));
      if (!state) return;
      const action = button.dataset.highlight;
      if (action !== 'clear' && this.pending?.state !== state) return;
      const ranges = action === 'clear' ? [] : action === 'add'
        ? mergeRanges([...state.ranges, this.pending.range], state.text.length)
        : removeRange(state.ranges, this.pending.range);
      const record = { text: state.text, ranges };
      memory.set(state.id, record);
      let saved = true;
      try {
        if (ranges.length) localStorage.setItem(PREFIX + state.id, JSON.stringify(record));
        else localStorage.removeItem(PREFIX + state.id);
      } catch { saved = false; }
      record.unavailable = !saved;
      for (const item of this.states.filter(item => item.id === state.id && item.text === state.text)) {
        item.ranges = ranges;
        paint(item);
        item.status.textContent = saved ? (action === 'add' ? '已高亮，保存在本机。' : '已取消高亮，保存在本机。')
          : '本机保存失败，标记仅在本页暂存；请检查浏览器存储权限或空间。';
      }
      document.getSelection()?.removeAllRanges();
      this.selection();
    });
    window.addEventListener('storage', event => {
      if (event.key !== null && !event.key.startsWith(PREFIX)) return;
      for (const state of this.states) {
        if (event.key !== null && event.key !== PREFIX + state.id) continue;
        memory.delete(state.id);
        state.ranges = read(state.id, state.text).ranges;
        paint(state);
      }
      this.selection();
    });
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
      const selected = this.pending?.state === state;
      state.toolbar.querySelector('[data-highlight="add"]').disabled = !selected;
      state.toolbar.querySelector('[data-highlight="remove"]').disabled = !selected
        || !state.ranges.some(([start, end]) => start < this.pending.range[1] && end > this.pending.range[0]);
    }
  }

  mount() {
    this.root.querySelectorAll('.highlight-tools').forEach(toolbar => toolbar.remove());
    this.pending = null;
    this.states = [...this.root.querySelectorAll('.question[data-question-id]')].map(stem => {
      const text = stem.textContent, id = stem.dataset.questionId;
      const stored = read(id, text);
      const toolbar = document.createElement('div');
      toolbar.className = 'highlight-tools';
      toolbar.innerHTML = '<div class="highlight-actions" role="group" aria-label="题干高亮">'
        + '<button type="button" data-highlight="add" disabled>高亮选中</button>'
        + '<button type="button" data-highlight="remove" disabled>取消选中高亮</button>'
        + '<button type="button" data-highlight="clear" disabled>清除本题高亮</button></div>'
        + '<p class="highlight-status" role="status"></p>';
      stem.before(toolbar);
      const status = toolbar.querySelector('.highlight-status');
      status.textContent = stored.unavailable ? '本机存储不可用，标记仅在本页暂存。'
        : '选中题干文字后可高亮；手机长按选择。仅保存在当前浏览器。';
      const state = { stem, text, id, ranges: stored.ranges, toolbar, status };
      paint(state);
      return state;
    });
  }
}

export function mountHighlights(root) {
  if (!controllers.has(root)) controllers.set(root, new Highlighter(root));
  controllers.get(root).mount();
}
