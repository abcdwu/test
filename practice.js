import { mountHighlights } from './highlights.js?v=1';
import {
  SUBJECTS, answerLetter, esc, filterSubject, formatTime, loadBank, loadCatalog, QuizTimer,
  questionSource, reviewQuestion, shuffle, subjectLabel, subjectOptions,
} from './common.js?v=8';
import { mountSourcePages, unmountSourcePages } from './pdf-source.js?v=3';
import { downloadBackup } from './mistake-store.js?v=9';
import { mistakeStore } from './browser-store.js?v=9';
import './cloud-sync.js?v=9';
import { accuracy, createAttempt, summarizeAttempts, roundProgress, remainingPool, historyMarkup } from './progress.js?v=10';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const fromMistakes = params.get('source') === 'mistakes';
let subject = params.get('subject') === 'all' || SUBJECTS.some(item => item.id === params.get('subject')) ? params.get('subject') : null;
let bank = [], count = 10, mode = 'natural', session = null, ticker = null;
let historyLimit = 20;
let reviewing = false;
const practiceSource = fromMistakes ? 'mistakes' : 'bank';
let bankLoading = false, catalog = null, storeReady = false, preparing = false, startToken = 0;
const knownQuestions = new Map();
const historySubjectLoads = new Map();
let historyObserver = null;
const backupLink = '<a class="text-link" href="https://abcdwu-mbe-mistakes.fly.dev/">使用备用入口 →</a>';

function cumulativeSummary() {
  if (!storeReady) return '<strong id="cumulative-rate">—</strong><p class="note">正在读取累计统计…</p>';
  try {
    const total = summarizeAttempts(mistakeStore.readAttempts());
    return `<strong id="cumulative-rate">${accuracy(total.correct, total.total)}</strong>
      <div>累计正确率<p class="note">累计答对 ${total.correct} / ${total.total} 题 · 已完成 ${total.sessions} 次练习</p>
      <p class="note">按累计答对数 ÷ 累计总题数计算，重复练习和未作答均计入。${total.sessions ? '' : '统计从本功能启用后的首次交卷开始。'}</p></div>`;
  } catch { return '<p class="notice error">累计统计暂时无法读取，请检查浏览器存储。</p>'; }
}

function updateCumulative() {
  const target = document.getElementById('cumulative-summary');
  if (target) target.innerHTML = cumulativeSummary();
}

function historySection(open = false) {
  let content = '<p class="sub">正在读取记录…</p>';
  try { if (storeReady) content = historyMarkup(mistakeStore.readAttempts(), historyLimit); }
  catch { content = '<p class="notice error">练习记录暂时无法读取，请检查浏览器存储。</p>'; }
  return `<section id="history-panel" class="card history-panel"><details ${open ? 'open' : ''}><summary>练习记录</summary>${content}</details></section>`;
}
function mountHistory() {
  historyObserver?.disconnect();
  app.querySelectorAll('[data-attempt-review]').forEach(button => button.addEventListener('click', () => showHistoryAttempt(button.dataset.attemptReview)));
  document.getElementById('history-more')?.addEventListener('click', () => {
    historyLimit += 20;
    const panel = document.getElementById('history-panel');
    panel.outerHTML = historySection(true); mountHistory();
  });
  const details = document.querySelector('#history-panel > details');
  if (!details) return;
  const observeQuestions = () => {
    historyObserver?.disconnect();
    if (!details.open) return;
    const targets = details.querySelectorAll('[data-inline-attempt]:not([data-loaded])');
    if (typeof IntersectionObserver !== 'function') { targets.forEach(loadInlineHistory); return; }
    historyObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        historyObserver.unobserve(entry.target); loadInlineHistory(entry.target);
      }
    }, { rootMargin: '200px' });
    targets.forEach(target => historyObserver.observe(target));
  };
  details.addEventListener('toggle', observeQuestions);
  observeQuestions();
}

async function historyQuestions(attempt) {
  for (const key of new Set(attempt.details.questions.filter(record => !knownQuestions.has(record.id)).map(record => record.subject))) {
    if (!historySubjectLoads.has(key)) {
      const loading = loadBank(key).then(questions => {
        for (const question of questions) knownQuestions.set(question.id, question);
      }).finally(() => historySubjectLoads.delete(key));
      historySubjectLoads.set(key, loading);
    }
    await historySubjectLoads.get(key);
  }
  const questions = attempt.details.questions.map(record => knownQuestions.get(record.id));
  if (questions.some(question => !question)) throw new Error('部分题目暂时无法恢复，请稍后重试。');
  return questions;
}

