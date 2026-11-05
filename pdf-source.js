// Original pages are rendered locally. No third-party scripts or document services are used.
const mounts = new WeakMap();
const documents = new Map();
const DOCUMENT_CACHE_LIMIT = 2;
let library;
let libraryAttempt = 0;

function pdfLibrary() {
  if (!library) {
    const moduleUrl = new URL('./vendor/pdfjs/pdf.mjs', import.meta.url);
    const workerUrl = new URL('./vendor/pdfjs/pdf.worker.mjs', import.meta.url);
    const attempt = libraryAttempt++;
    // Browsers remember failed module imports for a URL until navigation.
    if (attempt) {
      moduleUrl.searchParams.set('retry', attempt);
      workerUrl.searchParams.set('retry', attempt);
    }
    library = import(moduleUrl.href).then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.href;
      return pdfjs;
    }).catch(error => { library = null; throw error; });
  }
  return library;
}

function trimDocuments() {
  for (const [path, entry] of documents) {
    if (documents.size <= DOCUMENT_CACHE_LIMIT) break;
    if (entry.users) continue;
    documents.delete(path);
    // Loaded canvas pixels are independent of the document, so an unused PDF can be freed.
    entry.promise.then(document => document.destroy()).catch(() => {});
  }
}

async function acquireDocument(path) {
  let entry = documents.get(path);
  if (!entry) {
    entry = { users: 0, promise: null };
    const loadingLibrary = pdfLibrary();
    let loadingTask;
    entry.promise = loadingLibrary.then(pdfjs => {
      loadingTask = pdfjs.getDocument({
        url: new URL(path, document.baseURI).href,
        standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href,
        cMapUrl: new URL('./vendor/pdfjs/cmaps/', import.meta.url).href,
        cMapPacked: true,
        wasmUrl: new URL('./vendor/pdfjs/wasm/', import.meta.url).href,
        iccUrl: new URL('./vendor/pdfjs/iccs/', import.meta.url).href,
        disableAutoFetch: true,
        disableStream: true,
        isEvalSupported: false,
      });
      return loadingTask.promise;
    }).catch(async error => {
      if (documents.get(path) === entry) documents.delete(path);
      // PDF.js also retains a rejected fake-worker import internally. A fresh
      // library/worker URL allows retry after that temporary download failure.
      if (/worker/i.test(error?.message || '') && library === loadingLibrary) library = null;
      // A failed PDF download still owns a worker until its loading task is destroyed.
      try { await loadingTask?.destroy(); } catch { /* Retain the original loading error. */ }
      throw error;
    });
    documents.set(path, entry);
  } else {
    documents.delete(path);
    documents.set(path, entry);
  }
  entry.users++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    entry.users--;
    trimDocuments();
  };
  try { return { document: await entry.promise, release }; }
  catch (error) { release(); throw error; }
}

export function unmountSourcePages(container) {
  mounts.get(container)?.destroy();
  mounts.delete(container);
}

