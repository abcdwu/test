// On-demand English -> simplified Chinese assistive translation.
// MyMemory's public endpoint accepts at most 500 UTF-8 bytes per segment.
// Do not transmit answers, explanations, saved notes or account information.
const LIMIT_BYTES = 450;
const endpoint = 'https://api.mymemory.translated.net/get';
const encoder = new TextEncoder();
const inFlight = new Map();
const completed = new Map();

export function translationSegments(value, maxBytes = LIMIT_BYTES) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return [];
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 16 || maxBytes > 500) throw new RangeError('Invalid segment size');
  const pieces = [];
  let remaining = text;
  while (remaining.length) {
    if (encoder.encode(remaining).length <= maxBytes) { pieces.push(remaining); break; }
    let end = 0;
    for (let i = 0; i < remaining.length; ) {
      const cp = remaining.codePointAt(i);
      const next = i + (cp > 65535 ? 2 : 1);
      if (encoder.encode(remaining.slice(0, next)).length > maxBytes) break;
      end = next; i = next;
    }
    if (!end) throw new Error('Translation segment cannot be split');
    const candidate = remaining.slice(0, end);
    const sentenceBreaks = [...candidate.matchAll(/[.!?;:]\s+|\n/g)].map(m => m.index + m[0].length);
    const spaces = [...candidate.matchAll(/\s+/g)].map(m => m.index + m[0].length);
    const split = sentenceBreaks.filter(n => n > end / 3).at(-1)
      || spaces.filter(n => n > end / 3).at(-1) || end;
    pieces.push(remaining.slice(0, split).trim());
    remaining = remaining.slice(split).trimStart();
  }
  return pieces.filter(Boolean);
}

function decodeEntities(value) {
  if (typeof document === 'undefined') return value;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

export async function translateEnglish(value, options = {}) {
  const original = String(value || '').trim();
  if (!original) return '';
  if (completed.has(original)) return completed.get(original);
  if (inFlight.has(original)) return inFlight.get(original);
  const fetcher = options.fetcher || fetch;
  const task = (async () => {
    const translated = [];
    for (const segment of translationSegments(original)) {
      const params = new URLSearchParams({ q: segment, langpair: 'en|zh-CN', mt: '1' });
      const response = await fetcher(endpoint + '?' + params.toString(), {
        method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer',
        signal: options.signal || AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error('翻译服务暂时无法访问（HTTP ' + response.status + '）');
      const json = await response.json();
      if (Number(json?.responseStatus) !== 200 || typeof json?.responseData?.translatedText !== 'string') {
        const detail = String(json?.responseDetails || '');
        throw new Error(/quota|limit|429/i.test(detail) ? '免费翻译额度已用尽，请稍后重试。' : '翻译服务暂时不可用，请稍后重试。');
      }
      const result = decodeEntities(json.responseData.translatedText.trim());
      if (!result || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(result)) {
        throw new Error('翻译服务额度或长度限制，请稍后重试。');
      }
      translated.push(result);
    }
    const value = translated.join('\n');
    completed.set(original, value);
    return value;
  })().finally(() => inFlight.delete(original));
  inFlight.set(original, task);
  return task;
}

export async function translateQuestion(question, options = {}) {
  if (!question?.stem || !Array.isArray(question.choices) || question.choices.length !== 4) {
    throw new Error('题目格式不正确，无法翻译。');
  }
  // Sequential requests avoid unnecessary burst/rate-limit failures.
  const stem = await translateEnglish(question.stem, options);
  const choices = [];
  for (const choice of question.choices) choices.push(await translateEnglish(choice, options));
  return { stem, choices };
}