async function loadInlineHistory(target) {
  if (!target.isConnected || target.dataset.loaded) return;
  target.dataset.loaded = 'loading';
  try {
    const attempt = mistakeStore.readAttempts().find(item => item.id === target.dataset.inlineAttempt);
    if (!attempt?.details) throw new Error('这条旧记录未保存题目明细，无法恢复。');
    const questions = await historyQuestions(attempt);
    if (!target.isConnected) return;
    target.innerHTML = questions.map((question, index) => {
      const record = attempt.details.questions[index];
      const source = question.source;
      const pages = Array.isArray(source?.questionPages) ? source.questionPages.filter(page => Number.isInteger(page) && page > 0) : [];
      const original = /^sources\/[a-z0-9-]+\.pdf$/.test(source?.pdfPath) && pages.length
        ? `<p class="history-source"><a class="text-link" href="${esc(source.pdfPath)}#page=${pages[0]}" target="_blank" rel="noopener">题目原始 PDF · 第 ${pages.join('、')} 页（含图表） ↗</a></p>` : '';
      return `<article class="history-question" data-saved-question-id="${esc(question.id)}">
        <div class="history-question-label">第 ${index + 1} 题 · ${esc(subjectLabel(question.subject))}</div>
        <p class="history-stem">${esc(question.stem)}</p>
        <ol class="history-choices">${question.choices.map((choice, number) => {
          const letter = 'ABCD'[number];
          return `<li class="${letter === question.answer ? 'correct' : letter === record.selected ? 'wrong' : ''}"><span>${letter}.</span><span>${esc(choice)}</span></li>`;
        }).join('')}</ol>
        <p class="history-answer">当时作答：${record.selected ?? '未作答'} · 正确答案：${question.answer} · ${record.correct ? '回答正确' : '回答错误'}</p>
        ${original}
      </article>`;
    }).join('');
    target.dataset.loaded = 'true';
  } catch (error) {
    if (!target.isConnected) return;
    target.innerHTML = `<p class="notice error" role="alert">${esc(error.message || '题目暂时无法载入，请重试。')}</p><button type="button" class="secondary" data-inline-retry>重试载入题目</button>`;
    target.querySelector('[data-inline-retry]').addEventListener('click', () => {
      delete target.dataset.loaded; loadInlineHistory(target);
    });
  }
}

async function showHistoryAttempt(id) {
  const token = ++startToken;
  reviewing = true; preparing = false;
  clearInterval(ticker); session = null;
  unmountSourcePages(app);
  const back = '<button type="button" class="secondary" id="history-back">← 返回练习首页</button>';
  app.innerHTML = `${back}<p class="sub" role="status">正在恢复这次练习的题目…</p>`;
  document.getElementById('history-back').addEventListener('click', home);
  try {
    const attempt = mistakeStore.readAttempts().find(item => item.id === id);
    if (!attempt?.details) throw new Error('这条旧记录未保存题目明细，无法恢复。');
    const questions = await historyQuestions(attempt);
    if (token !== startToken) return;
    const wrong = attempt.details.questions.filter(record => !record.correct).map(record => record.number).join('、') || '—';
    app.innerHTML = `${back}<div class="eyebrow spaced">Practice history</div><h1>历史练习。</h1>
      <p class="sub">${esc(new Date(attempt.completedAt).toLocaleString('zh-CN', { hour12: false }))}<br>
        ${attempt.total} 题 · 用时 ${formatTime(attempt.details.durationSeconds)} · 正确率 ${accuracy(attempt.correct, attempt.total)}</p>
      <p class="notice">错题题号：${wrong}<br>可以反复回看，不会再次计分，也不消耗本轮题目。</p>
      ${questions.map((question, index) => {
        const record = attempt.details.questions[index];
        return `<section class="card result"><div class="result-title">第 ${index + 1} 题 <span class="result-state">${record.correct ? '回答正确' : record.selected === null ? '未作答' : '回答错误'}</span></div>
          <p class="subject-tag">${esc(subjectLabel(question.subject))}</p>${reviewQuestion(question, record.selected)}</section>`;
      }).join('')}`;
    document.getElementById('history-back').addEventListener('click', home);
    mountHighlights(app); mountSourcePages(app); window.scrollTo(0, 0);
  } catch (error) {
    if (token !== startToken) return;
    app.innerHTML = `${back}<p class="notice error" role="alert">${esc(error.message || '暂时无法恢复题目，请重试。')}</p><button type="button" class="primary" id="history-retry">重试打开记录</button>`;
    document.getElementById('history-back').addEventListener('click', home);
    document.getElementById('history-retry').addEventListener('click', () => showHistoryAttempt(id));
  }
}

