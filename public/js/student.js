const LS_KEY = 'ai-detective-student';

let CODE = '';
let TOKEN = '';
let GROUP_ID = '';
let GROUP_LABEL = '';
let CASE_PACK = null;
let CASE = null;
let PROGRESS = null;
let STATE = null;
let engine = null;
let currentSuspect = null;
let posTimer = null;
let pollTimer = null;
let QA_CACHE = [];
let CHAT = [];
let LAST_REVEAL = null;
let LAST_ITEM = null;
let announcedStage = 0;
let pendingActCue = 0;

function $(id) { return document.getElementById(id); }
function openModal(id) {
  $(id).classList.add('open');
  if (engine) engine.setInputBlocked(true);
}
function closeModal(id) {
  $(id).classList.remove('open');
  const any = document.querySelector('.overlay.open');
  if (!any && engine) engine.setInputBlocked(false);
}

function showJoinMsg(t, cls) {
  const el = $('joinMsg');
  el.style.display = 'block';
  el.className = 'flash ' + (cls || '');
  el.textContent = I18N.serverText(t);
}

function evView(e) {
  const cat = ((CASE && CASE.evidence) || []).find((x) => x.id === e.id);
  if (!cat) return e;
  return Object.assign({}, e, { name: cat.name, source: cat.source, studentText: cat.studentText });
}

function itemNameById(id) {
  for (const m of (CASE && CASE.maps) || []) {
    const it = (m.items || []).find((i) => i.id === id);
    if (it) return it.name;
  }
  return '';
}

$('btnJoin').onclick = async () => {
  try {
    const body = {
      code: $('code').value.trim(),
      groupId: $('groupId').value.trim() || 'G1',
      groupLabel: $('groupLabel').value.trim() || I18N.t('student.defaultGroup'),
    };
    const data = await API.join(body);
    persist(data);
    boot(data);
  } catch (e) {
    showJoinMsg(e.message, 'error');
  }
};

$('btnRejoin').onclick = async () => {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return showJoinMsg(I18N.t('student.noToken'), 'error');
  try {
    const s = JSON.parse(raw);
    const data = await API.join({ code: s.code, groupToken: s.groupToken });
    persist(data);
    boot(data);
  } catch (e) {
    showJoinMsg(e.message, 'error');
  }
};

function persist(data) {
  localStorage.setItem(LS_KEY, JSON.stringify({ code: data.state.code, groupToken: data.groupToken, groupId: data.groupId }));
}

function useCasePack(pack) {
  CASE_PACK = pack;
  CASE = I18N.localizeCase(pack, I18N.getLang());
  if (engine) {
    engine.caseData = CASE;
    if (engine.map) {
      const m = (CASE.maps || []).find((mm) => mm.id === engine.map.id);
      if (m) engine.map = m;
    }
  }
}

function boot(data) {
  LAST_REVEAL = null;
  CHAT = [];
  QA_CACHE = [];
  LAST_ITEM = null;
  CODE = data.state.code;
  TOKEN = data.groupToken;
  GROUP_ID = data.groupId;
  GROUP_LABEL = data.label;
  PROGRESS = data.progress;
  STATE = data.state;
  useCasePack(data.case);

  $('join').style.display = 'none';
  $('gameUI').style.display = 'grid';
  applyGameChrome();
  renderBrief();
  openModal('modalBrief');
  $('btnBriefOk').onclick = () => {
    closeModal('modalBrief');
    if (pendingActCue >= 2) playActCue(pendingActCue);
  };

  engine = new GameEngine($('gameCanvas'), {
    onInteract: handleInteract,
    onPrompt: (t) => {
      const chip = $('promptChip');
      if (t) {
        chip.style.display = 'block';
        chip.textContent = t;
      } else chip.style.display = 'none';
    },
  });
  engine.loadCase(CASE, PROGRESS, STATE.stage);
  engine.start();

  bindUI();
  renderSide();
  updateTask();
  if (posTimer) clearInterval(posTimer);
  if (pollTimer) clearInterval(pollTimer);
  posTimer = setInterval(syncPos, 2000);
  pollTimer = setInterval(pollState, 2500);
  syncActCue(STATE.stage, true);
}

function applyGameChrome() {
  if (!CASE) return;
  $('caseName').textContent = CASE.title;
  $('roomBadge').textContent = I18N.t('student.room', { code: CODE });
  $('groupBadge').textContent = GROUP_LABEL + ' / ' + GROUP_ID;
  syncAiBadge();
  if (asking) setAskBusy(true);
  renderBrief();
  renderSide();
  updateTask();
}

