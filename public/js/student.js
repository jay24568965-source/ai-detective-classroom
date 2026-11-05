const LS_KEY = 'ai-detective-student';

let CODE = '';
let TOKEN = '';
let CASE = null;
let PROGRESS = null;
let STATE = null;
let engine = null;
let currentSuspect = null;
let posTimer = null;
let pollTimer = null;

function $(id) { return document.getElementById(id); }
function openModal(id) {
  $(id).classList.add('open');
  if (engine) engine.setInputBlocked(true);
}
function closeModal(id) {
  $(id).classList.remove('open');
  // only unblock if no other modal open
  const any = document.querySelector('.overlay.open');
  if (!any && engine) engine.setInputBlocked(false);
}

function showJoinMsg(t, cls) {
  const el = $('joinMsg');
  el.style.display = 'block';
  el.className = 'flash ' + (cls || '');
  el.textContent = t;
}

$('btnJoin').onclick = async () => {
  try {
    const body = {
      code: $('code').value.trim(),
      groupId: $('groupId').value.trim() || 'G1',
      groupLabel: $('groupLabel').value.trim() || '小组',
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
  if (!raw) return showJoinMsg('本机无保存令牌', 'error');
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

function boot(data) {
  CODE = data.state.code;
  TOKEN = data.groupToken;
  CASE = data.case;
  PROGRESS = data.progress;
  STATE = data.state;

  $('join').style.display = 'none';
  $('gameUI').style.display = 'grid';
  $('caseName').textContent = CASE.title;
  $('roomBadge').textContent = '课堂 ' + CODE;
  $('groupBadge').textContent = data.label + ' / ' + data.groupId;

  $('briefBg').textContent = CASE.background;
  $('briefList').innerHTML = (CASE.briefing || []).map((b) => `<li>${b}</li>`).join('');
  openModal('modalBrief');
  $('btnBriefOk').onclick = () => closeModal('modalBrief');

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
  bindTouch();
  renderSide();
  updateTask();
  posTimer = setInterval(syncPos, 2000);
  pollTimer = setInterval(pollState, 2500);
}

function bindTouch() {
  const pad = $('touchPad');
  pad.querySelectorAll('[data-dx]').forEach((btn) => {
    const set = (on) => {
      if (!engine) return;
      engine.touchDir.x = on ? Number(btn.dataset.dx) : 0;
      engine.touchDir.y = on ? Number(btn.dataset.dy) : 0;
    };
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); set(true); });
    btn.addEventListener('pointerup', () => set(false));
    btn.addEventListener('pointerleave', () => set(false));
  });
  $('btnTouchE').onclick = () => engine && engine.tryInteract();
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
  $('btnHostVote').onclick = () => {
    closeModal('modalHost');
    openVoteModal();
  };
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
    CASE = data.case;
    PROGRESS = data.progress;
    STATE = data.state;
    engine.progress = PROGRESS;
    engine.stage = STATE.stage;
    engine.paused = STATE.paused;
    renderSide();
    updateTask();
    if (PROGRESS.voteSubmitted && !STATE.revealed) {
      updateTask('已提交，等待揭晓');
    }
    if (STATE.revealed && !wasRevealed) {
      showReveal(data);
    } else if (STATE.revealed && PROGRESS.result) {
      // keep available via task bar
    }
  } catch (e) {
    console.warn(e);
  }
}

function updateTask(override) {
  const bar = $('taskBar');
  if (override) return (bar.textContent = '目标：' + override);
  if (STATE.revealed) {
    bar.textContent = `结果：${PROGRESS.result || '未提交'}（老师已揭晓）`;
  } else if (PROGRESS.voteSubmitted) {
    bar.textContent = '目标：已提交，等待揭晓';
  } else if (STATE.votingOpen) {
    bar.textContent = '目标：返回主持人处，提交唯一一次最终投票';
  } else {
    bar.textContent = '目标：探索场景、收集证据、问询人物、完成科学分析';
  }
}

