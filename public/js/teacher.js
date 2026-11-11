const LS_KEY = 'ai-detective-teacher';

let CASES = [];
let CODE = '';
let TOKEN = '';
let pollTimer = null;
let lastReveal = null;
let lastRevealEn = null;
let lastRevealTw = null;

function show(el, text, cls) {
  el.style.display = 'block';
  el.className = 'flash' + (cls ? ' ' + cls : '');
  el.textContent = I18N.serverText(text);
}

function caseLabel(c) {
  const lang = I18N.getLang();
  const bag = lang !== 'zh' && c.i18n && c.i18n[lang];
  if (bag && bag.title) return `${bag.subject || c.subject} · ${bag.title}`;
  const zh = (c.locale && c.locale !== 'zh' && c.i18n && c.i18n.zh) || c;
  return `${zh.subject} · ${zh.title}`;
}

function renderCaseOptions() {
  const sel = document.getElementById('caseSelect');
  const current = sel.value;
  sel.innerHTML = CASES.map((c) => `<option value="${c.id}">${caseLabel(c)}</option>`).join('');
  if (current && CASES.some((c) => c.id === current)) sel.value = current;
}

function roomTitle(s) {
  const lang = I18N.getLang();
  if (lang === 'en' && s.caseTitleEn) return s.caseTitleEn;
  if (lang === 'zh-TW' && s.caseTitleTw) return s.caseTitleTw;
  return s.caseTitle;
}

function paintReveal() {
  const box = document.getElementById('revealBox');
  const lang = I18N.getLang();
  const sum = lang === 'en' && lastRevealEn ? lastRevealEn : lang === 'zh-TW' && lastRevealTw ? lastRevealTw : lastReveal;
  if (!sum) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  box.innerHTML = `<strong>${sum.headline}</strong><ul>${(sum.points || []).map((p) => `<li>${p}</li>`).join('')}</ul>`;
}

function rememberReveal(data) {
  if (!data) return;
  if (data.revealSummary == null && data.revealSummaryEn == null && data.revealSummaryTw == null) return;
  if (data.revealSummaryZh) lastReveal = data.revealSummaryZh;
  else if (data.revealSummary && I18N.getLang() === 'zh') lastReveal = data.revealSummary;
  else if (!lastReveal && data.revealSummary) lastReveal = data.revealSummary;
  if (data.revealSummaryEn) lastRevealEn = data.revealSummaryEn;
  if (data.revealSummaryTw) lastRevealTw = data.revealSummaryTw;
}

async function init() {
  const nameInput = document.getElementById('teacherName');
  nameInput.addEventListener('input', () => {
    nameInput.dataset.edited = '1';
  });
  const syncName = () => {
    if (nameInput.dataset.edited === '1') return;
    const langNow = I18N.getLang();
    nameInput.value = langNow === 'en' ? 'Teacher' : langNow === 'zh-TW' ? '教師' : '教师';
  };
  syncName();

  const cases = await API.cases();
  CASES = cases.cases || [];
  renderCaseOptions();

  document.getElementById('btnCreate').onclick = async () => {
    try {
      const data = await API.createRoom(document.getElementById('caseSelect').value, nameInput.value);
      localStorage.setItem(LS_KEY, JSON.stringify({ code: data.code, teacherToken: data.teacherToken, caseId: data.caseId }));
      enterConsole(data.code, data.teacherToken);
    } catch (e) {
      show(document.getElementById('setupMsg'), e.message, 'error');
    }
  };

  document.getElementById('btnRestore').onclick = () => {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return show(document.getElementById('setupMsg'), I18N.t('teacher.noRoom'), 'error');
    const s = JSON.parse(raw);
    enterConsole(s.code, s.teacherToken);
  };

  I18N.onChange(() => {
    syncName();
    renderCaseOptions();
    paintReveal();
    if (CODE && document.getElementById('console').style.display !== 'none') refresh();
  });
}

async function enterConsole(code, token) {
  CODE = code;
  TOKEN = token;
  lastReveal = null;
  lastRevealEn = null;
  lastRevealTw = null;
  document.getElementById('setup').style.display = 'none';
  document.getElementById('console').style.display = 'grid';
  document.getElementById('roomCode').textContent = code;
  bindActions();
  await refresh();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refresh, 2500);
}