function bindUI() {
  $('btnEvidence').onclick = () => { renderEvidenceModal(); openModal('modalEvidence'); };
  $('btnCloseEv').onclick = () => closeModal('modalEvidence');
  $('btnNotes').onclick = () => { $('notesArea').value = PROGRESS.notes || ''; openModal('modalNotes'); };
  $('btnCloseNotes').onclick = () => closeModal('modalNotes');
  $('btnSaveNotes').onclick = async () => {
    const data = await API.studentPost(CODE, TOKEN, '/notes', { notes: $('notesArea').value });
    PROGRESS = data.progress;
    closeModal('modalNotes');
  };
  $('btnCalc').onclick = () => { renderCalc(); openModal('modalCalc'); };
  $('btnCloseCalc').onclick = () => closeModal('modalCalc');
  $('btnSaveCalc').onclick = async () => {
    const fields = {};
    document.querySelectorAll('[data-calc]').forEach((el) => { fields[el.dataset.calc] = el.value; });
    const data = await API.studentPost(CODE, TOKEN, '/calc', { fields });
    PROGRESS = data.progress;
    closeModal('modalCalc');
  };
  $('btnCloseDialog').onclick = () => closeModal('modalDialog');
  $('btnCloseItem').onclick = () => closeModal('modalItem');
  $('btnCloseHost').onclick = () => closeModal('modalHost');
  $('btnCloseVoteModal').onclick = () => closeModal('modalVote');
  $('btnCloseResult').onclick = () => closeModal('modalResult');
  $('btnAsk').onclick = askCustom;
  $('customQ').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); askCustom(); }
  });
  $('btnSubmitVote').onclick = submitVote;
}

async function syncPos() {
  if (!engine) return;
  const p = engine.getPosition();
  try {
    await API.studentPost(CODE, TOKEN, '/position', p);
  } catch (_) {}
}

async function pollState() {
  try {
    const data = await API.studentState(CODE, TOKEN);
    const wasRevealed = STATE && STATE.revealed;
    useCasePack(data.case);
    PROGRESS = data.progress;
    STATE = data.state;
    engine.progress = PROGRESS;
    engine.stage = STATE.stage;
    engine.paused = STATE.paused;
    captureReveal(data);
    renderSide();
    updateTask();
    syncActCue(STATE.stage, false);
    if (STATE.revealed && !wasRevealed) {
      showReveal(data);
    }
  } catch (e) {
    console.warn(e);
  }
}

function stageDisplayName(stage) {
  const n = Number(stage) || 1;
  const row = ((CASE && CASE.stages) || []).find((s) => Number(s.id) === n);
  if (row && row.name) return row.name;
  return I18N.t('teacher.act', { n });
}

function playActCue(stage) {
  const brief = $('modalBrief');
  if ((brief && brief.classList.contains('open')) || document.hidden) {
    pendingActCue = Number(stage) || 0;
    return;
  }
  pendingActCue = 0;
  const root = $('actCue');
  if (!root) return;
  const kicker = $('actCueKicker');
  const name = $('actCueName');
  if (kicker) kicker.textContent = I18N.t('actCue.kicker');
  if (name) name.textContent = stageDisplayName(stage);
  root.hidden = false;
  root.classList.remove('is-on');
  void root.offsetWidth;
  root.classList.add('is-on');
  clearTimeout(playActCue.timer);
  playActCue.timer = setTimeout(() => {
    root.classList.remove('is-on');
    root.hidden = true;
  }, 3400);
}

function hideActCue() {
  pendingActCue = 0;
  const root = $('actCue');
  if (!root) return;
  clearTimeout(playActCue.timer);
  root.classList.remove('is-on');
  root.hidden = true;
}

/** Act 1 is the opening and stays quiet. Later acts get a center cue that fades. */
function syncActCue(stage, entering) {
  const n = Number(stage) || 1;
  if (n < 2) {
    const wasLater = announcedStage >= 2;
    announcedStage = n;
    if (!entering && wasLater) hideActCue();
    return;
  }
  if (entering) {
    announcedStage = n;
    playActCue(n);
    return;
  }
  if (n === announcedStage) return;
  announcedStage = n;
  playActCue(n);
}