function renderSide() {
  $('evCount').textContent = (PROGRESS.evidence || []).length;
  $('evList').innerHTML = (PROGRESS.evidence || [])
    .map((e) => `<div data-eid="${e.id}"><strong>${e.id}</strong> ${e.name}</div>`)
    .join('') || '<div class="muted">尚无证据</div>';
  $('evList').querySelectorAll('[data-eid]').forEach((el) => {
    el.onclick = () => {
      const ev = PROGRESS.evidence.find((x) => x.id === el.dataset.eid);
      if (!ev) return;
      $('itemTitle').textContent = `${ev.id} ${ev.name}`;
      $('itemBody').innerHTML = `<p>${ev.studentText}</p><p class="muted">来源：${ev.source}</p>`;
      openModal('modalItem');
    };
  });
  $('ivList').innerHTML = (PROGRESS.interviewed || []).map((id) => {
    const s = (CASE.suspects || []).find((x) => x.id === id);
    return `<div>${s ? s.name : id}</div>`;
  }).join('') || '<div class="muted">尚未问询</div>';
  $('hintList').innerHTML = (STATE.hints || []).slice(-5).reverse().map((h) => `<div>${h.text}</div>`).join('') || '<div class="muted">暂无</div>';
}

function renderEvidenceModal() {
  $('evidenceDetail').innerHTML = (PROGRESS.evidence || [])
    .map((e) => `<div style="margin-bottom:0.75rem;padding-bottom:0.75rem;border-bottom:1px solid #334155;">
      <strong>${e.id} · ${e.name}</strong>
      <div>${e.studentText}</div>
      <div class="muted">来源：${e.source}</div>
    </div>`)
    .join('') || '<p class="muted">尚无证据。靠近发光物品按 E 调查。</p>';
}