function availableQuestions() {
  const questions = fromMistakes ? mistakeStore.read().map(entry => entry.question) : bank;
  return filterSubject(questions, subject);
}

function home() {
  reviewing = false;
  startToken++; preparing = false;
  unmountSourcePages(app);
  clearInterval(ticker);
  session = null;
  let questions = [], storageError = false;
  try { questions = fromMistakes ? mistakeStore.read().map(entry => entry.question) : bank; }
  catch { storageError = true; }
  let attempts = [];
  try { if (storeReady) attempts = mistakeStore.readAttempts(); } catch { storageError = true; }
  const counts = !fromMistakes && catalog ? Object.fromEntries(Object.entries(catalog.subjects).map(([key, item]) => [key, item.count])) : null;
  if (subject === null) subject = fromMistakes ? 'all' : SUBJECTS.find(item => counts?.[item.id] > 0)?.id || 'all';
  const available = counts ? (subject === 'all' ? catalog.total : counts[subject]) : filterSubject(questions, subject).length;
  const selectedCounts = counts ? Object.fromEntries(Object.entries(counts).filter(([key]) => subject === 'all' || key === subject))
    : Object.fromEntries(SUBJECTS.filter(item => subject === 'all' || item.id === subject).map(item => [item.id, questions.filter(question => question.subject === item.id).length]));
  const progress = roundProgress(attempts, selectedCounts, practiceSource);
  const nextRound = available > 0 && progress.remaining === 0;
  const remaining = nextRound ? available : progress.remaining;
  const actualCount = Math.min(count, remaining);
  const round = subject === 'all' ? null : progress.bySubject[subject]?.round || 1;
  const roundMessage = nextRound ? `本轮 ${available} 题已完成，下次练习开始${round ? `第 ${round + 1} 轮` : '各科新一轮'}。`
    : `${round ? `第 ${round} 轮 · ` : '各科本轮合计 · '}已做 ${progress.completed} / ${available} 题，剩余 ${progress.remaining} 题。`;
  app.innerHTML = `<div class="eyebrow">${fromMistakes ? 'Review & grow' : 'A little progress, every day'}</div>
    <h1>${fromMistakes ? '重温错题，<br>巩固理解。' : '专注练习，<br>从容备考。'}</h1>
    <p class="sub">按科目随机抽题，交卷后查看完整解析。<br>错题会自动收录到独立错题本。</p>
    ${fromMistakes ? '<p><a href="index.html" class="text-link">← 切换到完整题库</a></p>' : ''}
    ${storageError ? '<p class="notice error" role="alert">错题本无法读取，请检查浏览器存储权限。</p>' : ''}
    <section class="card accuracy-summary" id="cumulative-summary" aria-label="累计统计">${cumulativeSummary()}</section>
    ${storageError ? '' : historySection()}
    <section class="card setup">
      <label class="label" for="subject">选择科目</label>
      <select id="subject">${subjectOptions(subject, questions, counts)}</select>
      ${!fromMistakes ? '<p class="note">按科目练习准备更快；混合练习首次需准备全部科目。</p>' : ''}
      <p class="notice round-progress" id="round-progress">${roundMessage}</p>
      <div class="label spaced" id="count-label">这次想做多少题？</div>
      <div class="counts" role="group" aria-labelledby="count-label">${[5, 10, 15, 20].map(number => `
        <button class="count ${number === count ? 'active' : ''}" data-count="${number}" aria-pressed="${number === count}">${number} 题</button>`).join('')}</div>
      <label class="label spaced" for="timer-mode">计时方式</label>
      <select id="timer-mode">
        <option value="natural" ${mode === 'natural' ? 'selected' : ''}>自然计时 · 从 00:00 开始</option>
        <option value="countdown" ${mode === 'countdown' ? 'selected' : ''}>倒计时 · 每题 1.8 分钟</option>
      </select>
      <p class="sub timing-hint">${mode === 'countdown'
        ? `${actualCount} 题 × 1.8 分钟 = ${formatTime(actualCount * 108)}，时间到自动交卷。`
        : '记录本次练习的用时，没有时间限制。'}</p>
      ${remaining && remaining < count ? `<p class="notice">本轮剩余 ${remaining} 道题，本次将练习这 ${remaining} 题，不混入下一轮。</p>` : ''}
      <button class="primary" id="start" ${!available || !storeReady || storageError ? 'disabled' : ''}>${nextRound ? '开始下一轮' : '开始'}${fromMistakes ? '错题' : ''}练习　→</button>
      <p class="notice error" id="bank-status" role="alert" hidden></p>
      <p class="note">交卷后记录已做题，本轮内不重复；未交卷退出不消耗题目。</p>
      <p class="note">${available ? `随机抽题 · 当前科目共 ${available} 道题` : fromMistakes ? '当前科目暂无错题，完成练习后会自动收录。' : '当前科目暂无题目。'}</p>
    </section>
    <p class="foot">八科分开练习：民事诉讼法、宪法、合同法、刑法、刑事诉讼法、证据法、不动产法、侵权法。<br>错题在本机自动保存；登录云同步后可跨设备查看。清理浏览器前请确认同步完成。</p>`;
  document.getElementById('subject').addEventListener('change', event => { subject = event.target.value; home(); });
  document.getElementById('timer-mode').addEventListener('change', event => { mode = event.target.value; home(); });
  app.querySelectorAll('[data-count]').forEach(button => button.addEventListener('click', () => {
    count = Number(button.dataset.count); home();
  }));
  document.getElementById('start').addEventListener('click', start);
  mountHistory();
}

