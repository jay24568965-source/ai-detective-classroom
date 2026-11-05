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

async function main() {
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
    for (const p of ['/', '/teacher.html', '/student.html', '/js/game-engine.js']) {
      const r = await req('GET', p);
      record('static-' + p, 'serves ' + p, r.status === 200, String(r.status));
    }
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
    '- [ ] WASD movement, collision with walls, door transitions (physics road↔hq, chemistry rooms)',
    '- [ ] Panel open blocks movement keys; close restores',
    '- [ ] Touch pad on coarse pointer',
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