function updateTask(override) {
  const bar = $('taskBar');
  if (!STATE || !PROGRESS) return;
  if (override) return (bar.textContent = I18N.t('student.taskGoal', { text: I18N.serverText(override) }));
  if (STATE.revealed) {
    bar.textContent = I18N.t('student.taskResult', { result: I18N.resultLabel(PROGRESS.result || '未提交') });
  } else if (PROGRESS.voteSubmitted) {
    bar.textContent = I18N.t('student.taskGoal', { text: I18N.t('student.taskWaiting') });
  } else if (STATE.votingOpen) {
    bar.textContent = I18N.t('student.taskGoal', { text: I18N.t('student.taskVote') });
  } else {
    bar.textContent = I18N.t('student.taskGoal', { text: I18N.t('student.taskExplore') });
  }
}

function renderSide() {
  if (!PROGRESS) return;
  $('evCount').textContent = (PROGRESS.evidence || []).length;
  $('evList').innerHTML = (PROGRESS.evidence || [])
    .map((e) => {
      const ev = evView(e);
      return `<div data-eid="${ev.id}"><strong>${ev.id}</strong> ${ev.name}</div>`;
    })
    .join('') || `<div class="muted">${I18N.t('evidence.none')}</div>`;
  $('evList').querySelectorAll('[data-eid]').forEach((el) => {
    el.onclick = () => {
      const found = (PROGRESS.evidence || []).find((x) => x.id === el.dataset.eid);
      if (!found) return;
      LAST_ITEM = { mode: 'card', id: found.id };
      renderItemModal();
      openModal('modalItem');
    };
  });
  $('ivList').innerHTML = (PROGRESS.interviewed || []).map((id) => {
    const s = (CASE.suspects || []).find((x) => x.id === id);
    return `<div>${s ? s.name : id}</div>`;
  }).join('') || `<div class="muted">${I18N.t('side.noneIv')}</div>`;
  $('hintList').innerHTML = (STATE.hints || []).slice(-5).reverse().map((h) => `<div>${I18N.hintText(h.text)}</div>`).join('')
    || `<div class="muted">${I18N.t('side.noneHint')}</div>`;
}

function renderEvidenceModal() {
  $('evidenceDetail').innerHTML = (PROGRESS.evidence || [])
    .map((e) => {
      const ev = evView(e);
      return `<div style="margin-bottom:0.75rem;padding-bottom:0.75rem;border-bottom:1px solid #334155;">
      <strong>${ev.id} · ${ev.name}</strong>
      <div>${ev.studentText}</div>
      <div class="muted">${I18N.t('evidence.source')}${ev.source}</div>
    </div>`;
    })
    .join('') || `<p class="muted">${I18N.t('evidence.empty')}</p>`;
}

function renderCalc(preserve) {
  const live = {};
  if (preserve) {
    document.querySelectorAll('[data-calc]').forEach((el) => { live[el.dataset.calc] = el.value; });
  }
  const tasks = CASE.calcTasks || [];
  $('calcBody').innerHTML = tasks
    .map((t) => {
      const fields = (t.fields || [])
        .map((f) => {
          const val = live[f.key] != null ? live[f.key] : ((PROGRESS.calc && PROGRESS.calc[f.key]) || '');
          if (f.type === 'text') {
            return `<label>${f.label}</label><textarea data-calc="${f.key}" rows="3">${val}</textarea>`;
          }
          return `<label>${f.label}</label><input data-calc="${f.key}" value="${val}" placeholder="${f.unit || ''}" />`;
        })
        .join('');
      return `<div style="margin-bottom:1rem;"><h3 style="margin:0 0 0.35rem;">${t.title}</h3><p class="muted">${t.prompt}</p>${fields}</div>`;
    })
    .join('');
}

function renderBrief() {
  if (!CASE) return;
  $('briefBg').textContent = CASE.background;
  $('briefList').innerHTML = (CASE.briefing || []).map((b) => `<li>${b}</li>`).join('');
}

function renderItemModal() {
  if (!LAST_ITEM) return;
  if (LAST_ITEM.mode === 'card') {
    const ev = evView({ id: LAST_ITEM.id });
    $('itemTitle').textContent = `${ev.id} ${ev.name || ''}`;
    $('itemBody').innerHTML = `<p>${ev.studentText || ''}</p><p class="muted">${I18N.t('evidence.source')}${ev.source || ''}</p>`;
    return;
  }
  $('itemTitle').textContent = itemNameById(LAST_ITEM.itemId) || I18N.t('item.title');
  let html = `<p>${I18N.t('item.viewed')}</p>`;
  if (LAST_ITEM.gained && LAST_ITEM.gained.length) {
    html += `<p class="success flash">${I18N.t('item.gained')}</p>` + LAST_ITEM.gained.map((id) => {
      const ev = evView({ id });
      return `<div><strong>${ev.id}</strong> ${ev.name || ''}<br/>${ev.studentText || ''}</div>`;
    }).join('');
  } else {
    html += `<p class="muted">${I18N.t('item.none')}</p>`;
  }
  $('itemBody').innerHTML = html;
}

