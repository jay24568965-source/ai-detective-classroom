const LS_KEY = 'ai-detective-teacher';

function show(el, text, cls) {
  el.style.display = 'block';
  el.className = 'flash' + (cls ? ' ' + cls : '');
  el.textContent = text;
}

async function init() {
  const sel = document.getElementById('caseSelect');
  const cases = await API.cases();
  sel.innerHTML = cases.cases.map((c) => `<option value="${c.id}">${c.subject} · ${c.title}</option>`).join('');

  document.getElementById('btnCreate').onclick = async () => {
    try {
      const data = await API.createRoom(sel.value, document.getElementById('teacherName').value);
      localStorage.setItem(LS_KEY, JSON.stringify({ code: data.code, teacherToken: data.teacherToken, caseId: data.caseId }));
      enterConsole(data.code, data.teacherToken);
    } catch (e) {
      show(document.getElementById('setupMsg'), e.message, 'error');
    }
  };

  document.getElementById('btnRestore').onclick = () => {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return show(document.getElementById('setupMsg'), '没有可恢复的课堂', 'error');
    const s = JSON.parse(raw);
    enterConsole(s.code, s.teacherToken);
  };
}

let CODE = '';
let TOKEN = '';
let pollTimer = null;

async function enterConsole(code, token) {
  CODE = code;
  TOKEN = token;
  document.getElementById('setup').style.display = 'none';
  document.getElementById('console').style.display = 'grid';
  document.getElementById('roomCode').textContent = code;
  bindActions();
  await refresh();
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
    if (!confirm('确认统一揭晓？此后不能再开票（单轮）。')) return;
    try {
      const data = await API.teacherPost(CODE, TOKEN, '/reveal', {});
      const box = document.getElementById('revealBox');
      box.style.display = 'block';
      box.innerHTML = `<strong>${data.revealSummary.headline}</strong><ul>${data.revealSummary.points.map((p) => `<li>${p}</li>`).join('')}</ul>`;
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
    document.getElementById('caseTitle').textContent = `${s.caseTitle} · 第${s.stage}幕`;
    const vb = document.getElementById('voteBadge');
    vb.textContent = s.votingOpen ? '投票中' : '未开启/已截止';
    vb.className = 'badge ' + (s.votingOpen ? 'ok' : '');
    const rb = document.getElementById('revealBadge');
    rb.textContent = s.revealed ? '已揭晓' : '未揭晓';
    rb.className = 'badge ' + (s.revealed ? 'ok' : 'wait');

    const rows = s.groups
      .map(
        (g) => `<tr>
        <td>${g.id}</td><td>${g.label}</td>
        <td>${g.evidenceCount}</td><td>${g.interviewed}</td>
        <td>${g.voted ? '已提交' : '—'}</td>
        <td>${g.result || (s.revealed ? '未提交' : '—')}</td>
      </tr>`
      )
      .join('');
    document.getElementById('groupsTable').innerHTML = `
      <table>
        <thead><tr><th>ID</th><th>名称</th><th>证据</th><th>问询数</th><th>投票</th><th>结果</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="muted">尚无小组加入</td></tr>'}</tbody>
      </table>`;

    document.getElementById('hintsList').innerHTML = (s.hints || [])
      .slice()
      .reverse()
      .map((h) => `<li>${h.text} <span class="muted">(${h.at})</span></li>`)
      .join('');

    if (data.revealSummary) {
      const box = document.getElementById('revealBox');
      box.style.display = 'block';
      box.innerHTML = `<strong>${data.revealSummary.headline}</strong><ul>${data.revealSummary.points.map((p) => `<li>${p}</li>`).join('')}</ul>`;
    }
  } catch (e) {
    toast(e.message, 'error');
    if (e.status === 404 || e.status === 403) {
      clearInterval(pollTimer);
      document.getElementById('console').style.display = 'none';
      document.getElementById('setup').style.display = 'block';
    }
  }
}

init();
