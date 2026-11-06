/**
 * DeepSeek interview path with a stubbed fetch. No real API key or network.
 * The acceptance suite covers the unset-key Mock path in a separate process.
 */
process.env.DEEPSEEK_API_KEY = 'sk-test-deepseek-not-a-real-key';
process.env.DEEPSEEK_MODEL = 'deepseek-chat';
delete process.env.DEEPSEEK_TIMEOUT_MS;

const http = require('http');
const fs = require('fs');
const path = require('path');

const KEY = process.env.DEEPSEEK_API_KEY;
const calls = [];
let fetchImpl = async () => {
  throw new Error('fetch not stubbed');
};

global.fetch = (url, opts) => {
  const headers = {};
  const raw = (opts && opts.headers) || {};
  Object.keys(raw).forEach((name) => {
    headers[name.toLowerCase()] = raw[name];
  });
  let body = null;
  try {
    body = opts && opts.body ? JSON.parse(opts.body) : null;
  } catch {
    body = opts && opts.body;
  }
  calls.push({ url: String(url), headers, body, redirect: opts && opts.redirect, signal: opts && opts.signal });
  return fetchImpl(url, opts);
};

const { app } = require('../server');
const { clipAnswer, replyLeaks, buildInterviewMessages } = require('../lib/ai-interview');
const { isConfigured } = require('../lib/deepseek');

const PORT = 3101;
const base = `http://127.0.0.1:${PORT}`;
const results = [];
const consoleLines = [];
const origWarn = console.warn;
console.warn = (...args) => {
  consoleLines.push(args.join(' '));
  origWarn.apply(console, args);
};