async function start() {
  const token = ++startToken;
  const selectedSubject = subject;
  const button = document.getElementById('start');
  preparing = true; button.disabled = true; button.textContent = '正在准备本次题目…';
  let questions, roundSelection;
  try {
    await mistakeStore.ready;
    if (token !== startToken) return;
    if (!fromMistakes) {
      const downloaded = await loadBank(selectedSubject);
      if (token !== startToken) return;
      for (const question of downloaded) knownQuestions.set(question.id, question);
      bank = [...knownQuestions.values()];
      mistakeStore.refreshQuestions(bank).catch(() => {});
    } else {
      await mistakeStore.ready;
      const old = availableQuestions().filter(question => !question.source);
      if (old.length) {
        for (const key of new Set(old.map(question => question.subject))) {
          for (const question of await loadBank(key)) knownQuestions.set(question.id, question);
        }
        await mistakeStore.refreshQuestions([...knownQuestions.values()]);
      }
    }
    if (token !== startToken) return;
    roundSelection = remainingPool(availableQuestions(), mistakeStore.readAttempts(), practiceSource);
    questions = shuffle(roundSelection.questions).slice(0, count);
  } catch (error) {
    if (token === startToken) {
      const status = document.getElementById('bank-status');
      status.hidden = false; status.innerHTML = `${esc(error.message || '本次题目未能准备完成，请重试。')}<br>${backupLink}`;
      button.disabled = false; button.textContent = '重试准备题目'; preparing = false;
    }
    return;
  }
  preparing = false;
  if (!questions.length) { home(); return; }
  clearInterval(ticker);
  session = {
    questions, rounds: roundSelection.rounds, answers: Array(questions.length).fill(null), index: 0,
    timer: new QuizTimer(mode, questions.length), submitted: false,
  };
  render();
  ticker = setInterval(updateClock, 250);
  window.scrollTo(0, 0);
}

function updateClock() {
  if (!session || session.submitted) return;
  if (session.timer.expired) { submitQuiz(true); return; }
  const clock = document.getElementById('clock');
  if (clock) {
    clock.textContent = formatTime(session.timer.displaySeconds);
    clock.parentElement.classList.toggle('urgent', mode === 'countdown' && session.timer.displaySeconds <= 60);
  }
}

function active() {
  if (!session || session.submitted) return false;
  if (session.timer.expired) { submitQuiz(true); return false; }
  return true;
}