function bindActions() {
  document.querySelectorAll('[data-stage]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await API.teacherPost(CODE, TOKEN, '/stage', { stage: Number(btn.dataset.stage) });
        await refresh();
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });
  document.getElementById('btnHint').onclick = async () => {
    try {
      await API.teacherPost(CODE, TOKEN, '/hint', { text: document.getElementById('hintText').value });
      document.getElementById('hintText').value = '';
      await refresh();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  document.getElementById('btnOpenVote').onclick = async () => {
    try {
      await API.teacherPost(CODE, TOKEN, '/vote/open', {});
      await refresh();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  document.getElementById('btnCloseVote').onclick = async () => {
    try {
      await API.teacherPost(CODE, TOKEN, '/vote/close', {});
      await refresh();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  document.getElementById('btnReveal').onclick = async () => {
    if (!confirm(I18N.t('teacher.confirmReveal'))) return;
    try {
      const data = await API.teacherPost(CODE, TOKEN, '/reveal', {});
      rememberReveal(data);
      paintReveal();
      await refresh();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  document.getElementById('btnPause').onclick = async () => {
    const st = await API.teacherState(CODE, TOKEN);
    await API.teacherPost(CODE, TOKEN, '/pause', { paused: !st.state.paused });
    await refresh();
  };
  document.getElementById('btnExportJson').onclick = () => API.exportLog(CODE, TOKEN, 'json').catch((e) => toast(e.message, 'error'));
  document.getElementById('btnExportCsv').onclick = () => API.exportLog(CODE, TOKEN, 'csv').catch((e) => toast(e.message, 'error'));
}

function toast(text, cls) {
  show(document.getElementById('msg'), text, cls);
}

async function refresh() {
  try {
    const data = await API.teacherState(CODE, TOKEN);
    const s = data.state;
    rememberReveal(data);
    const actKey = { 1: 'teacher.act1', 2: 'teacher.act2', 3: 'teacher.act3' }[s.stage];
    const actLabel = actKey ? I18N.t(actKey) : I18N.t('teacher.act', { n: s.stage });
    document.getElementById('caseTitle').textContent = `${roomTitle(s)} · ${actLabel}`;
    const vb = document.getElementById('voteBadge');
    vb.textContent = s.votingOpen ? I18N.t('teacher.voteOn') : I18N.t('teacher.voteOff');
    vb.className = 'badge ' + (s.votingOpen ? 'ok' : '');
    const rb = document.getElementById('revealBadge');
    rb.textContent = s.revealed ? I18N.t('teacher.revealed') : I18N.t('teacher.notRevealed');
    rb.className = 'badge ' + (s.revealed ? 'ok' : 'wait');

    const rows = s.groups
      .map((g) => {
        const result = g.result ? I18N.resultLabel(g.result) : s.revealed ? I18N.t('teacher.notSubmitted') : '—';
        return `<tr>
        <td>${g.id}</td><td>${g.label}</td>
        <td>${g.evidenceCount}</td><td>${g.interviewed}</td>
        <td>${g.voted ? I18N.t('teacher.submitted') : '—'}</td>
        <td>${result}</td>
      </tr>`;
      })
      .join('');
    document.getElementById('groupsTable').innerHTML = `
      <table>
        <thead><tr>
          <th>${I18N.t('teacher.colId')}</th>
          <th>${I18N.t('teacher.colName')}</th>
          <th>${I18N.t('teacher.colEv')}</th>
          <th>${I18N.t('teacher.colIv')}</th>
          <th>${I18N.t('teacher.colVote')}</th>
          <th>${I18N.t('teacher.colResult')}</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="muted">${I18N.t('teacher.noGroups')}</td></tr>`}</tbody>
      </table>`;

    document.getElementById('hintsList').innerHTML = (s.hints || [])
      .slice()
      .reverse()
      .map((h) => `<li>${I18N.hintText(h.text)} <span class="muted">(${h.at})</span></li>`)
      .join('');

    paintReveal();
  } catch (e) {
    toast(e.message, 'error');
    if (e.status === 404 || e.status === 403) {
      clearInterval(pollTimer);
      document.getElementById('console').style.display = 'none';
      document.getElementById('setup').style.display = '';
    }
  }
}

init();