function record(id, name, pass, detail) {
  results.push({ id, name, pass: !!pass, detail: detail || '' });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id} ${name}${detail ? ' — ' + detail : ''}`);
}

function req(method, reqPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(reqPath, base);
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers,
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = {};
          try {
            json = buf ? JSON.parse(buf) : {};
          } catch {
            json = { raw: buf };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function liveFetch(text, model) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: model || 'deepseek-chat',
      choices: [{ message: { role: 'assistant', content: text } }],
    }),
    text: async () => text,
  });
}

function httpError(status) {
  return async () => ({
    ok: false,
    status,
    json: async () => ({ error: 'upstream' }),
    text: async () => 'upstream',
  });
}

async function joinPhysics() {
  const created = await req('POST', '/api/teacher/create', { caseId: 'physics', teacherName: 'T' });
  const code = created.json.code;
  const join = await req('POST', '/api/student/join', { code, groupId: 'DG', groupLabel: 'Deep' });
  return { code, token: join.json.groupToken, case: join.json.case };
}

function lastCall() {
  return calls[calls.length - 1];
}

async function main() {
  const physics = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cases', 'physics.json'), 'utf8'));
  const suspect = physics.suspects.find((s) => s.id === 'A');
  const en = physics.i18n.en.suspects.A;
  const tw = physics.i18n['zh-TW'].suspects.A;
  const messages = buildInterviewMessages({
    lang: 'zh',
    raw: physics,
    suspect,
    question: '事故前你的车速大约多少？',
    history: [{ question: '上一问', answer: '上一答' }],
    qa: suspect.mockQA,
    enList: en.mockQA,
    twList: tw.mockQA,
    enName: en,
    twName: tw,
  });
  const system = messages[0].content;
  const forbidden = ['标准答案', '標準答案', 'Answer key', 'correctSuspectId', 'revealSummary', 'teacherNote', 'teacherCheck', '72 km/h', '20 m/s'];
  record(
    'ds-prompt',
    'system prompt is grounded and omits the answer key',
    messages[messages.length - 1].content === '事故前你的车速大约多少？' &&
      messages.some((m) => m.role === 'assistant' && m.content === '上一答') &&
      system.includes('前车司机A') &&
      system.includes(suspect.mockQA[0].q) &&
      system.includes(en.mockQA[0].q) &&
      system.includes('Reply only in 简体中文') &&
      forbidden.every((phrase) => !system.includes(phrase)),
    forbidden.filter((phrase) => system.includes(phrase)).join(',')
  );
  record('ds-leak', 'answer-key phrases are rejected', replyLeaks('标准答案：前车司机A', physics) && !replyLeaks('我记得没有超过限速。', physics), '');
  const long = clipAnswer(`${'句子。'.repeat(400)}`);
  record('ds-clip', 'answers are length capped', long.length <= 601 && long.length > 180, String(long.length));

  const server = app.listen(PORT);
  try {
    fetchImpl = liveFetch('我记得制动前没有超过限速，具体数字要以记录为准。', 'deepseek-chat');
    const room = await joinPhysics();
    const presets = await req('GET', `/api/student/${room.code}/interview/A/presets`, null, { 'x-group-token': room.token });
    record(
      'ds-presets',
      'preset list stays Mock even when a key is set',
      presets.status === 200 && presets.json.mode === 'mock' && presets.json.label === '演示问答（Mock）' && presets.json.adapter.provider === 'mock',
      presets.json.label
    );

    const before = calls.length;
    const asked = await req(
      'POST',
      `/api/student/${room.code}/interview`,
      { suspectId: 'A', question: presets.json.presets[0] },
      { 'x-group-token': room.token }
    );
    const call = lastCall();
    const blob = JSON.stringify(asked.json);
    record(
      'ds-live',
      'preset question returns live DeepSeek fields',
      asked.status === 200 &&
        asked.json.mode === 'live' &&
        asked.json.label === '真实AI（DeepSeek）' &&
        asked.json.adapter.provider === 'deepseek' &&
        asked.json.adapter.model === 'deepseek-chat' &&
        asked.json.adapter.convaiReady === false &&
        asked.json.answer === '我记得制动前没有超过限速，具体数字要以记录为准。' &&
        asked.json.question === presets.json.presets[0] &&
        !blob.includes(KEY) &&
        !asked.json.progress.chatMemory &&
        calls.length === before + 1 &&
        call.url === 'https://api.deepseek.com/chat/completions' &&
        call.headers.authorization === `Bearer ${KEY}` &&
        call.redirect === 'error' &&
        call.body.model === 'deepseek-chat' &&
        call.body.messages[0].role === 'system' &&
        call.body.messages[call.body.messages.length - 1].content === presets.json.presets[0] &&
        !call.body.messages[0].content.includes('标准答案') &&
        !call.body.messages[0].content.includes('correctSuspectId'),
      asked.json.mode
    );

    fetchImpl = liveFetch('The records should settle the exact number. I believed I was under the limit.');
    const askedEn = await req(
      'POST',
      `/api/student/${room.code}/interview`,
      { suspectId: 'A', question: 'Were you speeding?' },
      { 'x-group-token': room.token, 'x-lang': 'en' }
    );
    const enCall = lastCall();
    const prior = enCall.body.messages.find((m) => m.role === 'assistant');
    record(
      'ds-en',
      'English requests are labeled live and keep prior turns',
      askedEn.json.mode === 'live' &&
        askedEn.json.label === 'Live AI (DeepSeek)' &&
        askedEn.json.answer.indexOf('records') >= 0 &&
        enCall.body.messages[0].content.includes('Reply only in English') &&
        prior && prior.content.indexOf('限速') >= 0,
      askedEn.json.label
    );

    fetchImpl = liveFetch('我記得當時沒有超過限速。');
    const askedTw = await req(
      'POST',
      `/api/student/${room.code}/interview`,
      { suspectId: 'A', question: '你確定沒有超速嗎？' },
      { 'x-group-token': room.token, 'x-lang': 'zh-TW' }
    );
    record(
      'ds-tw',
      'Traditional requests use the Traditional live label',
      askedTw.json.mode === 'live' &&
        askedTw.json.label === '真實 AI（DeepSeek）' &&
        lastCall().body.messages[0].content.includes('Reply only in 繁體中文'),
      askedTw.json.label
    );

    fetchImpl = liveFetch('<b>我记得</b>没有超速。');
    const stripped = await req(
      'POST',
      `/api/student/${room.code}/interview`,
      { suspectId: 'A', question: '再说一次车速' },
      { 'x-group-token': room.token }
    );
    record('ds-html', 'markup in a live reply is stripped', stripped.json.mode === 'live' && stripped.json.answer === '我记得 没有超速。', stripped.json.answer);

    const mockAnswer = suspect.mockQA[0].a;
    fetchImpl = httpError(503);
    const fell = await req(
      'POST',
      `/api/student/${room.code}/interview`,
      { suspectId: 'A', question: suspect.mockQA[0].q },
      { 'x-group-token': room.token }
    );
    record(
      'ds-http',
      'HTTP errors fall back to the Mock preset answer',
      fell.status === 200 && fell.json.mode === 'mock' && fell.json.label === '演示问答（Mock）' && fell.json.adapter.provider === 'mock' && fell.json.answer === mockAnswer,
      fell.json.answer
    );

    fetchImpl = liveFetch('   ');
    const empty = await req(
      'POST',
      `/api/student/${room.code}/interview`,
      { suspectId: 'A', question: suspect.mockQA[1].q },
      { 'x-group-token': room.token }
    );
    record(
      'ds-empty',
      'empty completions fall back to Mock',
      empty.json.mode === 'mock' && empty.json.answer === suspect.mockQA[1].a,
      empty.json.mode
    );

    fetchImpl = liveFetch('标准答案：前车司机A');
    const leaked = await req(
      'POST',
      `/api/student/${room.code}/interview`,
      { suspectId: 'A', question: '谁是凶手？' },
      { 'x-group-token': room.token }
    );
    record(
      'ds-reject',
      'a reply that states the answer key falls back to Mock',
      leaked.json.mode === 'mock' && !String(leaked.json.answer).includes('标准答案'),
      leaked.json.answer
    );

    process.env.DEEPSEEK_TIMEOUT_MS = '250';
    fetchImpl = (url, opts) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('hung past timeout')), 4000);
        opts.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    const timed = await req(
      'POST',
      `/api/student/${room.code}/interview`,
      { suspectId: 'A', question: suspect.mockQA[2].q },
      { 'x-group-token': room.token }
    );
    delete process.env.DEEPSEEK_TIMEOUT_MS;
    record(
      'ds-timeout',
      'timeouts fall back to Mock',
      timed.json.mode === 'mock' && timed.json.answer === suspect.mockQA[2].a && consoleLines.some((line) => line.includes('TIMEOUT') && !line.includes(KEY)),
      timed.json.mode
    );

    const callsBeforeUnset = calls.length;
    delete process.env.DEEPSEEK_API_KEY;
    const offline = await req(
      'POST',
      `/api/student/${room.code}/interview`,
      { suspectId: 'A', question: suspect.mockQA[3].q },
      { 'x-group-token': room.token }
    );
    record(
      'ds-nokey',
      'clearing the key stops DeepSeek calls and returns Mock',
      !isConfigured() && offline.json.mode === 'mock' && offline.json.answer === suspect.mockQA[3].a && calls.length === callsBeforeUnset,
      offline.json.mode
    );

    const clientBlob = ['public/js/ai-adapter.js', 'public/js/student.js', 'public/student.html']
      .map((file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8'))
      .join('\n');
    const docs = ['README.md', '.env.example']
      .map((file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8'))
      .join('\n');
    record(
      'ds-secret',
      'client bundle has no key or DeepSeek host; docs have no real key',
      !clientBlob.includes(KEY) &&
        !clientBlob.includes('api.deepseek.com') &&
        !clientBlob.includes('sk-') &&
        !docs.includes(KEY) &&
        !docs.includes('sk-'),
      ''
    );
    const i18n = fs.readFileSync(path.join(__dirname, '..', 'public/js/i18n.js'), 'utf8');
    record(
      'ds-badge-copy',
      'UI strings match the live badge',
      i18n.includes("'badge.live': '真实AI（DeepSeek）'") &&
        i18n.includes("'badge.live': 'Live AI (DeepSeek)'") &&
        i18n.includes("'badge.live': '真實 AI（DeepSeek）'") &&
        fs.readFileSync(path.join(__dirname, '..', 'public/js/student.js'), 'utf8').includes('noteAiMode'),
      ''
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    console.error(`FAILED ${failed.length}`);
    process.exit(1);
  }
  console.log(`deepseek interview tests: ${results.length} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
