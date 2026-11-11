const LS_KEY = 'ai-detective-teacher';

let CASES = [];
let CODE = '';
let TOKEN = '';
let pollTimer = null;
let lastReveal = null;
let lastRevealEn = null;
let lastRevealTw = null;
let activeTab = 'overview';

function show(el, text, cls) {
  el.style.display = 'block';
  el.className = 'flash' + (cls ? ' ' + cls : '');
  el.textContent = I18N.serverText(text);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
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

function syncHintCount() {
  const hintText = document.getElementById('hintText');
  const hintCount = document.getElementById('hintCount');
  if (!hintText || !hintCount) return;
  hintCount.textContent = `${hintText.value.length}/500`;
}

function setTab(name) {
  activeTab = name;
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    const on = btn.dataset.tab === name;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('[data-view]').forEach((view) => {
    view.hidden = view.dataset.view !== name;
  });
}

function placeLang(inConsole) {
  const sw = document.getElementById('langSwitch');
  if (!sw) return;
  if (inConsole) {
    const slot = document.getElementById('langSlot');
    if (slot && sw.parentElement !== slot) slot.appendChild(sw);
    sw.classList.add('is-inline');
  } else {
    const setup = document.getElementById('setup');
    if (setup) document.body.insertBefore(sw, setup);
    sw.classList.remove('is-inline');
  }
  document.body.classList.toggle('is-console', !!inConsole);
}

function formatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  const loc = I18N.getLang() === 'en' ? 'en' : I18N.getLang() === 'zh-TW' ? 'zh-Hant' : 'zh-CN';
  try {
    return new Intl.DateTimeFormat(loc, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch (_) {
    return String(iso || '');
  }
}

function groupsTableHtml(groups, revealed) {
  const rows = (groups || [])
    .map((g) => {
      const result = g.result ? I18N.resultLabel(g.result) : revealed ? I18N.t('teacher.notSubmitted') : '—';
      return `<tr>
        <td>${esc(g.id)}</td><td>${esc(g.label)}</td>
        <td>${esc(g.evidenceCount)}</td><td>${esc(g.interviewed)}</td>
        <td>${g.voted ? esc(I18N.t('teacher.submitted')) : '—'}</td>
        <td>${esc(result)}</td>
      </tr>`;
    })
    .join('');
  const body = rows || `<tr class="tc-empty"><td colspan="6"><div class="tc-empty-row"><span class="tc-empty-main">${esc(I18N.t('teacher.noGroups'))}</span><span class="tc-empty-help">${esc(I18N.t('teacher.noGroupsMore'))}</span></div></td></tr>`;
  return `<table class="tc-table">
    <thead><tr>
      <th>${esc(I18N.t('teacher.colId'))}</th>
      <th>${esc(I18N.t('teacher.colName'))}</th>
      <th>${esc(I18N.t('teacher.colEv'))}</th>
      <th>${esc(I18N.t('teacher.colIv'))}</th>
      <th>${esc(I18N.t('teacher.colVote'))}</th>
      <th>${esc(I18N.t('teacher.colResult'))}</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function renderHints(hints) {
  const items = (hints || []).slice().reverse();
  const recent = document.getElementById('hintsRecent');
  const list = document.getElementById('hintsList');
  recent.className = 'tc-recent-body' + (items.length ? ' is-filled' : '');
  if (!items.length) {
    recent.innerHTML = `<div class="tc-hint-empty"><h3>${esc(I18N.t('teacher.hintEmptyTitle'))}</h3><p>${esc(I18N.t('teacher.hintEmptyBody'))}</p></div>`;
    list.innerHTML = `<p class="tc-log-empty">${esc(I18N.t('teacher.noHints'))}</p>`;
    return;
  }
  const latest = items[0];
  recent.innerHTML = `<div class="tc-hint-latest"><p class="tc-hint-body">${esc(I18N.hintText(latest.text))}</p><p class="tc-hint-time">${esc(formatWhen(latest.at))}</p></div>`;
  list.innerHTML = items
    .map((h) => `<article class="tc-log-item"><p>${esc(I18N.hintText(h.text))}</p><time datetime="${esc(h.at)}">${esc(formatWhen(h.at))}</time></article>`)
    .join('');
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

  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.onclick = () => setTab(btn.dataset.tab);
  });
  document.getElementById('hintText').addEventListener('input', syncHintCount);
  setTab(activeTab);

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
  placeLang(true);
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
      syncHintCount();
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
    const title = roomTitle(s);
    document.getElementById('caseTitleName').textContent = title;
    document.getElementById('caseTitleAct').textContent = ` · ${actLabel}`;
    document.getElementById('caseName').textContent = title;
    const phase = s.paused ? I18N.t('teacher.paused') : I18N.t('teacher.investigating');
    document.getElementById('statusChip').textContent = `${actLabel} · ${phase}`;
    const vb = document.getElementById('voteBadge');
    vb.textContent = s.votingOpen ? I18N.t('teacher.voteOn') : I18N.t('teacher.voteOff');
    vb.className = 'tc-stat' + (s.votingOpen ? ' is-live' : '');
    const rb = document.getElementById('revealBadge');
    rb.textContent = s.revealed ? I18N.t('teacher.revealed') : I18N.t('teacher.notRevealed');
    rb.className = 'tc-stat' + (s.revealed ? ' is-live' : '');
    document.querySelectorAll('[data-stage]').forEach((btn) => {
      const on = Number(btn.dataset.stage) === Number(s.stage);
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const groupN = (s.groups || []).length;
    const countLabel = I18N.getLang() === 'en'
      ? (groupN === 1 ? '1 group' : `${groupN} groups`)
      : I18N.t('teacher.groupCount', { n: groupN });
    document.querySelectorAll('[data-group-count]').forEach((el) => {
      el.textContent = countLabel;
    });
    const table = groupsTableHtml(s.groups, s.revealed);
    document.getElementById('groupsTable').innerHTML = table;
    document.getElementById('groupsTableFull').innerHTML = table;
    renderHints(s.hints);
    paintReveal();
  } catch (e) {
    toast(e.message, 'error');
    if (e.status === 404 || e.status === 403) {
      clearInterval(pollTimer);
      document.getElementById('console').style.display = 'none';
      document.getElementById('setup').style.display = 'grid';
      placeLang(false);
    }
  }
}

init();
