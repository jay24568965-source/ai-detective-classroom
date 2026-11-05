/**
 * AI侦探课堂 - tiny Express + in-memory store
 * Teacher answers stay server-side; students get public case views only.
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { randomBytes } = require('crypto');
const { apply: applyCaseLocale } = require('./public/js/case-locale');

const app = express();
const PORT = process.env.PORT || 3080;
const CASES_DIR = path.join(__dirname, 'cases');

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/** @type {Map<string, object>} */
const rooms = new Map();

function loadCaseRaw(caseId) {
  const file = path.join(CASES_DIR, `${caseId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** zh by default. Only an explicit ?lang= or x-lang header selects English. */
function requestedLang(req) {
  const q = String((req && req.query && req.query.lang) || '').toLowerCase();
  const h = String((req && req.get && req.get('x-lang')) || '').toLowerCase();
  if (q === 'en' || h === 'en') return 'en';
  return 'zh';
}

/** Student-safe English overlay. Reveal text is attached only after the teacher reveals. */
function studentEnOverlay(raw) {
  const en = raw && raw.i18n && raw.i18n.en;
  if (!en) return null;
  const copy = JSON.parse(JSON.stringify(en));
  delete copy.revealSummary;
  // Answers stay on the interview route. The public case only needs names and narrative.
  if (copy.suspects) {
    Object.keys(copy.suspects).forEach((id) => {
      if (copy.suspects[id]) delete copy.suspects[id].mockQA;
    });
  }
  return copy;
}

function revealPair(raw, lang) {
  const zh = raw.revealSummary || null;
  const en = (raw.i18n && raw.i18n.en && raw.i18n.en.revealSummary) || null;
  if (lang === 'en' && en) {
    return { revealSummary: en, revealSummaryZh: zh, revealSummaryEn: en };
  }
  return { revealSummary: zh, revealSummaryEn: en };
}

/** Strip teacher-only / answer fields for student clients */
function publicCaseView(raw, stage, lang) {
  const stageNum = stage || 1;
  const unlocked = new Set();
  (raw.stages || []).forEach((s) => {
    if (s.id <= stageNum) (s.unlockEvidence || []).forEach((id) => unlocked.add(id));
  });

  const evidence = (raw.evidence || [])
    .filter((e) => e.stage === 'calc' || unlocked.has(e.id) || (typeof e.stage === 'number' && e.stage <= stageNum))
    .map((e) => ({
      id: e.id,
      name: e.name,
      stage: e.stage,
      source: e.source,
      studentText: e.studentText,
      calcFields: e.calcFields || null,
    }));

  const view = {
    id: raw.id,
    title: raw.title,
    subject: raw.subject,
    durationHint: raw.durationHint,
    voteQuestion: raw.voteQuestion,
    // correctSuspectId intentionally omitted
    background: raw.background,
    briefing: raw.briefing,
    hostNpc: raw.hostNpc,
    suspects: (raw.suspects || []).map((s) => ({
      id: s.id,
      name: s.name,
      shortName: s.shortName,
      role: s.role,
      location: s.location,
      portrait: s.portrait,
      sprite: s.sprite,
      card: s.card,
      // mockQA served via /api/interview only (still mock, no secrets)
    })),
    maps: raw.maps,
    evidence,
    calcTasks: raw.calcTasks,
    stages: (raw.stages || []).map((s) => ({ id: s.id, name: s.name })),
    evidenceCatalogIds: (raw.evidence || []).map((e) => e.id),
  };

  const en = studentEnOverlay(raw);
  const zhSnap = JSON.parse(JSON.stringify(view));
  if (lang !== 'en' || !en) {
    zhSnap.locale = 'zh';
    zhSnap.i18n = { en };
    return zhSnap;
  }
  const localized = applyCaseLocale(zhSnap, en);
  localized.locale = 'en';
  localized.i18n = { en, zh: zhSnap };
  return localized;
}

function code6() {
  return randomBytes(3).toString('hex').toUpperCase();
}

function groupToken() {
  return randomBytes(8).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase());
}

function publicRoomState(room) {
  return {
    code: room.code,
    caseId: room.caseId,
    caseTitle: room.caseTitle,
    caseTitleEn: room.caseTitleEn || null,
    stage: room.stage,
    votingOpen: room.votingOpen,
    revealed: room.revealed,
    paused: room.paused,
    hints: room.hints.slice(-5),
    groups: Object.values(room.groups).map((g) => ({
      id: g.id,
      label: g.label,
      evidenceCount: g.evidence.length,
      interviewed: g.interviewed.length,
      ready: g.ready,
      voted: !!g.vote,
      result: room.revealed ? g.result : null,
      lastSeen: g.lastSeen,
    })),
    createdAt: room.createdAt,
  };
}

function ensureGroupProgress(g) {
  if (!g.evidence) g.evidence = [];
  if (!g.viewed) g.viewed = [];
  if (!g.interviewed) g.interviewed = [];
  if (!g.notes) g.notes = '';
  if (!g.calc) g.calc = {};
  if (!g.logs) g.logs = [];
  if (!g.position) g.position = null;
  if (g.ready == null) g.ready = false;
  if (!g.result) g.result = null;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, time: nowIso() });
});

app.get('/api/cases', (req, res) => {
  const lang = requestedLang(req);
  const list = ['physics', 'chemistry']
    .map((id) => {
      const raw = loadCaseRaw(id);
      if (!raw) return null;
      const en = raw.i18n && raw.i18n.en;
      const zh = { title: raw.title, subject: raw.subject, durationHint: raw.durationHint };
      const item = {
        id: raw.id,
        title: raw.title,
        subject: raw.subject,
        durationHint: raw.durationHint,
        i18n: {
          en: en ? { title: en.title, subject: en.subject, durationHint: en.durationHint } : null,
        },
      };
      if (lang === 'en' && en) {
        item.title = en.title;
        item.subject = en.subject;
        item.durationHint = en.durationHint;
        item.locale = 'en';
        item.i18n.zh = zh;
      }
      return item;
    })
    .filter(Boolean);
  res.json({ cases: list });
});

/** Teacher creates classroom */
app.post('/api/teacher/create', (req, res) => {
  const { caseId, teacherName } = req.body || {};
  const raw = loadCaseRaw(caseId);
  if (!raw) return res.status(400).json({ error: '未知案件，请选择 physics 或 chemistry' });

  let code = code6();
  while (rooms.has(code)) code = code6();
  const teacherToken = groupToken();

  const room = {
    code,
    teacherToken,
    teacherName: teacherName || '教师',
    caseId: raw.id,
    caseTitle: raw.title,
    caseTitleEn: (raw.i18n && raw.i18n.en && raw.i18n.en.title) || null,
    stage: 1,
    votingOpen: false,
    revealed: false,
    paused: false,
    hints: [],
    groups: {},
    createdAt: nowIso(),
    correctSuspectId: raw.correctSuspectId,
  };
  rooms.set(code, room);
  res.json({
    code,
    teacherToken,
    caseId: raw.id,
    caseTitle: raw.title,
    caseTitleEn: room.caseTitleEn,
    state: publicRoomState(room),
  });
});

function requireTeacher(req, res) {
  const room = getRoom(req.params.code || req.body.code);
  if (!room) {
    res.status(404).json({ error: '课堂不存在' });
    return null;
  }
  const token = req.headers['x-teacher-token'] || req.body.teacherToken;
  if (token !== room.teacherToken) {
    res.status(403).json({ error: '教师权限校验失败' });
    return null;
  }
  return room;
}

app.get('/api/teacher/:code/state', (req, res) => {
  const room = requireTeacher(req, res);
  if (!room) return;
  const raw = loadCaseRaw(room.caseId);
  const revealedPack = room.revealed ? revealPair(raw, requestedLang(req)) : null;
  res.json({
    state: publicRoomState(room),
    revealSummary: revealedPack ? revealedPack.revealSummary : null,
    revealSummaryEn: revealedPack ? revealedPack.revealSummaryEn : null,
    revealSummaryZh: revealedPack ? revealedPack.revealSummaryZh || null : null,
    correctSuspectId: room.revealed ? room.correctSuspectId : null,
    groupsDetail: Object.values(room.groups).map((g) => ({
      id: g.id,
      label: g.label,
      evidence: g.evidence,
      interviewed: g.interviewed,
      notes: g.notes,
      calc: g.calc,
      vote: room.revealed || !room.votingOpen ? g.vote : g.vote ? { submitted: true } : null,
      result: room.revealed ? g.result : null,
      ready: g.ready,
    })),
  });
});

app.post('/api/teacher/:code/stage', (req, res) => {
  const room = requireTeacher(req, res);
  if (!room) return;
  const stage = Number(req.body.stage);
  if (![1, 2, 3].includes(stage)) return res.status(400).json({ error: 'stage 须为 1/2/3' });
  room.stage = stage;
  room.hints.push({ at: nowIso(), text: `教师将调查推进到第 ${stage} 幕` });
  res.json({ state: publicRoomState(room) });
});

app.post('/api/teacher/:code/hint', (req, res) => {
  const room = requireTeacher(req, res);
  if (!room) return;
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: '提示不能为空' });
  room.hints.push({ at: nowIso(), text });
  res.json({ state: publicRoomState(room) });
});

app.post('/api/teacher/:code/pause', (req, res) => {
  const room = requireTeacher(req, res);
  if (!room) return;
  room.paused = !!req.body.paused;
  res.json({ state: publicRoomState(room) });
});

app.post('/api/teacher/:code/vote/open', (req, res) => {
  const room = requireTeacher(req, res);
  if (!room) return;
  if (room.revealed) return res.status(400).json({ error: '已揭晓，不能重新开票（单轮投票）' });
  room.votingOpen = true;
  room.hints.push({ at: nowIso(), text: '最终投票已开启，请各组返回主持人处提交。' });
  res.json({ state: publicRoomState(room) });
});

app.post('/api/teacher/:code/vote/close', (req, res) => {
  const room = requireTeacher(req, res);
  if (!room) return;
  room.votingOpen = false;
  room.hints.push({ at: nowIso(), text: '最终投票已关闭。' });
  res.json({ state: publicRoomState(room) });
});

app.post('/api/teacher/:code/reveal', (req, res) => {
  const room = requireTeacher(req, res);
  if (!room) return;
  room.votingOpen = false;
  room.revealed = true;
  const raw = loadCaseRaw(room.caseId);
  Object.values(room.groups).forEach((g) => {
    if (!g.vote) {
      g.result = '未提交';
    } else if (g.vote.suspectId === room.correctSuspectId) {
      g.result = '合格';
    } else {
      g.result = '不合格';
    }
    g.logs.push({ at: nowIso(), type: 'reveal', result: g.result });
  });
  const pack = revealPair(raw, requestedLang(req));
  res.json({
    state: publicRoomState(room),
    correctSuspectId: room.correctSuspectId,
    revealSummary: pack.revealSummary,
    revealSummaryEn: pack.revealSummaryEn,
    revealSummaryZh: pack.revealSummaryZh || null,
  });
});

app.get('/api/teacher/:code/export', (req, res) => {
  const room = requireTeacher(req, res);
  if (!room) return;
  const format = (req.query.format || 'json').toLowerCase();
  const payload = {
    exportedAt: nowIso(),
    room: room.code,
    caseId: room.caseId,
    caseTitle: room.caseTitle,
    stage: room.stage,
    revealed: room.revealed,
    correctSuspectId: room.revealed ? room.correctSuspectId : '(hidden until reveal)',
    hints: room.hints,
    groups: Object.values(room.groups).map((g) => ({
      groupId: g.id,
      label: g.label,
      evidence: g.evidence,
      interviewed: g.interviewed,
      notes: g.notes,
      calc: g.calc,
      vote: g.vote,
      result: g.result,
      logs: g.logs,
    })),
  };

  if (format === 'csv') {
    const rows = [['groupId', 'label', 'votedSuspect', 'rationale', 'evidenceCited', 'result', 'submittedAt']];
    Object.values(room.groups).forEach((g) => {
      rows.push([
        g.id,
        g.label,
        g.vote ? g.vote.suspectId : '',
        g.vote ? String(g.vote.rationale || '').replace(/"/g, '""') : '',
        g.vote ? String(g.vote.evidenceCited || '').replace(/"/g, '""') : '',
        g.result || '',
        g.vote ? g.vote.at : '',
      ]);
    });
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/\n/g, ' ')}"`).join(','))
      .join('\n');
    const bom = '\uFEFF';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="log-${room.code}.csv"`);
    return res.send(bom + csv);
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="log-${room.code}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

/** Student joins with room code + chosen group label; receives unguessable token */
app.post('/api/student/join', (req, res) => {
  const room = getRoom(req.body.code);
  if (!room) return res.status(404).json({ error: '课堂不存在' });
  const label = String(req.body.groupLabel || '').trim() || '小组';
  const groupId = String(req.body.groupId || '').trim() || `G${Object.keys(room.groups).length + 1}`;

  // Rejoin with token
  if (req.body.groupToken) {
    const existing = Object.values(room.groups).find((g) => g.token === req.body.groupToken);
    if (existing) {
      existing.lastSeen = nowIso();
      const raw = loadCaseRaw(room.caseId);
      return res.json({
        groupId: existing.id,
        groupToken: existing.token,
        label: existing.label,
        case: publicCaseView(raw, room.stage, requestedLang(req)),
        progress: sanitizeProgress(existing, room),
        state: publicRoomState(room),
      });
    }
  }

  if (room.groups[groupId]) {
    return res.status(409).json({ error: '该小组ID已被占用，请换一个或使用原 token 重连' });
  }

  const token = groupToken();
  const g = {
    id: groupId,
    label,
    token,
    evidence: [],
    viewed: [],
    interviewed: [],
    notes: '',
    calc: {},
    ready: false,
    vote: null,
    result: null,
    position: { mapId: loadCaseRaw(room.caseId).maps[0].id, x: loadCaseRaw(room.caseId).maps[0].spawn.x, y: loadCaseRaw(room.caseId).maps[0].spawn.y },
    logs: [{ at: nowIso(), type: 'join' }],
    lastSeen: nowIso(),
  };
  room.groups[groupId] = g;
  const raw = loadCaseRaw(room.caseId);
  res.json({
    groupId,
    groupToken: token,
    label,
    case: publicCaseView(raw, room.stage, requestedLang(req)),
    progress: sanitizeProgress(g, room),
    state: publicRoomState(room),
  });
});

function requireGroup(req, res) {
  const room = getRoom(req.params.code || req.body.code);
  if (!room) {
    res.status(404).json({ error: '课堂不存在' });
    return null;
  }
  const token = req.headers['x-group-token'] || req.body.groupToken;
  const g = Object.values(room.groups).find((x) => x.token === token);
  if (!g) {
    res.status(403).json({ error: '小组身份校验失败' });
    return null;
  }
  g.lastSeen = nowIso();
  ensureGroupProgress(g);
  return { room, g };
}

function sanitizeProgress(g, room) {
  return {
    evidence: g.evidence,
    viewed: g.viewed,
    interviewed: g.interviewed,
    notes: g.notes,
    calc: g.calc,
    ready: g.ready,
    position: g.position,
    voteSubmitted: !!g.vote,
    // after submit, before reveal: only waiting message
    voteEcho: g.vote && !room.revealed ? { status: '已提交，等待揭晓' } : null,
    vote: room.revealed ? g.vote : null,
    result: room.revealed ? g.result : null,
  };
}

app.get('/api/student/:code/state', (req, res) => {
  const ctx = requireGroup(req, res);
  if (!ctx) return;
  const { room, g } = ctx;
  const raw = loadCaseRaw(room.caseId);
  const lang = requestedLang(req);
  const revealedPack = room.revealed ? revealPair(raw, lang) : null;
  res.json({
    case: publicCaseView(raw, room.stage, lang),
    progress: sanitizeProgress(g, room),
    state: publicRoomState(room),
    revealSummary: revealedPack ? revealedPack.revealSummary : null,
    revealSummaryEn: revealedPack ? revealedPack.revealSummaryEn : null,
    revealSummaryZh: revealedPack ? revealedPack.revealSummaryZh || null : null,
  });
});

app.post('/api/student/:code/position', (req, res) => {
  const ctx = requireGroup(req, res);
  if (!ctx) return;
  const { g } = ctx;
  const { mapId, x, y } = req.body || {};
  if (mapId != null) g.position = { mapId, x: Number(x), y: Number(y) };
  res.json({ ok: true, position: g.position });
});

app.post('/api/student/:code/investigate', (req, res) => {
  const ctx = requireGroup(req, res);
  if (!ctx) return;
  const { room, g } = ctx;
  const raw = loadCaseRaw(room.caseId);
  const itemId = req.body.itemId;
  let foundItem = null;
  let mapId = null;
  for (const m of raw.maps) {
    const it = (m.items || []).find((i) => i.id === itemId);
    if (it) {
      foundItem = it;
      mapId = m.id;
      break;
    }
  }
  if (!foundItem) return res.status(404).json({ error: '物品不存在' });

  if (!g.viewed.includes(itemId)) g.viewed.push(itemId);

  const unlocked = new Set();
  (raw.stages || []).forEach((s) => {
    if (s.id <= room.stage) (s.unlockEvidence || []).forEach((id) => unlocked.add(id));
  });

  const gained = [];
  for (const eid of foundItem.evidenceIds || []) {
    const ev = (raw.evidence || []).find((e) => e.id === eid);
    if (!ev) continue;
    if (ev.stage === 'calc') continue;
    if (typeof ev.stage === 'number' && ev.stage > room.stage) continue;
    if (!unlocked.has(ev.id) && typeof ev.stage === 'number') continue;
    if (!g.evidence.find((x) => x.id === eid)) {
      const card = { id: ev.id, name: ev.name, source: ev.source, studentText: ev.studentText, fromItem: itemId, at: nowIso() };
      g.evidence.push(card);
      gained.push(card);
      g.logs.push({ at: nowIso(), type: 'evidence', evidenceId: eid, itemId });
    }
  }

  const lang = requestedLang(req);
  const en = lang === 'en' ? studentEnOverlay(raw) : null;
  let itemName = foundItem.name;
  let gainedOut = gained;
  if (en) {
    const mapHit = (raw.maps || []).find((m) => (m.items || []).some((i) => i.id === itemId));
    const translated = mapHit && en.maps && en.maps[mapHit.id] && en.maps[mapHit.id].items && en.maps[mapHit.id].items[itemId];
    if (translated) itemName = translated;
    gainedOut = gained.map((card) => {
      const t = en.evidence && en.evidence[card.id];
      if (!t) return card;
      return Object.assign({}, card, {
        name: t.name || card.name,
        source: t.source || card.source,
        studentText: t.studentText || card.studentText,
      });
    });
  }

  res.json({
    viewed: true,
    itemName,
    itemNameZh: foundItem.name,
    action: foundItem.action || null,
    gained: gainedOut,
    progress: sanitizeProgress(g, room),
  });
});

app.post('/api/student/:code/notes', (req, res) => {
  const ctx = requireGroup(req, res);
  if (!ctx) return;
  const { room, g } = ctx;
  g.notes = String(req.body.notes || '');
  g.logs.push({ at: nowIso(), type: 'notes' });
  res.json({ progress: sanitizeProgress(g, room) });
});

app.post('/api/student/:code/calc', (req, res) => {
  const ctx = requireGroup(req, res);
  if (!ctx) return;
  const { room, g } = ctx;
  const fields = req.body.fields || {};
  g.calc = { ...g.calc, ...fields, updatedAt: nowIso() };
  g.logs.push({ at: nowIso(), type: 'calc', keys: Object.keys(fields) });
  res.json({ progress: sanitizeProgress(g, room) });
});

app.post('/api/student/:code/ready', (req, res) => {
  const ctx = requireGroup(req, res);
  if (!ctx) return;
  const { room, g } = ctx;
  g.ready = !!req.body.ready;
  res.json({ progress: sanitizeProgress(g, room), state: publicRoomState(room) });
});

function enMockQA(raw, suspectId) {
  const bag = raw.i18n && raw.i18n.en && raw.i18n.en.suspects && raw.i18n.en.suspects[suspectId];
  return (bag && bag.mockQA) || [];
}

/** Chinese match keeps the original rules. English is used only when Chinese does not hit. */
function matchMockQA(qa, enList, question) {
  const list = qa || [];
  const en = enList || [];
  if (!list.length) return -1;
  if (question) {
    const exact = list.findIndex((pair) => pair.q === question);
    if (exact >= 0) return exact;
    const pref = list.findIndex((pair) => pair.q && question.includes(pair.q.slice(0, 6)));
    if (pref >= 0) return pref;
    const tokens = question.split(/\s+/).filter(Boolean);
    const scored = list
      .map((pair, i) => {
        const score = tokens.reduce((n, t) => n + (pair.q.includes(t) || pair.a.includes(t) ? 1 : 0), 0);
        return { i, score };
      })
      .sort((a, b) => b.score - a.score);
    if (scored[0] && scored[0].score > 0) return scored[0].i;
    const enExact = en.findIndex((pair) => pair && pair.q === question);
    if (enExact >= 0) return enExact;
    const enTokens = question.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    let best = -1;
    let bestScore = 0;
    en.forEach((pair, i) => {
      if (!pair || !pair.q) return;
      const hay = `${pair.q} ${pair.a || ''}`.toLowerCase();
      const score = enTokens.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0) return best;
  }
  return 0;
}

function interviewPayload(raw, suspect, lang) {
  const qa = suspect.mockQA || [];
  const enList = enMockQA(raw, suspect.id);
  const enName = raw.i18n && raw.i18n.en && raw.i18n.en.suspects && raw.i18n.en.suspects[suspect.id];
  return { qa, enList, enName: enName || {}, lang };
}

/** Mock interview — preset Q&A only; structured for future Convai adapter */
app.post('/api/student/:code/interview', (req, res) => {
  const ctx = requireGroup(req, res);
  if (!ctx) return;
  const { room, g } = ctx;
  const raw = loadCaseRaw(room.caseId);
  const suspectId = req.body.suspectId;
  const question = String(req.body.question || '').trim();
  const suspect = (raw.suspects || []).find((s) => s.id === suspectId);
  if (!suspect) return res.status(404).json({ error: '人物不存在' });

  if (!g.interviewed.includes(suspectId)) g.interviewed.push(suspectId);

  const lang = requestedLang(req);
  const { qa, enList, enName } = interviewPayload(raw, suspect, lang);
  const idx = matchMockQA(qa, enList, question);
  const pair = idx >= 0 && qa[idx] ? qa[idx] : null;
  const enPair = idx >= 0 && enList[idx] ? enList[idx] : null;
  const answerZh = pair ? pair.a : '……（对方没有更多可说的了）';
  const questionZh = pair ? pair.q : question;
  const answerEn = enPair && enPair.a ? enPair.a : null;
  const questionEn = enPair && enPair.q ? enPair.q : null;

  // Preset answers are author-controlled and must not include the reveal headline.
  g.logs.push({ at: nowIso(), type: 'interview', suspectId, question: questionZh || question });
  const useEn = lang === 'en';
  res.json({
    mode: 'mock',
    label: useEn ? 'Demo Q&A (Mock)' : '演示问答（Mock）',
    labelEn: 'Demo Q&A (Mock)',
    suspectId,
    suspectName: useEn && enName.name ? enName.name : suspect.name,
    suspectNameZh: suspect.name,
    presets: useEn && enList.length ? enList.map((p) => p.q) : qa.map((p) => p.q),
    presetsZh: qa.map((p) => p.q),
    presetsEn: enList.map((p) => p && p.q).filter(Boolean),
    qa: qa.map((p, i) => ({
      q: p.q,
      a: p.a,
      qEn: enList[i] && enList[i].q,
      aEn: enList[i] && enList[i].a,
    })),
    question: useEn && questionEn ? questionEn : questionZh,
    questionZh,
    questionEn,
    answer: useEn && answerEn ? answerEn : answerZh,
    answerZh,
    answerEn,
    adapter: { provider: 'mock', convaiReady: false },
    progress: sanitizeProgress(g, room),
  });
});

app.get('/api/student/:code/interview/:suspectId/presets', (req, res) => {
  const ctx = requireGroup(req, res);
  if (!ctx) return;
  const { room } = ctx;
  const raw = loadCaseRaw(room.caseId);
  const suspect = (raw.suspects || []).find((s) => s.id === req.params.suspectId);
  if (!suspect) return res.status(404).json({ error: '人物不存在' });
  const lang = requestedLang(req);
  const { qa, enList } = interviewPayload(raw, suspect, lang);
  const useEn = lang === 'en' && enList.length;
  res.json({
    mode: 'mock',
    label: useEn ? 'Demo Q&A (Mock)' : '演示问答（Mock）',
    labelEn: 'Demo Q&A (Mock)',
    presets: useEn ? enList.map((p) => p.q) : qa.map((p) => p.q),
    presetsZh: qa.map((p) => p.q),
    presetsEn: enList.map((p) => p && p.q).filter(Boolean),
    qa: qa.map((p, i) => ({
      q: p.q,
      a: p.a,
      qEn: enList[i] && enList[i].q,
      aEn: enList[i] && enList[i].a,
    })),
    adapter: { provider: 'mock', convaiReady: false },
  });
});

/** Final vote — single round, server validated */
app.post('/api/student/:code/vote', (req, res) => {
  const ctx = requireGroup(req, res);
  if (!ctx) return;
  const { room, g } = ctx;

  if (room.revealed) return res.status(400).json({ error: '已揭晓，不能再提交' });
  if (!room.votingOpen) return res.status(403).json({ error: '老师尚未开启投票或已截止' });
  if (g.vote) return res.status(409).json({ error: '本组已提交，不能改选或重复提交', progress: sanitizeProgress(g, room) });

  const suspectId = String(req.body.suspectId || '').trim();
  const raw = loadCaseRaw(room.caseId);
  const ok = (raw.suspects || []).some((s) => s.id === suspectId);
  if (!ok) return res.status(400).json({ error: '无效的嫌疑人选择' });

  const rationale = String(req.body.rationale || '').trim();
  const evidenceCited = String(req.body.evidenceCited || '').trim();
  if (!rationale || !evidenceCited) {
    return res.status(400).json({ error: '请填写证据与科学分析依据' });
  }

  g.vote = { suspectId, rationale, evidenceCited, at: nowIso() };
  g.logs.push({ at: nowIso(), type: 'vote', suspectId });
  // Do not return correctness
  res.json({
    ok: true,
    message: '已提交，等待揭晓',
    progress: sanitizeProgress(g, room),
  });
});

// Fallback SPA-ish
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`AI侦探课堂 listening on http://127.0.0.1:${PORT}`);
  });
}

module.exports = { app, rooms, loadCaseRaw, publicCaseView };
