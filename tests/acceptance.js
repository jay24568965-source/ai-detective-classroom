/**
 * Automated acceptance against running or ephemeral server.
 * Covers KEYWORDS checklist items that are API-testable.
 */
const http = require('http');
const { app, rooms } = require('../server');

const PORT = 3099;
let base = `http://127.0.0.1:${PORT}`;
const results = [];

function record(id, name, pass, detail) {
  results.push({ id, name, pass: !!pass, detail: detail || '' });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${id} ${name}${detail ? ' — ' + detail : ''}`);
}

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, base);
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
          resolve({ status: res.statusCode, json, raw: buf, headers: res.headers });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function flowForCase(caseId, correctId, wrongId) {
  const prefix = caseId;

  const created = await req('POST', '/api/teacher/create', { caseId, teacherName: 'T' });
  record(`${prefix}-1a`, `create room ${caseId}`, created.status === 200 && created.json.code, created.json.code);
  const code = created.json.code;
  const teacherToken = created.json.teacherToken;

  const pub = await req('GET', `/api/student/${code}/state`, null, { 'x-group-token': 'nope' });
  // join first
  const join = await req('POST', '/api/student/join', { code, groupId: 'G1', groupLabel: '甲组' });
  record(`${prefix}-1b`, 'student join', join.status === 200 && join.json.groupToken, '');
  const token = join.json.groupToken;

  // Case isolation: public case has no correctSuspectId
  const hasAnswer = Object.prototype.hasOwnProperty.call(join.json.case, 'correctSuspectId');
  record(`${prefix}-9a`, 'student case omits correctSuspectId', !hasAnswer, '');
  record(`${prefix}-title`, 'case title loaded', join.json.case.id === caseId, join.json.case.title);

  // Vote before open
  const early = await req('POST', `/api/student/${code}/vote`, { suspectId: correctId, rationale: 'x', evidenceCited: 'E01' }, { 'x-group-token': token });
  record(`${prefix}-7a`, 'cannot vote before open', early.status === 403, String(early.status));

  // Investigate first map item if any
  const map0 = join.json.case.maps[0];
  if (map0.items && map0.items[0]) {
    const inv = await req('POST', `/api/student/${code}/investigate`, { itemId: map0.items[0].id }, { 'x-group-token': token });
    record(`${prefix}-3a`, 'investigate item', inv.status === 200, inv.json.itemName);
  } else {
    record(`${prefix}-3a`, 'investigate item', false, 'no items');
  }

  // Mock interview offline
  const suspects = join.json.case.suspects;
  const sid = suspects[0].id;
  const presets = await req('GET', `/api/student/${code}/interview/${sid}/presets`, null, { 'x-group-token': token });
  record(`${prefix}-13a`, 'mock presets available', presets.status === 200 && (presets.json.presets || []).length > 0, presets.json.label);
  const iv = await req('POST', `/api/student/${code}/interview`, { suspectId: sid, question: presets.json.presets[0] }, { 'x-group-token': token });
  record(`${prefix}-13b`, 'mock ask works', iv.status === 200 && iv.json.mode === 'mock' && iv.json.answer, '');

  // Open vote
  const open = await req('POST', `/api/teacher/${code}/vote/open`, {}, { 'x-teacher-token': teacherToken });
  record(`${prefix}-7b`, 'teacher open vote', open.status === 200 && open.json.state.votingOpen, '');

  // Submit vote
  const vote = await req(
    'POST',
    `/api/student/${code}/vote`,
    { suspectId: correctId, rationale: '物理重建与陈述矛盾', evidenceCited: 'E04,E07,E08' },
    { 'x-group-token': token }
  );
  record(`${prefix}-8a`, 'first vote accepted', vote.status === 200 && vote.json.message.includes('已提交'), vote.json.message);

  // Second vote rejected
  const vote2 = await req(
    'POST',
    `/api/student/${code}/vote`,
    { suspectId: wrongId, rationale: '改票', evidenceCited: 'E01' },
    { 'x-group-token': token }
  );
  record(`${prefix}-8b`, 'no second vote / no change', vote2.status === 409, String(vote2.status));

  // Before reveal: state must not show result correctness
  const st1 = await req('GET', `/api/student/${code}/state`, null, { 'x-group-token': token });
  record(`${prefix}-9b`, 'pre-reveal no result grade', st1.json.progress.result == null && st1.json.progress.voteEcho && st1.json.progress.voteEcho.status.includes('等待揭晓'), JSON.stringify(st1.json.progress.voteEcho));
  record(`${prefix}-9c`, 'pre-reveal no correct id in state', !st1.json.correctSuspectId && !st1.json.case.correctSuspectId, '');

  // Close + try vote after close with new group
  await req('POST', `/api/teacher/${code}/vote/close`, {}, { 'x-teacher-token': teacherToken });
  const join2 = await req('POST', `/api/student/join`, { code, groupId: 'G2', groupLabel: '乙组' });
  const t2 = join2.json.groupToken;
  // reopen for G2 then close
  await req('POST', `/api/teacher/${code}/vote/open`, {}, { 'x-teacher-token': teacherToken });
  await req('POST', `/api/teacher/${code}/vote/close`, {}, { 'x-teacher-token': teacherToken });
  const late = await req(
    'POST',
    `/api/student/${code}/vote`,
    { suspectId: wrongId, rationale: '晚了', evidenceCited: 'E01' },
    { 'x-group-token': t2 }
  );
  record(`${prefix}-7c`, 'cannot vote after close', late.status === 403, String(late.status));

  // Re-open for nothing — reveal
  // G2 never voted
  const rev = await req('POST', `/api/teacher/${code}/reveal`, {}, { 'x-teacher-token': teacherToken });
  record(`${prefix}-10a`, 'reveal ok', rev.status === 200 && rev.json.correctSuspectId === correctId, rev.json.correctSuspectId);

  const stG1 = await req('GET', `/api/student/${code}/state`, null, { 'x-group-token': token });
  const stG2 = await req('GET', `/api/student/${code}/state`, null, { 'x-group-token': t2 });
  record(`${prefix}-10b`, 'correct → 合格', stG1.json.progress.result === '合格', stG1.json.progress.result);
  record(`${prefix}-10c`, '未提交 separate', stG2.json.progress.result === '未提交', stG2.json.progress.result);

  // Wrong vote group
  const createdB = await req('POST', '/api/teacher/create', { caseId, teacherName: 'T2' });
  const codeB = createdB.json.code;
  const ttB = createdB.json.teacherToken;
  const jB = await req('POST', '/api/student/join', { code: codeB, groupId: 'Gx', groupLabel: '错选组' });
  await req('POST', `/api/teacher/${codeB}/vote/open`, {}, { 'x-teacher-token': ttB });
  await req(
    'POST',
    `/api/student/${codeB}/vote`,
    { suspectId: wrongId, rationale: '错', evidenceCited: 'E01' },
    { 'x-group-token': jB.json.groupToken }
  );
  await req('POST', `/api/teacher/${codeB}/reveal`, {}, { 'x-teacher-token': ttB });
  const stWrong = await req('GET', `/api/student/${codeB}/state`, null, { 'x-group-token': jB.json.groupToken });
  record(`${prefix}-10d`, 'wrong → 不合格', stWrong.json.progress.result === '不合格', stWrong.json.progress.result);

  // No second round after reveal
  const reopen = await req('POST', `/api/teacher/${code}/vote/open`, {}, { 'x-teacher-token': teacherToken });
  record(`${prefix}-11`, 'no second round after reveal', reopen.status === 400, String(reopen.status));

  // Refresh restore via token
  const rejoin = await req('POST', '/api/student/join', { code, groupToken: token });
  record(`${prefix}-12a`, 'refresh restore via token', rejoin.status === 200 && rejoin.json.progress.voteSubmitted === true, '');

  // Export
  const expJ = await req('GET', `/api/teacher/${code}/export?format=json`, null, { 'x-teacher-token': teacherToken });
  record(`${prefix}-14a`, 'export JSON', expJ.status === 200 && expJ.json.groups, '');
  const expC = await req('GET', `/api/teacher/${code}/export?format=csv`, null, { 'x-teacher-token': teacherToken });
  record(`${prefix}-14b`, 'export CSV utf8', expC.status === 200 && expC.raw.includes('groupId') && expC.raw.includes('合格'), '');

  // Teacher token required
  const bad = await req('POST', `/api/teacher/${code}/hint`, { text: 'x' }, { 'x-teacher-token': 'nope' });
  record(`${prefix}-12b`, 'teacher auth required', bad.status === 403, '');

  // Stage unlock (physics has staged evidence)
  if (caseId === 'physics') {
    const c3 = await req('POST', '/api/teacher/create', { caseId: 'physics' });
    const j3 = await req('POST', '/api/student/join', { code: c3.json.code, groupId: 'G1', groupLabel: 'g' });
    const before = await req('POST', `/api/student/${c3.json.code}/investigate`, { itemId: 'calib' }, { 'x-group-token': j3.json.groupToken });
    const gotEarly = (before.json.gained || []).some((e) => e.id === 'E07');
    await req('POST', `/api/teacher/${c3.json.code}/stage`, { stage: 2 }, { 'x-teacher-token': c3.json.teacherToken });
    const after = await req('POST', `/api/student/${c3.json.code}/investigate`, { itemId: 'calib' }, { 'x-group-token': j3.json.groupToken });
    const gotLate = (after.json.gained || []).some((e) => e.id === 'E07');
    record(`${prefix}-stage`, 'E07 locked until stage 2', !gotEarly && gotLate, `early=${gotEarly} late=${gotLate}`);
  }

  // Cross-case isolation: chemistry room should not load physics title
  record(`${prefix}-isol`, 'case id matches selection', join.json.case.id === caseId, join.json.case.id);
}

async function langChecks() {
  const listZh = await req('GET', '/api/cases');
  const listEn = await req('GET', '/api/cases?lang=en');
  const zhPhysics = (listZh.json.cases || []).find((c) => c.id === 'physics');
  const enPhysics = (listEn.json.cases || []).find((c) => c.id === 'physics');
  const zhChem = (listZh.json.cases || []).find((c) => c.id === 'chemistry');
  const enChem = (listEn.json.cases || []).find((c) => c.id === 'chemistry');
  record('lang-1', 'default case list stays Chinese', zhPhysics && zhPhysics.title === '意外的急刹车' && zhChem && zhChem.title === '台风夜老宅', zhPhysics && zhPhysics.title);
  record(
    'lang-2',
    'lang=en case list is English',
    enPhysics && enPhysics.title === 'The Unexpected Hard Brake' && enChem && enChem.title === 'The Typhoon-Night Old House' && enPhysics.i18n && enPhysics.i18n.zh && enPhysics.i18n.zh.title === '意外的急刹车',
    enPhysics && enPhysics.title
  );

  const created = await req('POST', '/api/teacher/create', { caseId: 'physics', teacherName: 'T' });
  const code = created.json.code;
  const teacherToken = created.json.teacherToken;
  const joinZh = await req('POST', '/api/student/join', { code, groupId: 'LZ', groupLabel: '中文组' });
  const blob = JSON.stringify(joinZh.json.case);
  record('lang-3', 'default join case is Chinese and hides the answer', joinZh.json.case.title === '意外的急刹车' && joinZh.json.case.locale === 'zh' && !joinZh.json.case.correctSuspectId && !blob.includes('Answer key') && !blob.includes('标准答案'), joinZh.json.case.title);
  record('lang-3b', 'join carries English overlay for client switch', !!(joinZh.json.case.i18n && joinZh.json.case.i18n.en && joinZh.json.case.i18n.en.title === 'The Unexpected Hard Brake' && !joinZh.json.case.i18n.en.revealSummary), '');

  const joinEn = await req('POST', '/api/student/join', { code, groupId: 'LE', groupLabel: 'EN' }, { 'x-lang': 'en' });
  const enCase = joinEn.json.case;
  const suspectA = (enCase.suspects || []).find((s) => s.id === 'A');
  const sign = ((enCase.maps || []).find((m) => m.id === 'road') || {}).items;
  const signName = sign && (sign.find((i) => i.id === 'sign') || {}).name;
  const e01 = (enCase.evidence || []).find((e) => e.id === 'E01');
  record(
    'lang-4',
    'x-lang en localizes narrative, suspect, map item, evidence',
    enCase.title === 'The Unexpected Hard Brake' &&
      enCase.locale === 'en' &&
      !enCase.correctSuspectId &&
      suspectA && suspectA.name === 'Lead driver A' && suspectA.sprite === 'luigi' &&
      signName === 'Speed-limit record' &&
      e01 && e01.studentText.indexOf('50 km/h') >= 0 &&
      enCase.i18n && enCase.i18n.zh && enCase.i18n.zh.title === '意外的急刹车' &&
      !JSON.stringify(enCase).includes('Answer key'),
    suspectA && suspectA.name
  );
  const alpha = (enCase.calcTasks || []).find((t) => t.id === 'alpha');
  record('lang-4b', 'calc prompt localized, sprite ids unchanged', !!(alpha && alpha.prompt.indexOf('v_A0') >= 0 && alpha.title.indexOf('Alpha') === 0), alpha && alpha.title);

  const createdC = await req('POST', '/api/teacher/create', { caseId: 'chemistry', teacherName: 'T' });
  const chem = await req('POST', '/api/student/join', { code: createdC.json.code, groupId: 'LC', groupLabel: 'EN' }, { 'x-lang': 'en' });
  const zhou = (chem.json.case.suspects || []).find((s) => s.id === 'zhou');
  record(
    'lang-5',
    'chemistry English case keeps Chinese ids',
    chem.json.case.title === 'The Typhoon-Night Old House' && zhou && zhou.name === 'Auntie Zhou' && zhou.sprite === 'daisy' && chem.json.case.voteQuestion.indexOf('bathroom') >= 0,
    zhou && zhou.name
  );

  const sid = joinZh.json.case.suspects[0].id;
  const presetsZh = await req('GET', `/api/student/${code}/interview/${sid}/presets`, null, { 'x-group-token': joinZh.json.groupToken });
  const presetsEn = await req('GET', `/api/student/${code}/interview/${sid}/presets`, null, { 'x-group-token': joinZh.json.groupToken, 'x-lang': 'en' });
  record(
    'lang-6',
    'mock presets have aligned zh and en questions',
    presetsZh.json.presets && presetsZh.json.presets[0] && presetsZh.json.label === '演示问答（Mock）' &&
      presetsEn.json.presets && presetsEn.json.presets[0] && presetsEn.json.presets[0] !== presetsZh.json.presets[0] &&
      (presetsZh.json.presetsEn || []).length === presetsZh.json.presets.length &&
      (presetsZh.json.qa || []).length === presetsZh.json.presets.length &&
      presetsZh.json.qa.every((row) => row.q && row.a && row.qEn && row.aEn),
    presetsEn.json.presets && presetsEn.json.presets[0]
  );
  const asked = await req(
    'POST',
    `/api/student/${code}/interview`,
    { suspectId: sid, question: presetsEn.json.presets[0] },
    { 'x-group-token': joinZh.json.groupToken, 'x-lang': 'en' }
  );
  record(
    'lang-7',
    'English question returns English answer and keeps Chinese canonical',
    asked.status === 200 && asked.json.mode === 'mock' && asked.json.answer && asked.json.answerEn === asked.json.answer && asked.json.answerZh && asked.json.answer !== asked.json.answerZh && !String(asked.json.answer).includes('标准答案'),
    asked.json.answer
  );

  const revZh = await req('POST', `/api/teacher/${code}/reveal`, {}, { 'x-teacher-token': teacherToken });
  record('lang-8', 'default reveal headline stays Chinese', revZh.json.revealSummary && revZh.json.revealSummary.headline.indexOf('标准答案') >= 0 && revZh.json.revealSummaryEn && revZh.json.revealSummaryEn.headline.indexOf('Answer key') >= 0, revZh.json.revealSummary && revZh.json.revealSummary.headline);

  const createdHidden = await req('POST', '/api/teacher/create', { caseId: 'physics', teacherName: 'T' });
  const joined = await req('POST', '/api/student/join', { code: createdHidden.json.code, groupId: 'G9', groupLabel: 'g9' });
  const hidden = await req('GET', `/api/student/${createdHidden.json.code}/state`, null, { 'x-group-token': joined.json.groupToken, 'x-lang': 'en' });
  const hiddenBlob = JSON.stringify(hidden.json);
  record(
    'lang-9',
    'English state before reveal does not include the answer key',
    hidden.status === 200 && hidden.json.revealSummary == null && hidden.json.progress.result == null && !hiddenBlob.includes('Answer key') && !hiddenBlob.includes('标准答案') && hidden.json.case.title === 'The Unexpected Hard Brake',
    ''
  );

  const { packLocale } = require('../public/js/case-locale');
  const back = packLocale(joinZh.json.case, 'en');
  const restored = packLocale(Object.assign({}, joinZh.json.case, { locale: 'zh' }), 'zh');
  record('lang-10', 'client locale helper switches both ways from one pack', back.title === 'The Unexpected Hard Brake' && back.suspects[0].sprite === 'luigi' && restored.title === '意外的急刹车', back.title);

  const listTw = await req('GET', '/api/cases?lang=zh-TW');
  const twPhysics = (listTw.json.cases || []).find((c) => c.id === 'physics');
  const twChem = (listTw.json.cases || []).find((c) => c.id === 'chemistry');
  record(
    'lang-11',
    'lang=zh-TW case list is Traditional and keeps simplified alongside',
    twPhysics && twPhysics.title === '意外的急煞車' && twPhysics.locale === 'zh-TW' &&
      twChem && twChem.title === '颱風夜老宅' && twChem.subject === '化學' &&
      twPhysics.i18n && twPhysics.i18n.zh && twPhysics.i18n.zh.title === '意外的急刹车',
    twPhysics && twPhysics.title
  );

  const joinTw = await req('POST', '/api/student/join', { code, groupId: 'LT', groupLabel: '繁體組' }, { 'x-lang': 'zh-TW' });
  const twCase = joinTw.json.case;
  const driver = (twCase.suspects || []).find((s) => s.id === 'A');
  const twSign = (((twCase.maps || []).find((m) => m.id === 'road') || {}).items || []).find((i) => i.id === 'sign');
  const twE01 = (twCase.evidence || []).find((e) => e.id === 'E01');
  const twBlob = JSON.stringify(twCase);
  record(
    'lang-12',
    'x-lang zh-TW localizes physics narrative, suspect, item, evidence',
    twCase.title === '意外的急煞車' && twCase.locale === 'zh-TW' && !twCase.correctSuspectId &&
      driver && driver.name === '前車司機A' && driver.sprite === 'luigi' &&
      twSign && twSign.name === '限速標誌記錄' &&
      twE01 && twE01.studentText.indexOf('50 km/h') >= 0 && twE01.name === '道路限速記錄' &&
      twCase.i18n && twCase.i18n.zh && twCase.i18n.zh.title === '意外的急刹车' &&
      twCase.i18n['zh-TW'] && !twCase.i18n['zh-TW'].revealSummary &&
      !twBlob.includes('标准答案') && !twBlob.includes('標準答案') && !twBlob.includes('Answer key'),
    driver && driver.name
  );
  record(
    'lang-12b',
    'default join carries a Traditional overlay for client switching',
    !!(joinZh.json.case.i18n && joinZh.json.case.i18n['zh-TW'] && joinZh.json.case.i18n['zh-TW'].title === '意外的急煞車' && !joinZh.json.case.i18n['zh-TW'].revealSummary),
    ''
  );

  const twBack = packLocale(joinZh.json.case, 'zh-TW');
  const twRestored = packLocale(twCase, 'zh');
  const twToEn = packLocale(twCase, 'en');
  record(
    'lang-13',
    'client helper switches among zh, zh-TW, and en',
    twBack.title === '意外的急煞車' && twBack.suspects[0].sprite === 'luigi' &&
      twRestored.title === '意外的急刹车' && twToEn.title === 'The Unexpected Hard Brake',
    twBack.title
  );

  const headerTw = await req('GET', '/api/cases', null, { 'x-lang': 'zh-tw' });
  const headerPhysics = (headerTw.json.cases || []).find((c) => c.id === 'physics');
  record('lang-14', 'x-lang zh-tw header matches ?lang=zh-TW', headerPhysics && headerPhysics.title === '意外的急煞車', headerPhysics && headerPhysics.title);

  const chemTw = await req('POST', '/api/student/join', { code: createdC.json.code, groupId: 'LCT', groupLabel: '繁體' }, { 'x-lang': 'zh-TW' });
  const zhouTw = (chemTw.json.case.suspects || []).find((s) => s.id === 'zhou');
  record(
    'lang-15',
    'chemistry Traditional keeps ids and the surname 余',
    chemTw.json.case.title === '颱風夜老宅' && zhouTw && zhouTw.name === '周姨' && zhouTw.sprite === 'daisy' &&
      chemTw.json.case.background.indexOf('余老師') >= 0 && chemTw.json.case.background.indexOf('餘老師') < 0 &&
      chemTw.json.case.voteQuestion.indexOf('浴室') >= 0,
    zhouTw && zhouTw.name
  );

  const presetsTw = await req('GET', `/api/student/${code}/interview/${sid}/presets`, null, { 'x-group-token': joinZh.json.groupToken, 'x-lang': 'zh-TW' });
  record(
    'lang-16',
    'Traditional mock presets differ from simplified and stay aligned',
    presetsTw.json.label === '示範問答（Mock）' &&
      presetsTw.json.presets && presetsTw.json.presets[0] && presetsTw.json.presets[0] !== presetsZh.json.presets[0] &&
      presetsTw.json.presets[0].indexOf('車') >= 0 &&
      (presetsZh.json.qa || []).every((row) => row.qTw && row.aTw && row.qEn && row.aEn),
    presetsTw.json.presets && presetsTw.json.presets[0]
  );
  const askedTw = await req(
    'POST',
    `/api/student/${code}/interview`,
    { suspectId: sid, question: presetsTw.json.presets[0] },
    { 'x-group-token': joinZh.json.groupToken, 'x-lang': 'zh-TW' }
  );
  record(
    'lang-17',
    'Traditional question returns a Traditional answer and keeps simplified canonical',
    askedTw.status === 200 && askedTw.json.answer && askedTw.json.answerTw === askedTw.json.answer &&
      askedTw.json.answerZh && askedTw.json.answer !== askedTw.json.answerZh &&
      !String(askedTw.json.answer).includes('標準答案'),
    askedTw.json.answer
  );

  const revTw = await req('POST', `/api/teacher/${code}/reveal`, {}, { 'x-teacher-token': teacherToken, 'x-lang': 'zh-TW' });
  record(
    'lang-18',
    'reveal honors zh-TW and still returns simplified and English',
    revTw.json.revealSummary && revTw.json.revealSummary.headline.indexOf('標準答案') >= 0 &&
      revTw.json.revealSummaryZh && revTw.json.revealSummaryZh.headline.indexOf('标准答案') >= 0 &&
      revTw.json.revealSummaryEn && revTw.json.revealSummaryEn.headline.indexOf('Answer key') >= 0 &&
      revTw.json.revealSummaryTw && revTw.json.revealSummaryTw.headline.indexOf('標準答案') >= 0,
    revTw.json.revealSummary && revTw.json.revealSummary.headline
  );
}

async function main() {
  require('./click-move').run(record);

  const server = await new Promise((resolve) => {
    const s = app.listen(PORT, () => resolve(s));
  });

  try {
    const health = await req('GET', '/api/health');
    record('0', 'health', health.status === 200 && health.json.ok, '');

    await flowForCase('physics', 'A', 'B');
    await flowForCase('chemistry', 'zhou', 'he');

    // Multi-group data isolation: evidence of G1 not in G2
    const c = await req('POST', '/api/teacher/create', { caseId: 'physics' });
    const g1 = await req('POST', '/api/student/join', { code: c.json.code, groupId: 'A1', groupLabel: 'a' });
    const g2 = await req('POST', '/api/student/join', { code: c.json.code, groupId: 'A2', groupLabel: 'b' });
    await req('POST', `/api/student/${c.json.code}/investigate`, { itemId: 'sign' }, { 'x-group-token': g1.json.groupToken });
    const s2 = await req('GET', `/api/student/${c.json.code}/state`, null, { 'x-group-token': g2.json.groupToken });
    record('12c', 'group evidence isolation', (s2.json.progress.evidence || []).length === 0, '');

    // Static pages
    for (const p of ['/', '/teacher.html', '/student.html', '/js/game-engine.js', '/js/i18n.js', '/js/case-locale.js']) {
      const r = await req('GET', p);
      record('static-' + p, 'serves ' + p, r.status === 200 && !String(r.raw).includes('"error"'), String(r.status));
    }
    const home = await req('GET', '/');
    const teacherPage = await req('GET', '/teacher.html');
    const studentPage = await req('GET', '/student.html');
    record(
      'lang-ui',
      'language toggle on home, teacher, student',
      [home, teacherPage, studentPage].every((r) => r.raw.includes('id="langSwitch"') && r.raw.includes('data-set-lang="zh-TW"') && r.raw.includes('data-set-lang="en"') && r.raw.includes('繁體') && r.raw.includes('/js/i18n.js')),
      ''
    );

    await langChecks();
  } finally {
    server.close();
  }

  const failed = results.filter((r) => !r.pass);
  const fs = require('fs');
  const path = require('path');
  const md = [
    '# TEST_RESULTS',
    '',
    `Generated: ${new Date().toISOString()} (script clock; report to user in Asia/Shanghai).`,
    '',
    `Automated: ${results.length - failed.length}/${results.length} passed.`,
    '',
    '| ID | Result | Name | Detail |',
    '|----|--------|------|--------|',
    ...results.map((r) => `| ${r.id} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.name} | ${String(r.detail).replace(/\|/g, '/')} |`),
    '',
    '## Manual checks (not claimed automated)',
    '',
    '- [ ] Click or tap the floor to walk; click a clue, person, or door to approach and interact (physics road↔hq, chemistry rooms)',
    '- [ ] Opening a panel cancels the walk; closing it allows clicks again',
    '- [ ] Tap the scene on a phone-width viewport (no WASD, no D-pad)',
    '- [ ] 简体 | 繁體 | EN on home, teacher, and student; choice survives refresh (ai-detective-lang)',
    '- [ ] UI label 演示问答（Mock） visible during interview',
    '- [ ] After submit, UI shows only 已提交，等待揭晓 until teacher reveal',
    '- [ ] No UI for second round / eliminate / bonus clues',
    '- [ ] Chemistry TODO markers visible on C-E05 card',
    '',
    failed.length ? '## Failures present — fix before claiming full acceptance.' : '## Automated suite green.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(__dirname, '..', 'TEST_RESULTS.md'), md);
  console.log('\nWrote TEST_RESULTS.md');
  if (failed.length) {
    console.error(`FAILED ${failed.length}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