function renderCalc() {
  const tasks = CASE.calcTasks || [];
  $('calcBody').innerHTML = tasks
    .map((t) => {
      const fields = (t.fields || [])
        .map((f) => {
          const val = (PROGRESS.calc && PROGRESS.calc[f.key]) || '';
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
      $('itemTitle').textContent = data.itemName;
      let html = `<p>已查看该物品。</p>`;
      if (data.gained && data.gained.length) {
        html += `<p class="success flash">取得证据：</p>` + data.gained.map((g) => `<div><strong>${g.id}</strong> ${g.name}<br/>${g.studentText}</div>`).join('');
      } else {
        html += `<p class="muted">未取得新证据（可能已收集，或尚未解锁该幕）。</p>`;
      }
      $('itemBody').innerHTML = html;
      openModal('modalItem');
    } catch (e) {
      alert(e.message);
    }
    return;
  }
  if (near.type === 'host') {
    const host = CASE.hostNpc;
    let text = host.greeting;
    $('btnHostVote').style.display = 'none';
    if (STATE.revealed) {
      text = `结果已揭晓。本组状态：${PROGRESS.result || '未提交'}。可查看复盘要点。`;
      $('btnHostVote').style.display = 'inline-block';
      $('btnHostVote').textContent = '查看揭晓';
      $('btnHostVote').onclick = async () => {
        const data = await API.studentState(CODE, TOKEN);
        showReveal(data);
      };
    } else if (PROGRESS.voteSubmitted) {
      text = '已提交，等待揭晓';
    } else if (STATE.votingOpen) {
      text = host.votePrompt;
      $('btnHostVote').style.display = 'inline-block';
      $('btnHostVote').textContent = '进入最终投票';
      $('btnHostVote').onclick = () => { closeModal('modalHost'); openVoteModal(); };
    }
    $('hostText').textContent = text;
    openModal('modalHost');
    return;
  }
  if (near.type === 'npc') {
    currentSuspect = near.suspectId;
    await openInterview(near.suspectId);
  }
}

async function openInterview(suspectId) {
  const sus = (CASE.suspects || []).find((s) => s.id === suspectId);
  $('dialogTitle').textContent = sus ? sus.name : suspectId;
  $('chatLog').innerHTML = sus ? `<p class="muted">${sus.card}</p>` : '';
  $('customQ').value = '';
  try {
    const presets = await AIAdapter.presets({ code: CODE, token: TOKEN, suspectId });
    $('aiBadge').textContent = presets.label || '演示问答（Mock）';
    $('presetBtns').innerHTML = (presets.presets || [])
      .map((q, i) => `<button data-q="${i}">${q}</button>`)
      .join('');
    const qs = presets.presets || [];
    $('presetBtns').querySelectorAll('button').forEach((btn) => {
      btn.onclick = () => ask(qs[Number(btn.dataset.q)]);
    });
  } catch (e) {
    $('presetBtns').innerHTML = `<p class="muted">${e.message}</p>`;
  }
  openModal('modalDialog');
}

async function ask(question) {
  if (!currentSuspect || !question) return;
  try {
    const data = await AIAdapter.ask({ code: CODE, token: TOKEN, suspectId: currentSuspect, question });
    PROGRESS = data.progress;
    renderSide();
    const log = $('chatLog');
    log.innerHTML += `<div class="q">问：${data.question}</div><div class="a">答：${data.answer}</div>`;
    log.scrollTop = log.scrollHeight;
  } catch (e) {
    alert(e.message);
  }
}

function askCustom() {
  ask($('customQ').value.trim());
}

function openVoteModal() {
  if (!STATE.votingOpen) return alert('老师尚未开启投票');
  if (PROGRESS.voteSubmitted) return alert('已提交，等待揭晓');
  $('voteQuestion').textContent = CASE.voteQuestion;
  $('voteSuspect').innerHTML = (CASE.suspects || [])
    .map((s) => `<option value="${s.id}">${s.name}（${s.role}）</option>`)
    .join('');
  $('voteEvidence').value = '';
  $('voteRationale').value = '';
  openModal('modalVote');
}

async function submitVote() {
  if (!confirm('确认提交？提交后不可修改。')) return;
  try {
    const data = await API.studentPost(CODE, TOKEN, '/vote', {
      suspectId: $('voteSuspect').value,
      evidenceCited: $('voteEvidence').value,
      rationale: $('voteRationale').value,
    });
    PROGRESS = data.progress;
    // Keep vote modal open so the group can screenshot / discuss; only disable further edits.
    const msg = data.message || '已提交，等待揭晓';
    $('voteQuestion').textContent = msg;
    $('voteSuspect').disabled = true;
    $('voteEvidence').disabled = true;
    $('voteRationale').disabled = true;
    $('btnSubmitVote').disabled = true;
    $('btnSubmitVote').textContent = '已提交';
    let banner = document.getElementById('voteSubmittedBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'voteSubmittedBanner';
      banner.className = 'flash success';
      banner.style.marginTop = '0.75rem';
      $('modalVote').querySelector('.modal').appendChild(banner);
    }
    banner.style.display = 'block';
    banner.textContent = msg + '（窗口不会自动关闭，可点「取消」自行关掉）';
    updateTask(msg);
  } catch (e) {
    alert(e.message);
  }
}

function showReveal(data) {
  PROGRESS = data.progress || PROGRESS;
  STATE = data.state || STATE;
  const st = PROGRESS.result || '未提交';
  const el = $('resultStatus');
  el.textContent = st;
  el.className = st === '合格' ? 'badge ok' : st === '不合格' ? 'badge bad' : 'badge wait';
  const sum = data.revealSummary;
  $('resultSummary').innerHTML = sum
    ? `<h3>${sum.headline}</h3><ul>${sum.points.map((p) => `<li>${p}</li>`).join('')}</ul>`
    : '';
  openModal('modalResult');
  updateTask();
}
