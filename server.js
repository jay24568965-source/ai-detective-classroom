/**
 * AI侦探课堂 - tiny Express + in-memory store
 * Teacher answers stay server-side; students get public case views only.
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { randomBytes } = require('crypto');
const { apply: applyCaseLocale, normalizeLang } = require('./public/js/case-locale');
const { isConfigured, modelName } = require('./lib/deepseek');
const { completeSuspectReply, liveLabel } = require('./lib/ai-interview');

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

/** zh by default. ?lang= or x-lang selects en or zh-TW. Old zh/en values still work. */
function requestedLang(req) {
  const q = String((req && req.query && req.query.lang) || '').trim();
  const h = String((req && req.get && req.get('x-lang')) || '').trim();
  const raw = q || h;
  if (!raw) return 'zh';
  return normalizeLang(raw);
}

/** Student-safe overlay. Reveal text is attached only after the teacher reveals. */
function studentOverlay(raw, langKey) {
  const bag = raw && raw.i18n && raw.i18n[langKey];
  if (!bag) return null;
  const copy = JSON.parse(JSON.stringify(bag));
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
  const tw = (raw.i18n && raw.i18n['zh-TW'] && raw.i18n['zh-TW'].revealSummary) || null;
  const chosen = lang === 'en' && en ? en : lang === 'zh-TW' && tw ? tw : zh;
  return {
    revealSummary: chosen,
    revealSummaryZh: zh,
    revealSummaryEn: en,
    revealSummaryTw: tw,
  };
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

  const en = studentOverlay(raw, 'en');
  const tw = studentOverlay(raw, 'zh-TW');
  const zhSnap = JSON.parse(JSON.stringify(view));
  const packI18n = { en, 'zh-TW': tw };
  const overlay = lang === 'en' ? en : lang === 'zh-TW' ? tw : null;
  if (!overlay) {
    zhSnap.locale = 'zh';
    zhSnap.i18n = packI18n;
    return zhSnap;
  }
  const localized = applyCaseLocale(zhSnap, overlay);
  localized.locale = lang;
  localized.i18n = Object.assign({}, packI18n, { zh: zhSnap });
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
    caseTitleTw: room.caseTitleTw || null,
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

function aiStatus() {
  if (isConfigured()) {
    return {
      mode: 'live',
      adapter: { provider: 'deepseek', model: modelName(), convaiReady: false },
    };
  }
  return {
    mode: 'mock',
    adapter: { provider: 'mock', convaiReady: false },
  };
}

app.get('/api/health', (_req, res) => {
  const status = aiStatus();
  res.json({ ok: true, rooms: rooms.size, time: nowIso(), mode: status.mode, adapter: status.adapter });
});

app.get('/api/cases', (req, res) => {
  const lang = requestedLang(req);
  const list = ['physics', 'chemistry']
    .map((id) => {
      const raw = loadCaseRaw(id);
      if (!raw) return null;
      const en = raw.i18n && raw.i18n.en;
      const tw = raw.i18n && raw.i18n['zh-TW'];
      const zh = { title: raw.title, subject: raw.subject, durationHint: raw.durationHint };
      const item = {
        id: raw.id,
        title: raw.title,
        subject: raw.subject,
        durationHint: raw.durationHint,
        i18n: {
          en: en ? { title: en.title, subject: en.subject, durationHint: en.durationHint } : null,
          'zh-TW': tw ? { title: tw.title, subject: tw.subject, durationHint: tw.durationHint } : null,
        },
      };
      const overlay = lang === 'en' ? en : lang === 'zh-TW' ? tw : null;
      if (overlay) {
        item.title = overlay.title;
        item.subject = overlay.subject;
        item.durationHint = overlay.durationHint;
        item.locale = lang;
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
    caseTitleTw: (raw.i18n && raw.i18n['zh-TW'] && raw.i18n['zh-TW'].title) || null,
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
    caseTitleTw: room.caseTitleTw,
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
    revealSummaryTw: revealedPack ? revealedPack.revealSummaryTw || null : null,
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
    revealSummaryTw: pack.revealSummaryTw || null,
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
    revealSummaryTw: revealedPack ? revealedPack.revealSummaryTw || null : null,
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
  const overlay = lang === 'en' || lang === 'zh-TW' ? studentOverlay(raw, lang) : null;
  let itemName = foundItem.name;
  let gainedOut = gained;
  if (overlay) {
    const mapHit = (raw.maps || []).find((m) => (m.items || []).some((i) => i.id === itemId));
    const translated = mapHit && overlay.maps && overlay.maps[mapHit.id] && overlay.maps[mapHit.id].items && overlay.maps[mapHit.id].items[itemId];
    if (translated) itemName = translated;
    gainedOut = gained.map((card) => {
      const t = overlay.evidence && overlay.evidence[card.id];
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

function suspectLocale(raw, langKey, suspectId) {
  const bag = raw.i18n && raw.i18n[langKey] && raw.i18n[langKey].suspects && raw.i18n[langKey].suspects[suspectId];
  return bag || null;
}

function matchAltList(list, question) {
  if (!question || !list || !list.length) return -1;
  const exact = list.findIndex((pair) => pair && pair.q === question);
  if (exact >= 0) return exact;
  const pref = list.findIndex((pair) => pair && pair.q && question.includes(pair.q.slice(0, 6)));
  return pref;
}

/** Simplified Chinese match keeps the original rules. English, then Traditional, are fallbacks. */
function matchMockQA(qa, enList, question, twList) {
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
    const twHit = matchAltList(twList, question);
    if (twHit >= 0) return twHit;
  }
  return 0;
}

function interviewPayload(raw, suspect) {
  const qa = suspect.mockQA || [];
  const enBag = suspectLocale(raw, 'en', suspect.id);
  const twBag = suspectLocale(raw, 'zh-TW', suspect.id);
  return {
    qa,
    enList: (enBag && enBag.mockQA) || [],
    twList: (twBag && twBag.mockQA) || [],
    enName: enBag || {},
    twName: twBag || {},
  };
}

function interviewView(lang, suspect, qa, enList, twList, enName, twName, idx, question) {
  const pair = idx >= 0 && qa[idx] ? qa[idx] : null;
  const enPair = idx >= 0 && enList[idx] ? enList[idx] : null;
  const twPair = idx >= 0 && twList[idx] ? twList[idx] : null;
  const questionZh = pair ? pair.q : question;
  const answerZh = pair ? pair.a : '……（对方没有更多可说的了）';
  const questionEn = enPair && enPair.q ? enPair.q : null;
  const answerEn = enPair && enPair.a ? enPair.a : null;
  const questionTw = twPair && twPair.q ? twPair.q : null;
  const answerTw = twPair && twPair.a ? twPair.a : null;
  const useEn = lang === 'en';
  const useTw = lang === 'zh-TW';
  let label = '演示问答（Mock）';
  let suspectName = suspect.name;
  let presets = qa.map((p) => p.q);
  let questionOut = questionZh;
  let answerOut = answerZh;
  if (useEn) {
    label = 'Demo Q&A (Mock)';
    if (enName.name) suspectName = enName.name;
    if (enList.length) presets = enList.map((p) => p.q);
    if (questionEn) questionOut = questionEn;
    if (answerEn) answerOut = answerEn;
  } else if (useTw) {
    label = '示範問答（Mock）';
    if (twName.name) suspectName = twName.name;
    if (twList.length) presets = twList.map((p) => p.q);
    if (questionTw) questionOut = questionTw;
    if (answerTw) answerOut = answerTw;
  }
  return {
    label,
    suspectName,
    presets,
    questionOut,
    answerOut,
    questionZh,
    answerZh,
    questionEn,
    answerEn,
    questionTw,
    answerTw,
    qaRows: qa.map((p, i) => ({
      q: p.q,
      a: p.a,
      qEn: enList[i] && enList[i].q,
      aEn: enList[i] && enList[i].a,
      qTw: twList[i] && twList[i].q,
      aTw: twList[i] && twList[i].a,
    })),
  };
}

function rememberTurn(g, suspectId, question, answer) {
  if (!question || !answer) return;
  if (!g.chatMemory) g.chatMemory = {};
  if (!g.chatMemory[suspectId]) g.chatMemory[suspectId] = [];
  g.chatMemory[suspectId].push({
    question: String(question).slice(0, 500),
    answer: String(answer).slice(0, 600),
  });
  const turns = g.chatMemory[suspectId];
  if (turns.length > 6) turns.splice(0, turns.length - 6);
}

function interviewBody({ lang, suspect, view, qa, enList, twList, mode, liveText, model, question, progress }) {
  const shared = {
    suspectId: suspect.id,
    suspectName: view.suspectName,
    suspectNameZh: suspect.name,
    presets: view.presets,
    presetsZh: qa.map((p) => p.q),
    presetsEn: enList.map((p) => p && p.q).filter(Boolean),
    presetsTw: twList.map((p) => p && p.q).filter(Boolean),
    qa: view.qaRows,
    progress,
  };
  if (mode === 'live') {
    return {
      mode: 'live',
      label: liveLabel(lang),
      labelEn: 'Live AI (DeepSeek)',
      labelTw: '真實 AI（DeepSeek）',
      ...shared,
      question,
      questionZh: question,
      questionEn: question,
      questionTw: question,
      answer: liveText,
      answerZh: liveText,
      answerEn: liveText,
      answerTw: liveText,
      adapter: { provider: 'deepseek', model: model || 'deepseek-chat', convaiReady: false },
    };
  }
  return {
    mode: 'mock',
    label: view.label,
    labelEn: 'Demo Q&A (Mock)',
    labelTw: '示範問答（Mock）',
    ...shared,
    question: view.questionOut,
    questionZh: view.questionZh,
    questionEn: view.questionEn,
    questionTw: view.questionTw,
    answer: view.answerOut,
    answerZh: view.answerZh,
    answerEn: view.answerEn,
    answerTw: view.answerTw,
    adapter: { provider: 'mock', convaiReady: false },
  };
}

/** Suspect interview. DeepSeek when DEEPSEEK_API_KEY is set; otherwise Mock preset Q&A. */
app.post('/api/student/:code/interview', async (req, res) => {
  const ctx = requireGroup(req, res);
  if (!ctx) return;
  try {
    const { room, g } = ctx;
    const raw = loadCaseRaw(room.caseId);
    const suspectId = req.body.suspectId;
    const question = String(req.body.question || '').trim().slice(0, 500);
    const suspect = (raw.suspects || []).find((s) => s.id === suspectId);
    if (!suspect) return res.status(404).json({ error: '人物不存在' });

    if (!g.interviewed.includes(suspectId)) g.interviewed.push(suspectId);

    const lang = requestedLang(req);
    const { qa, enList, twList, enName, twName } = interviewPayload(raw, suspect);
    const idx = matchMockQA(qa, enList, question, twList);
    const view = interviewView(lang, suspect, qa, enList, twList, enName, twName, idx, question);

    let mode = 'mock';
    let liveText = '';
    let model = '';
    if (question && isConfigured()) {
      try {
        const history = (g.chatMemory && g.chatMemory[suspectId]) || [];
        const live = await completeSuspectReply({
          lang,
          raw,
          suspect,
          question,
          history,
          qa,
          enList,
          twList,
          enName,
          twName,
          stage: room.stage,
        });
        if (live && live.text) {
          mode = 'live';
          liveText = live.text;
          model = live.model;
        }
      } catch (err) {
        const code = (err && err.code) || 'error';
        console.warn(`deepseek interview fallback: ${code}`);
      }
    }

    const progress = sanitizeProgress(g, room);
    const body = interviewBody({
      lang,
      suspect,
      view,
      qa,
      enList,
      twList,
      mode,
      liveText,
      model,
      question,
      progress,
    });
    const loggedQuestion = mode === 'live' ? question : view.questionZh || question;
    const loggedAnswer = mode === 'live' ? liveText : view.answerZh;
    rememberTurn(g, suspectId, question || loggedQuestion, loggedAnswer);
    g.logs.push({
      at: nowIso(),
      type: 'interview',
      suspectId,
      question: loggedQuestion,
      answer: loggedAnswer,
      mode,
    });
    res.json(body);
  } catch (err) {
    console.warn('interview handler error');
    if (!res.headersSent) res.status(500).json({ error: '问询失败' });
  }
});

app.get('/api/student/:code/interview/:suspectId/presets', (req, res) => {
  const ctx = requireGroup(req, res);
  if (!ctx) return;
  const { room } = ctx;
  const raw = loadCaseRaw(room.caseId);
  const suspect = (raw.suspects || []).find((s) => s.id === req.params.suspectId);
  if (!suspect) return res.status(404).json({ error: '人物不存在' });
  const lang = requestedLang(req);
  const { qa, enList, twList, enName, twName } = interviewPayload(raw, suspect);
  const view = interviewView(lang, suspect, qa, enList, twList, enName, twName, -1, '');
  res.json({
    mode: 'mock',
    label: view.label,
    labelEn: 'Demo Q&A (Mock)',
    labelTw: '示範問答（Mock）',
    presets: view.presets,
    presetsZh: qa.map((p) => p.q),
    presetsEn: enList.map((p) => p && p.q).filter(Boolean),
    presetsTw: twList.map((p) => p && p.q).filter(Boolean),
    qa: view.qaRows,
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