async function handleInteract(near) {
  if (near.type === 'door') {
    const d = near.ref;
    engine.setMap(d.targetMap, d.targetX, d.targetY);
    syncPos();
    return;
  }
  if (near.type === 'item') {
    try {
      const data = await API.studentPost(CODE, TOKEN, '/investigate', { itemId: near.ref.id });
      PROGRESS = data.progress;
      engine.progress = PROGRESS;
      renderSide();
      if (data.action === 'openEvidence') {
        renderEvidenceModal();
        openModal('modalEvidence');
        return;
      }
      if (data.action === 'openCalc') {
        renderCalc();
        openModal('modalCalc');
        return;
      }
      LAST_ITEM = {
        mode: 'investigate',
        itemId: near.ref.id,
        gained: (data.gained || []).map((g) => g.id),
      };
      renderItemModal();
      openModal('modalItem');
    } catch (e) {
      alert(I18N.serverText(e.message));
    }
    return;
  }
  if (near.type === 'host') {
    renderHost();
    openModal('modalHost');
    return;
  }
  if (near.type === 'npc') {
    currentSuspect = near.suspectId;
    await openInterview(near.suspectId);
  }
}

function renderHost() {
  const host = CASE.hostNpc;
  let text = host.greeting;
  const btn = $('btnHostVote');
  btn.style.display = 'none';
  if (STATE.revealed) {
    text = I18N.t('host.revealed', { result: I18N.resultLabel(PROGRESS.result || '未提交') });
    btn.style.display = 'inline-block';
    btn.textContent = I18N.t('host.viewReveal');
    btn.onclick = async () => {
      const data = await API.studentState(CODE, TOKEN);
      showReveal(data);
    };
  } else if (PROGRESS.voteSubmitted) {
    text = I18N.t('host.waiting');
  } else if (STATE.votingOpen) {
    text = host.votePrompt;
    btn.style.display = 'inline-block';
    btn.textContent = I18N.t('host.enterVote');
    btn.onclick = () => { closeModal('modalHost'); openVoteModal(); };
  }
  $('hostText').textContent = text;
}

let aiLive = false;
let sawInterviewMode = false;
let asking = false;
let dialogGen = 0;

function syncAiBadge() {
  const text = aiLive ? I18N.t('badge.live') : I18N.t('badge.mock');
  ['aiBadge', 'dialogAiBadge'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('mock', !aiLive);
    el.classList.toggle('live', aiLive);
  });
}

function noteAiMode(data) {
  sawInterviewMode = true;
  if (window.AIAdapter && typeof AIAdapter.applyServer === 'function') {
    aiLive = AIAdapter.applyServer(data) === 'live';
  } else {
    aiLive = !!(data && data.mode === 'live' && data.adapter && data.adapter.provider === 'deepseek');
  }
  syncAiBadge();
}

function refreshAiAvailability() {
  fetch('/api/health')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data || sawInterviewMode) return;
      const live = !!(data.mode === 'live' && data.adapter && data.adapter.provider === 'deepseek');
      if (window.AIAdapter && typeof AIAdapter.applyServer === 'function') AIAdapter.applyServer(data);
      aiLive = live;
      syncAiBadge();
    })
    .catch(() => {});
}