function render() {
  unmountSourcePages(app);
  const { questions, answers, index, timer } = session;
  const question = questions[index];
  app.innerHTML = `<div class="meta quiz-meta">
      <button class="link" id="exit">← 退出练习</button>
      <span class="timer" role="timer" aria-label="${mode === 'countdown' ? '剩余时间' : '已用时间'}">${mode === 'countdown' ? '剩余' : '用时'} <strong id="clock">${formatTime(timer.displaySeconds)}</strong></span>
      <span>${index + 1} / ${questions.length}</span>
    </div>
    <div class="bar"><div style="width:${(index + 1) / questions.length * 100}%"></div></div>
    <div class="eyebrow">Question ${String(index + 1).padStart(2, '0')}</div>
    <p class="subject-tag">${esc(subjectLabel(question.subject))}</p>
    <h2>选择最佳答案</h2>
    <section class="card"><div class="question" data-question-id="${esc(question.id)}">${esc(question.stem)}</div>
      <div class="options">${question.choices.map((choice, number) => `
        <button class="option ${answers[index] === number ? 'selected' : ''}" data-choice="${number}" aria-pressed="${answers[index] === number}">
          <span class="letter">${'ABCD'[number]}</span><span>${esc(choice)}</span>
        </button>`).join('')}</div>
      ${questionSource(question)}
    </section>
    <div class="nav">${index ? '<button class="secondary" id="previous">上一题</button>' : ''}
      ${index < questions.length - 1 ? '<button class="primary" id="next">下一题　→</button>' : '<button class="primary" id="submit">交卷并查看解析</button>'}
    </div>
    <p class="note" id="answered-count">已作答 ${answers.filter(answer => answer !== null).length} / ${questions.length} 题</p>`;
  document.getElementById('exit').addEventListener('click', () => {
    if (confirm('返回首页将结束本次练习，本次答案不会保存。确定吗？')) home();
    else updateClock();
  });
  app.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => {
    if (!active()) return;
    session.answers[session.index] = Number(button.dataset.choice);
    app.querySelectorAll('[data-choice]').forEach(option => {
      const selected = Number(option.dataset.choice) === session.answers[session.index];
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-pressed', String(selected));
    });
    document.getElementById('answered-count').textContent = `已作答 ${session.answers.filter(answer => answer !== null).length} / ${questions.length} 题`;
  }));
  for (const [id, direction] of [['previous', -1], ['next', 1]]) {
    document.getElementById(id)?.addEventListener('click', () => {
      if (!active()) return;
      session.index += direction; render(); window.scrollTo(0, 0);
    });
  }
  document.getElementById('submit')?.addEventListener('click', () => submitQuiz());
  mountHighlights(app);
  mountSourcePages(app);
}

async function submitQuiz(automatic = false) {
  if (!session || session.submitted) return;
  automatic = automatic || session.timer.expired;
  const missing = session.answers.filter(answer => answer === null).length;
  if (!automatic && missing && !confirm(`还有 ${missing} 题未作答，将按错误计分并收录到错题本。确定交卷吗？`)) {
    updateClock(); return;
  }
  automatic = automatic || session.timer.expired;
  session.submitted = true;
  session.timer.stop();
  const elapsed = automatic ? session.timer.limitMs : session.timer.elapsedMs;
  session.attempt = createAttempt(session.questions, session.answers, crypto.randomUUID(), new Date().toISOString(), {
    startedAt: new Date(session.timer.startedAt).toISOString(), durationSeconds: Math.floor(elapsed / 1000),
    source: practiceSource, rounds: session.rounds, timerMode: mode,
  });
  clearInterval(ticker);
  let saved;
  unmountSourcePages(app);
  app.innerHTML = '<p class="sub" role="status">正在保存本次练习…</p>';
  try { saved = await mistakeStore.recordSession(session.questions, session.answers, session.attempt); }
  catch { saved = null; }
  results(automatic, saved);
}