export function mountSourcePages(container) {
  unmountSourcePages(container);
  const figures = [...container.querySelectorAll('.pdf-source-page')];
  if (!figures.length) return;
  let alive = true, running = 0, resizeFrame = null;
  const queue = [];
  const models = new Map(figures.map(figure => [figure, {
    figure, surface: figure.querySelector('.pdf-page-surface'),
    status: figure.querySelector('.pdf-page-status'),
    path: figure.dataset.pdfPath, pageNumber: Number(figure.dataset.pdfPage),
    state: 'idle', token: 0, visible: false, canvas: null, task: null,
  }]));
  const exposed = model => !model.figure.closest('details:not([open])');
  const valid = (model, token) => alive && model.token === token && model.figure.isConnected && exposed(model);

  function reset(model) {
    model.token++;
    model.task?.cancel();
    model.task = null;
    if (model.canvas) {
      model.canvas.width = model.canvas.height = 0;
      model.canvas.remove();
      model.canvas = null;
    }
    model.state = 'idle';
    model.status.hidden = false;
    model.status.textContent = '浏览到这里时载入原文页面…';
    model.surface.classList.remove('pdf-page-error');
  }

  async function render(model) {
    const token = ++model.token;
    let handle, page, task;
    model.state = 'rendering';
    model.status.textContent = '正在载入原文页面…';
    try {
      if (!/^sources\/[a-z0-9-]+\.pdf$/.test(model.path) || !Number.isInteger(model.pageNumber) || model.pageNumber < 1) {
        throw new Error('Invalid source page');
      }
      handle = await acquireDocument(model.path);
      if (!valid(model, token)) return;
      page = await handle.document.getPage(model.pageNumber);
      if (!valid(model, token)) return;
      const natural = page.getViewport({ scale: 1 });
      const width = Math.max(1, model.surface.clientWidth);
      const viewport = page.getViewport({ scale: width / natural.width });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      model.surface.style.aspectRatio = `${natural.width} / ${natural.height}`;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width * ratio));
      canvas.height = Math.max(1, Math.ceil(viewport.height * ratio));
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', model.surface.getAttribute('aria-label'));
      model.canvas = canvas;
      model.surface.append(canvas);
      task = page.render({
        canvasContext: canvas.getContext('2d'), viewport,
        transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
        background: '#ffffff',
      });
      model.task = task;
      await task.promise;
      if (!valid(model, token)) return;
      model.state = 'ready';
      model.status.hidden = true;
    } catch (error) {
      if (!valid(model, token) || error?.name === 'RenderingCancelledException') return;
      if (model.canvas) {
        model.canvas.width = model.canvas.height = 0;
        model.canvas.remove();
        model.canvas = null;
      }
      model.state = 'error';
      model.surface.classList.add('pdf-page-error');
      model.status.replaceChildren(document.createTextNode('页面暂未载入，可使用上方“打开原始 PDF”查看。'));
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'secondary pdf-page-retry';
      retry.textContent = '重试载入';
      model.status.append(document.createElement('br'), retry);
    } finally {
      if (model.task === task) model.task = null;
      page?.cleanup();
      handle?.release();
    }
  }

  function pump() {
    while (alive && running < 2 && queue.length) {
      const model = queue.shift();
      if (model.state !== 'queued') continue;
      if (!model.visible || !exposed(model)) { model.state = 'idle'; continue; }
      running++;
      render(model).finally(() => { running--; pump(); });
    }
  }

  function enqueue(model) {
    if (!alive || model.state !== 'idle' || !model.visible || !exposed(model)) return;
    model.state = 'queued';
    queue.push(model);
    pump();
  }

  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      const model = models.get(entry.target);
      model.visible = entry.isIntersecting;
      if (model.visible) enqueue(model);
      else if (model.state !== 'error') reset(model);
    }
  }, { rootMargin: '700px 0px' }) : null;

  function refreshVisibility() {
    for (const model of models.values()) {
      if (observer) { observer.unobserve(model.figure); observer.observe(model.figure); }
      else {
        const bounds = model.figure.getBoundingClientRect();
        model.visible = bounds.bottom >= -700 && bounds.top <= innerHeight + 700 && exposed(model);
        if (model.visible) enqueue(model);
        else if (model.state !== 'error') reset(model);
      }
    }
  }

  function onToggle(event) {
    if (event.target.tagName !== 'DETAILS') return;
    if (!event.target.open) {
      for (const model of models.values()) if (event.target.contains(model.figure)) reset(model);
    }
    refreshVisibility();
  }

  function onClick(event) {
    if (!event.target.closest('.pdf-page-retry')) return;
    const model = models.get(event.target.closest('.pdf-source-page'));
    if (!model) return;
    reset(model);
    enqueue(model);
  }

  let width = container.clientWidth, pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  function onResize() {
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      const nextRatio = Math.min(window.devicePixelRatio || 1, 2);
      if (Math.abs(width - container.clientWidth) < 2 && nextRatio === pixelRatio) return;
      width = container.clientWidth;
      pixelRatio = nextRatio;
      for (const model of models.values()) { reset(model); enqueue(model); }
      refreshVisibility();
    });
  }
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
  resizeObserver?.observe(container);
  container.addEventListener('toggle', onToggle, true);
  container.addEventListener('click', onClick);
  window.addEventListener('resize', onResize);
  if (!observer) window.addEventListener('scroll', refreshVisibility, { passive: true });
  refreshVisibility();
  mounts.set(container, { destroy() {
    alive = false;
    observer?.disconnect();
    resizeObserver?.disconnect();
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    container.removeEventListener('toggle', onToggle, true);
    container.removeEventListener('click', onClick);
    window.removeEventListener('resize', onResize);
    if (!observer) window.removeEventListener('scroll', refreshVisibility);
    queue.length = 0;
    for (const model of models.values()) reset(model);
  } });
}
