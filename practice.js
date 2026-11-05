import {
  SUBJECTS, answerLetter, esc, filterSubject, formatTime, loadBank, QuizTimer,
  questionSource, reviewQuestion, shuffle, subjectLabel, subjectOptions,
} from './common.js?v=3';
import { mountSourcePages, unmountSourcePages } from './pdf-source.js?v=3';
import { downloadBackup } from './mistake-store.js?v=3';
import { mistakeStore } from './browser-store.js?v=3';
import './cloud-sync.js?v=4';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const fromMistakes = params.get('source') === 'mistakes';
let subject = SUBJECTS.some(item => item.id === params.get('subject')) ? params.get('subject') : 'all';
let bank = [], count = 10, mode = 'natural', session = null, ticker = null;

function availableQuestions() {
  const questions = fromMistakes ? mistakeStore.read().map(entry => entry.question) : bank;
  return filterSubject(questions, subject);
}

function home() {
  unmountSourcePages(app);
  clearInterval(ticker);
  session = null;
  let questions = [], storageError = false;
  try { questions = fromMistakes ? mistakeStore.read().map(entry => entry.question) : bank; }
  catch { storageError = true; }
  const available = filterSubject(questions, subject).length;
  const actualCount = Math.min(count, available);
  app.innerHTML = `<div class="eyebrow">${fromMistakes ? 'Review & grow' : 'A little progress, every day'}</div>
    <h1>${fromMistakes ? '重温错题，<br>巩固理解。' : '专注练习，<br>从容备考。'}</h1>
    <p class="sub">按科目随机抽题，交卷后查看完整解析。<br>错题会自动收录到独立错题本。</p>
    ${fromMistakes ? '<p><a href="index.html" class="text-link">← 切换到完整题库</a></p>' : ''}
    ${storageError ? '<p class="notice error" role="alert">错题本无法读取，请检查浏览器存储权限。</p>' : ''}
    <section class="card setup">
      <label class="label" for="subject">选择科目</label>
      <select id="subject">${subjectOptions(subject, questions)}</select>
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
      ${available && available < count ? `<p class="notice">当前有 ${available} 道题，本次将练习全部 ${available} 题。</p>` : ''}
      <button class="primary" id="start" ${!available ? 'disabled' : ''}>开始${fromMistakes ? '错题' : ''}练习　→</button>
      <p class="note">${available ? `随机抽题 · 当前科目共 ${available} 道题` : fromMistakes ? '当前科目暂无错题，完成练习后会自动收录。' : '当前科目暂无题目。'}</p>
    </section>
    <p class="foot">八科分开练习：民事诉讼法、宪法、合同法、刑法、刑事诉讼法、证据法、不动产法、侵权法。<br>错题在本机自动保存；登录云同步后可跨设备查看。清理浏览器前请确认同步完成。</p>`;
  document.getElementById('subject').addEventListener('change', event => { subject = event.target.value; home(); });
  document.getElementById('timer-mode').addEventListener('change', event => { mode = event.target.value; home(); });
  app.querySelectorAll('[data-count]').forEach(button => button.addEventListener('click', () => {
    count = Number(button.dataset.count); home();
  }));
  document.getElementById('start').addEventListener('click', start);
}

function start() {
  let questions;
  try { questions = shuffle(availableQuestions()).slice(0, count); }
  catch { home(); return; }
  if (!questions.length) { home(); return; }
  clearInterval(ticker);
  session = {
    questions, answers: Array(questions.length).fill(null), index: 0,
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
    <section class="card"><div class="question">${esc(question.stem)}</div>
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
  clearInterval(ticker);
  let saved;
  unmountSourcePages(app);
  app.innerHTML = '<p class="sub" role="status">正在保存本次练习…</p>';
  try { saved = await mistakeStore.record(session.questions, session.answers); }
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
      <div class="score">${score}<span class="score-total"> / ${questions.length}</span></div>
    </div>
    <p class="notice ${saved === null ? 'error' : ''}" role="status">${saved === null
      ? '错题保存失败，可能是浏览器存储被禁用、已满或现有数据异常。请保留本页，检查后点击重试。'
      : saved ? `${saved} 道错题已自动记录；重复错题已累计次数。` : '本次全部答对，没有新增错题。'}</p>
    ${saved === null ? '<button class="secondary" id="retry-save">重试保存错题</button>' : ''}
    ${saved === null ? '<button class="secondary" id="save-backup">下载本次错题备份</button>' : ''}
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
    try { retried = await mistakeStore.record(questions, answers); }
    catch { retried = null; }
    results(automatic, retried);
  });
  document.getElementById('save-backup')?.addEventListener('click', () => {
    const timestamp = new Date().toISOString();
    const entries = questions.flatMap((question, index) => answerLetter(answers[index]) === question.answer ? [] : [{
      question, lastAnswer: answerLetter(answers[index]), wrongCount: 1,
      firstWrongAt: timestamp, lastWrongAt: timestamp,
    }]);
    downloadBackup(entries);
  });
  mountSourcePages(app);
  window.scrollTo(0, 0);
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) updateClock(); });
window.addEventListener('beforeunload', event => {
  if (session && !session.submitted) { event.preventDefault(); event.returnValue = ''; }
});

window.addEventListener('mbe:cloud-synced', () => { if (!session) home(); });
window.addEventListener('mbe:local-refreshed', () => { if (!session) home(); });
loadBank().then(async questions => {
  await mistakeStore.ready;
  try { await mistakeStore.refreshQuestions(questions); } catch { /* Practice remains available if local storage cannot be updated. */ }
  bank = questions;
  home();
}).catch(error => {
  app.innerHTML = `<p class="notice error" role="alert">${esc(error.message || '题库载入失败，请刷新页面重试。')}</p>`;
});