function results(automatic, saved) {
  unmountSourcePages(app);
  const { questions, answers, timer } = session;
  const score = questions.filter((question, index) => answerLetter(answers[index]) === question.answer).length;
  const elapsed = automatic ? timer.limitMs : timer.elapsedMs;
  app.innerHTML = `<div class="eyebrow">Practice complete</div>
    <div class="results-head"><div><h1>练习完成。</h1><p class="sub">${automatic ? '倒计时已结束，已自动交卷。' : '回顾每一道题，让理解更扎实。'}<br>
      ${mode === 'countdown' ? '倒计时' : '自然计时'} · 本次用时 ${formatTime(elapsed / 1000)}</p></div>
      <div class="score"><span id="session-rate">${accuracy(score, questions.length)}</span><span class="score-caption">本次正确率 · ${score} / ${questions.length}</span></div>
    </div>
    <section class="card accuracy-summary" id="cumulative-summary" aria-label="累计统计">${cumulativeSummary()}</section>
    <p class="notice ${saved === null ? 'error' : ''}" role="status">${saved === null
      ? '错题和本次成绩保存失败，本次尚未计入累计。请保留本页，检查浏览器存储后点击重试。'
      : saved ? `${saved} 道错题已自动记录；重复错题已累计次数。` : '本次全部答对，没有新增错题。'}</p>
    ${saved === null ? '<button class="secondary" id="retry-save">重试保存错题</button>' : ''}
    ${saved === null ? '<button class="secondary" id="save-backup">下载本次错题备份</button>' : ''}
    ${historySection(true)}
    <p><a class="text-link" href="mistakes.html">打开独立错题本 →</a></p>
    ${questions.map((question, index) => {
      const selected = answerLetter(answers[index]);
      const correct = selected === question.answer;
      return `<section class="card result">
        <div class="result-title"><span class="mark ${correct ? '' : 'bad'}">${correct ? '✓' : '✕'}</span>第 ${index + 1} 题
          <span class="result-state">${correct ? '回答正确' : selected === null ? '未作答' : '回答错误'}</span></div>
        <p class="subject-tag">${esc(subjectLabel(question.subject))}</p>
        ${reviewQuestion(question, selected)}</section>`;
    }).join('')}
    <button class="primary" id="again">再练一组</button>
    <p class="foot">解析来自所提供的 PDF；答案依据原文选项说明匹配。建议对疑义题目核对原始材料。</p>`;
  document.getElementById('again').addEventListener('click', () => { home(); window.scrollTo(0, 0); });
  document.getElementById('retry-save')?.addEventListener('click', async event => {
    event.target.disabled = true;
    let retried;
    try { retried = await mistakeStore.recordSession(questions, answers, session.attempt); }
    catch { retried = null; }
    results(automatic, retried);
  });
  document.getElementById('save-backup')?.addEventListener('click', () => {
    const timestamp = new Date().toISOString();
    const entries = questions.flatMap((question, index) => answerLetter(answers[index]) === question.answer ? [] : [{
      question, lastAnswer: answerLetter(answers[index]), wrongCount: 1,
      firstWrongAt: timestamp, lastWrongAt: timestamp,
    }]);
    downloadBackup(entries, [session.attempt]);
  });
  mountHistory();
  mountHighlights(app);
  mountSourcePages(app);
  window.scrollTo(0, 0);
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) updateClock(); });
window.addEventListener('beforeunload', event => {
  if (session && !session.submitted) { event.preventDefault(); event.returnValue = ''; }
});

function dataChanged() { if (reviewing) return; if (session || preparing) updateCumulative(); else if (catalog || fromMistakes && storeReady) home(); }
window.addEventListener('mbe:cloud-synced', dataChanged);
window.addEventListener('mbe:local-refreshed', dataChanged);
mistakeStore.ready.then(() => { storeReady = true; if (catalog || fromMistakes) { if (session || preparing) updateCumulative(); else home(); } });
async function loadPracticeBank() {
  if (bankLoading) return;
  bankLoading = true;
  app.innerHTML = `<p class="sub" role="status">正在读取科目清单…</p><p class="note">长时间无法打开？${backupLink}</p>`;
  try {
    if (fromMistakes) await mistakeStore.ready;
    else catalog = await loadCatalog({ refresh: true });
    home();
  } catch (error) {
    app.innerHTML = `<p class="notice error" role="alert">${esc(error.message || '科目清单暂时无法载入，请重试。')}</p><button class="primary" id="retry-bank">重新载入科目清单</button><p>${backupLink}</p>`;
    document.getElementById('retry-bank').addEventListener('click', loadPracticeBank);
  } finally { bankLoading = false; }
}
window.addEventListener('online', () => {
  if (!catalog && !fromMistakes) loadPracticeBank();
  else if (!session && !preparing && document.getElementById('bank-status')?.hidden === false) start();
});
loadPracticeBank();