function setAskBusy(busy) {
  asking = busy;
  const askBtn = $('btnAsk');
  const custom = $('customQ');
  const dialog = $('modalDialog');
  if (askBtn) {
    askBtn.disabled = busy;
    askBtn.classList.toggle('is-loading', busy);
    askBtn.textContent = '';
    if (busy) {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      spinner.setAttribute('aria-hidden', 'true');
      askBtn.appendChild(spinner);
    }
    askBtn.appendChild(document.createTextNode(busy ? I18N.t('dialog.thinking') : I18N.t('dialog.ask')));
  }
  if (custom) custom.disabled = busy;
  const presets = $('presetBtns');
  if (presets) presets.querySelectorAll('button').forEach((btn) => { btn.disabled = busy; });
  if (dialog) dialog.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function qaText(pair, which) {
  const lang = I18N.getLang();
  if (lang === 'en') {
    const enKey = which === 'q' ? 'qEn' : 'aEn';
    if (pair[enKey]) return pair[enKey];
  }
  if (lang === 'zh-TW') {
    const twKey = which === 'q' ? 'qTw' : 'aTw';
    if (pair[twKey]) return pair[twKey];
  }
  return pair[which === 'q' ? 'q' : 'a'] || '';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderChat() {
  const sus = (CASE.suspects || []).find((s) => s.id === currentSuspect);
  if (sus) $('dialogTitle').textContent = sus.name;
  let html = sus ? `<p class="muted">${escapeHtml(sus.card)}</p>` : '';
  html += CHAT.map((c) => `<div class="q">${I18N.t('dialog.q')}${escapeHtml(qaText(c, 'q'))}</div><div class="a">${I18N.t('dialog.a')}${escapeHtml(qaText(c, 'a'))}</div>`).join('');
  const log = $('chatLog');
  log.innerHTML = html;
  log.scrollTop = log.scrollHeight;
}

function renderPresets() {
  $('presetBtns').innerHTML = QA_CACHE
    .map((p, i) => `<button type="button" data-q="${i}">${escapeHtml(qaText(p, 'q'))}</button>`)
    .join('');
  const rows = QA_CACHE;
  $('presetBtns').querySelectorAll('button').forEach((btn) => {
    btn.disabled = asking;
    btn.onclick = () => ask(qaText(rows[Number(btn.dataset.q)], 'q'));
  });
}

async function openInterview(suspectId) {
  dialogGen += 1;
  currentSuspect = suspectId;
  CHAT = [];
  QA_CACHE = [];
  $('customQ').value = '';
  setAskBusy(false);
  syncAiBadge();
  renderChat();
  try {
    const presets = await AIAdapter.presets({ code: CODE, token: TOKEN, suspectId });
    QA_CACHE = presets.qa && presets.qa.length
      ? presets.qa
      : (presets.presetsEn && I18N.getLang() === 'en' ? presets.presetsEn : presets.presets || []).map((q) => ({ q, qEn: q }));
    renderPresets();
  } catch (e) {
    $('presetBtns').innerHTML = `<p class="muted">${I18N.serverText(e.message)}</p>`;
  }
  openModal('modalDialog');
}

async function ask(question) {
  if (!currentSuspect || !question || asking) return;
  const gen = dialogGen;
  const suspectAtSend = currentSuspect;
  if ($('customQ') && $('customQ').value.trim() === question) $('customQ').value = '';
  setAskBusy(true);
  try {
    const data = await AIAdapter.ask({ code: CODE, token: TOKEN, suspectId: suspectAtSend, question });
    if (data && data.progress) {
      PROGRESS = data.progress;
      renderSide();
    }
    noteAiMode(data);
    if (gen !== dialogGen || suspectAtSend !== currentSuspect) return;
    CHAT.push({
      q: data.questionZh || data.question,
      a: data.answerZh || data.answer,
      qEn: data.questionEn,
      aEn: data.answerEn,
      qTw: data.questionTw,
      aTw: data.answerTw,
    });
    renderChat();
  } catch (e) {
    if (gen === dialogGen) alert(I18N.serverText(e.message));
  } finally {
    if (gen === dialogGen) setAskBusy(false);
  }
}

function askCustom() {
  ask($('customQ').value.trim());
}

function fillVoteOptions() {
  const sel = $('voteSuspect');
  const current = sel.value;
  sel.innerHTML = (CASE.suspects || [])
    .map((s) => {
      const role = I18N.getLang() === 'en' ? `(${s.role})` : `（${s.role}）`;
      return `<option value="${s.id}">${s.name} ${role}</option>`;
    })
    .join('');
  if (current) sel.value = current;
}

function openVoteModal() {
  if (!STATE.votingOpen) return alert(I18N.t('vote.notOpen'));
  if (PROGRESS.voteSubmitted) return alert(I18N.t('vote.already'));
  $('voteQuestion').textContent = CASE.voteQuestion;
  fillVoteOptions();
  $('voteEvidence').value = '';
  $('voteRationale').value = '';
  $('voteSuspect').disabled = false;
  $('voteEvidence').disabled = false;
  $('voteRationale').disabled = false;
  $('btnSubmitVote').disabled = false;
  $('btnSubmitVote').textContent = I18N.t('vote.submit');
  openModal('modalVote');
}

async function submitVote() {
  if (!confirm(I18N.t('vote.confirm'))) return;
  try {
    const data = await API.studentPost(CODE, TOKEN, '/vote', {
      suspectId: $('voteSuspect').value,
      evidenceCited: $('voteEvidence').value,
      rationale: $('voteRationale').value,
    });
    PROGRESS = data.progress;
    const msg = I18N.serverText(data.message || '已提交，等待揭晓');
    $('voteQuestion').textContent = msg;
    $('voteSuspect').disabled = true;
    $('voteEvidence').disabled = true;
    $('voteRationale').disabled = true;
    $('btnSubmitVote').disabled = true;
    $('btnSubmitVote').textContent = I18N.t('vote.submitted');
    let banner = document.getElementById('voteSubmittedBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'voteSubmittedBanner';
      banner.className = 'flash success';
      banner.style.marginTop = '0.75rem';
      $('modalVote').querySelector('.modal').appendChild(banner);
    }
    banner.style.display = 'block';
    banner.textContent = I18N.t('vote.banner', { msg });
    updateTask(data.message || '已提交，等待揭晓');
  } catch (e) {
    alert(I18N.serverText(e.message));
  }
}

function captureReveal(data) {
  if (!data || (data.revealSummary == null && data.revealSummaryEn == null && data.revealSummaryTw == null)) return;
  const prev = LAST_REVEAL || {};
  LAST_REVEAL = {
    zh: data.revealSummaryZh || prev.zh || data.revealSummary,
    en: data.revealSummaryEn || prev.en || null,
    tw: data.revealSummaryTw || prev.tw || null,
  };
  if (data.revealSummaryZh) LAST_REVEAL.zh = data.revealSummaryZh;
}

function revealSummaryNow() {
  if (!LAST_REVEAL) return null;
  const lang = I18N.getLang();
  if (lang === 'en' && LAST_REVEAL.en) return LAST_REVEAL.en;
  if (lang === 'zh-TW' && LAST_REVEAL.tw) return LAST_REVEAL.tw;
  return LAST_REVEAL.zh;
}

function showReveal(data) {
  if (data) {
    PROGRESS = data.progress || PROGRESS;
    STATE = data.state || STATE;
    captureReveal(data);
  }
  const st = (PROGRESS && PROGRESS.result) || '未提交';
  const el = $('resultStatus');
  el.textContent = I18N.resultLabel(st);
  el.className = st === '合格' ? 'badge ok' : st === '不合格' ? 'badge bad' : 'badge wait';
  const sum = revealSummaryNow();
  $('resultSummary').innerHTML = sum
    ? `<h3>${sum.headline}</h3><ul>${(sum.points || []).map((p) => `<li>${p}</li>`).join('')}</ul>`
    : '';
  openModal('modalResult');
  updateTask();
}

function refreshOpenModals() {
  if ($('modalBrief').classList.contains('open')) renderBrief();
  if ($('modalDialog').classList.contains('open')) {
    renderChat();
    renderPresets();
  }
  if ($('modalItem').classList.contains('open')) renderItemModal();
  if ($('modalEvidence').classList.contains('open')) renderEvidenceModal();
  if ($('modalCalc').classList.contains('open')) renderCalc(true);
  if ($('modalHost').classList.contains('open')) renderHost();
  if ($('modalVote').classList.contains('open')) {
    if (PROGRESS && PROGRESS.voteSubmitted) {
      const msg = I18N.t('vote.already');
      $('voteQuestion').textContent = msg;
      $('btnSubmitVote').textContent = I18N.t('vote.submitted');
      const banner = document.getElementById('voteSubmittedBanner');
      if (banner) banner.textContent = I18N.t('vote.banner', { msg });
    } else {
      $('voteQuestion').textContent = CASE.voteQuestion;
      fillVoteOptions();
      $('btnSubmitVote').textContent = I18N.t('vote.submit');
    }
  }
  if ($('modalResult').classList.contains('open')) showReveal(null);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && pendingActCue >= 2) playActCue(pendingActCue);
});

I18N.onChange(() => {
  syncAiBadge();
  if (!CASE_PACK || !engine) return;
  CASE = I18N.localizeCase(CASE_PACK, I18N.getLang());
  engine.relocalize(CASE);
  applyGameChrome();
  refreshOpenModals();
  const cue = $('actCue');
  if (cue && !cue.hidden && announcedStage >= 2) {
    $('actCueKicker').textContent = I18N.t('actCue.kicker');
    $('actCueName').textContent = stageDisplayName(announcedStage);
  }
});

refreshAiAvailability();
