/**
 * UI language: zh (default) or en.
 * Preference is stored in localStorage under ai-detective-lang and shared
 * by the home, teacher, and student pages on this device.
 */
(function () {
  const KEY = 'ai-detective-lang';

  const dict = {
    zh: {
      'home.title': 'AI侦探课堂',
      'home.subtitle': 'INT6066 小组项目 MVP · 单轮投票 · Mock 问询 · 物理/化学双案件',
      'home.teacherTitle': '教师控制台',
      'home.teacherBody': '创建课堂、选择案件、开启/关闭投票、揭晓结果、导出学习记录。',
      'home.teacherBtn': '进入教师端',
      'home.studentTitle': '学生 / 小组',
      'home.studentBody': '用课堂码与小组 ID 加入，共同操控侦探角色完成调查与最终指认。',
      'home.studentBtn': '进入学生端',
      'home.footer': '演示问答（Mock）无需 API Key · 教师答案保存在服务端 · 不提供多轮投票/排除/补发线索',
      'teacher.docTitle': '教师控制台 · AI侦探课堂',
      'teacher.heading': '教师控制台',
      'teacher.lead': '创建新课堂或恢复已有课堂（本机 localStorage）。',
      'teacher.name': '显示名称',
      'teacher.case': '选择案件',
      'teacher.create': '创建课堂',
      'teacher.restore': '恢复上次',
      'teacher.home': '返回首页',
      'teacher.room': '课堂',
      'teacher.voteLabel': '投票：',
      'teacher.revealLabel': '揭晓：',
      'teacher.stage': '调查阶段',
      'teacher.act1': '第一幕',
      'teacher.act2': '第二幕',
      'teacher.act3': '第三幕',
      'teacher.hintLabel': '发布提示',
      'teacher.hintPh': '教学提示（不关联投票结果）',
      'teacher.sendHint': '发送提示',
      'teacher.openVote': '开启最终投票',
      'teacher.closeVote': '关闭投票',
      'teacher.reveal': '统一揭晓',
      'teacher.pause': '暂停/继续调查',
      'teacher.exportJson': '导出 JSON 日志',
      'teacher.exportCsv': '导出 CSV',
      'teacher.tokenNote': '教师令牌已保存在本机。刷新可恢复。',
      'teacher.groups': '小组状态',
      'teacher.hints': '最近提示',
      'teacher.noRoom': '没有可恢复的课堂',
      'teacher.confirmReveal': '确认统一揭晓？此后不能再开票（单轮）。',
      'teacher.voteOn': '投票中',
      'teacher.voteOff': '未开启/已截止',
      'teacher.revealed': '已揭晓',
      'teacher.notRevealed': '未揭晓',
      'teacher.submitted': '已提交',
      'teacher.notSubmitted': '未提交',
      'teacher.colId': 'ID',
      'teacher.colName': '名称',
      'teacher.colEv': '证据',
      'teacher.colIv': '问询数',
      'teacher.colVote': '投票',
      'teacher.colResult': '结果',
      'teacher.noGroups': '尚无小组加入',
      'teacher.act': '第{n}幕',
      'student.docTitle': '学生端 · AI侦探课堂',
      'student.heading': '加入课堂',
      'student.code': '课堂码',
      'student.codePh': '例如 A1B2C3',
      'student.groupId': '小组 ID（不可猜测占用；首次自定，如 G1）',
      'student.groupLabel': '小组显示名',
      'student.groupPh': '第一组',
      'student.join': '加入',
      'student.rejoin': '用本机令牌重连',
      'student.home': '首页',
      'student.noToken': '本机无保存令牌',
      'student.defaultGroup': '小组',
      'student.room': '课堂 {code}',
      'student.evidenceBtn': '证据板',
      'student.notesBtn': '笔记',
      'student.calcBtn': '科学分析',
      'student.evidenceTitle': '证据板',
      'student.interviewed': '已问询',
      'student.hints': '教师提示',
      'student.help': 'WASD / 方向键移动 · E 互动 · 打开面板时停止移动',
      'student.taskExplore': '探索场景、收集证据、问询人物、完成科学分析',
      'student.taskVote': '返回主持人处，提交唯一一次最终投票',
      'student.taskWaiting': '已提交，等待揭晓',
      'student.taskResult': '结果：{result}（老师已揭晓）',
      'student.taskGoal': '目标：{text}',
      'brief.title': '案件简报',
      'brief.start': '开始调查',
      'dialog.title': '交谈',
      'dialog.orType': '或输入问题（将匹配预设）',
      'dialog.ask': '提问',
      'dialog.close': '关闭',
      'dialog.q': '问：',
      'dialog.a': '答：',
      'item.title': '调查',
      'item.close': '关闭',
      'item.viewed': '已查看该物品。',
      'item.gained': '取得证据：',
      'item.none': '未取得新证据（可能已收集，或尚未解锁该幕）。',
      'evidence.title': '证据板',
      'evidence.close': '关闭',
      'evidence.empty': '尚无证据。靠近发光物品按 E 调查。',
      'evidence.source': '来源：',
      'evidence.none': '尚无证据',
      'notes.title': '推理笔记',
      'notes.ph': '记录证据链与讨论要点…',
      'notes.save': '保存',
      'notes.close': '关闭',
      'calc.title': '科学分析 / 计算草稿',
      'calc.save': '保存草稿',
      'calc.close': '关闭',
      'vote.title': '最终投票（仅一次）',
      'vote.who': '选择人物',
      'vote.evidence': '引用的证据编号',
      'vote.evidencePh': '例如 E01,E04,E08 或计算结论',
      'vote.why': '科学分析依据',
      'vote.whyPh': '说明为何该陈述/行为与证据矛盾或构成直接致因…',
      'vote.submit': '确认提交（不可改）',
      'vote.cancel': '取消',
      'vote.note': '提交前请小组检查。确认后锁定，不得改选。',
      'vote.confirm': '确认提交？提交后不可修改。',
      'vote.notOpen': '老师尚未开启投票',
      'vote.already': '已提交，等待揭晓',
      'vote.submitted': '已提交',
      'vote.banner': '{msg}（窗口不会自动关闭，可点「取消」自行关掉）',
      'result.title': '揭晓结果',
      'result.close': '关闭',
      'result.pass': '合格',
      'result.fail': '不合格',
      'result.missing': '未提交',
      'host.title': '调查主持人',
      'host.close': '关闭',
      'host.enterVote': '进入最终投票',
      'host.viewReveal': '查看揭晓',
      'host.revealed': '结果已揭晓。本组状态：{result}。可查看复盘要点。',
      'host.waiting': '已提交，等待揭晓',
      'side.noneIv': '尚未问询',
      'side.noneHint': '暂无',
      'badge.mock': '演示问答（Mock）',
      'prompt.investigate': '按 E 调查：{name}',
      'prompt.talk': '按 E 交谈：{name}',
      'prompt.door': '按 E {label}',
      'prompt.enter': '进入',
      'scene.door': '门',
      'scene.player': '马里奥',
      'scene.busStop': '公交站',
      'scene.hqBoard': '证据墙 / 物理工作台',
      'hint.stage': '教师将调查推进到第 {n} 幕',
      'api.fail': '请求失败',
      'lang.aria': '语言',
    },
    en: {
      'home.title': 'AI Detective Classroom',
      'home.subtitle': 'INT6066 group project MVP · single vote · mock Q&A · physics and chemistry cases',
      'home.teacherTitle': 'Teacher console',
      'home.teacherBody': 'Create a room, choose a case, open or close voting, reveal results, and export the learning log.',
      'home.teacherBtn': 'Open teacher page',
      'home.studentTitle': 'Students / groups',
      'home.studentBody': 'Join with a room code and group ID, share one detective, and finish the investigation and final accusation.',
      'home.studentBtn': 'Open student page',
      'home.footer': 'Demo Q&A (Mock) needs no API key · the answer key stays on the server · no extra rounds, eliminations, or bonus clues',
      'teacher.docTitle': 'Teacher console · AI Detective Classroom',
      'teacher.heading': 'Teacher console',
      'teacher.lead': 'Create a room or restore the last one (saved in localStorage on this device).',
      'teacher.name': 'Display name',
      'teacher.case': 'Case',
      'teacher.create': 'Create room',
      'teacher.restore': 'Restore last',
      'teacher.home': 'Home',
      'teacher.room': 'Room',
      'teacher.voteLabel': 'Vote:',
      'teacher.revealLabel': 'Reveal:',
      'teacher.stage': 'Investigation stage',
      'teacher.act1': 'Act I',
      'teacher.act2': 'Act II',
      'teacher.act3': 'Act III',
      'teacher.hintLabel': 'Post a hint',
      'teacher.hintPh': 'Teaching hint (not tied to the vote)',
      'teacher.sendHint': 'Send hint',
      'teacher.openVote': 'Open final vote',
      'teacher.closeVote': 'Close voting',
      'teacher.reveal': 'Reveal to everyone',
      'teacher.pause': 'Pause / resume investigation',
      'teacher.exportJson': 'Export JSON log',
      'teacher.exportCsv': 'Export CSV',
      'teacher.tokenNote': 'The teacher token is saved on this device. Refresh to restore.',
      'teacher.groups': 'Group status',
      'teacher.hints': 'Recent hints',
      'teacher.noRoom': 'No room to restore',
      'teacher.confirmReveal': 'Reveal to every group? Voting cannot be reopened (single round).',
      'teacher.voteOn': 'Voting',
      'teacher.voteOff': 'Closed',
      'teacher.revealed': 'Revealed',
      'teacher.notRevealed': 'Not yet',
      'teacher.submitted': 'Submitted',
      'teacher.notSubmitted': 'Not submitted',
      'teacher.colId': 'ID',
      'teacher.colName': 'Name',
      'teacher.colEv': 'Evidence',
      'teacher.colIv': 'Interviews',
      'teacher.colVote': 'Vote',
      'teacher.colResult': 'Result',
      'teacher.noGroups': 'No group has joined yet',
      'teacher.act': 'Act {n}',
      'student.docTitle': 'Student · AI Detective Classroom',
      'student.heading': 'Join a room',
      'student.code': 'Room code',
      'student.codePh': 'e.g. A1B2C3',
      'student.groupId': 'Group ID (not guessable; pick one the first time, e.g. G1)',
      'student.groupLabel': 'Group display name',
      'student.groupPh': 'Group 1',
      'student.join': 'Join',
      'student.rejoin': 'Reconnect with saved token',
      'student.home': 'Home',
      'student.noToken': 'No token saved on this device',
      'student.defaultGroup': 'Group',
      'student.room': 'Room {code}',
      'student.evidenceBtn': 'Evidence',
      'student.notesBtn': 'Notes',
      'student.calcBtn': 'Analysis',
      'student.evidenceTitle': 'Evidence',
      'student.interviewed': 'Interviewed',
      'student.hints': 'Teacher hints',
      'student.help': 'WASD / arrow keys to move · E to interact · opening a panel stops movement',
      'student.taskExplore': 'Explore, collect evidence, question people, and finish the science analysis',
      'student.taskVote': 'Return to the host and submit the one final vote',
      'student.taskWaiting': 'Submitted. Waiting for the reveal.',
      'student.taskResult': 'Result: {result} (the teacher has revealed)',
      'student.taskGoal': 'Goal: {text}',
      'brief.title': 'Case briefing',
      'brief.start': 'Start investigating',
      'dialog.title': 'Talk',
      'dialog.orType': 'Or type a question (matched to a preset)',
      'dialog.ask': 'Ask',
      'dialog.close': 'Close',
      'dialog.q': 'Q: ',
      'dialog.a': 'A: ',
      'item.title': 'Investigate',
      'item.close': 'Close',
      'item.viewed': 'You examined this item.',
      'item.gained': 'Evidence gained:',
      'item.none': 'No new evidence (already collected, or this act is still locked).',
      'evidence.title': 'Evidence board',
      'evidence.close': 'Close',
      'evidence.empty': 'No evidence yet. Walk up to a glowing item and press E.',
      'evidence.source': 'Source: ',
      'evidence.none': 'No evidence yet',
      'notes.title': 'Reasoning notes',
      'notes.ph': 'Record the evidence chain and discussion points…',
      'notes.save': 'Save',
      'notes.close': 'Close',
      'calc.title': 'Science analysis / calculation draft',
      'calc.save': 'Save draft',
      'calc.close': 'Close',
      'vote.title': 'Final vote (once only)',
      'vote.who': 'Choose a person',
      'vote.evidence': 'Evidence IDs cited',
      'vote.evidencePh': 'e.g. E01, E04, E08 or a calculation result',
      'vote.why': 'Scientific reasoning',
      'vote.whyPh': 'Explain why this statement or action contradicts the evidence, or directly caused the incident…',
      'vote.submit': 'Submit (cannot be changed)',
      'vote.cancel': 'Cancel',
      'vote.note': 'Check with your group before submitting. After you confirm, the choice is locked.',
      'vote.confirm': 'Submit now? You cannot change it afterward.',
      'vote.notOpen': 'The teacher has not opened voting yet',
      'vote.already': 'Submitted. Waiting for the reveal.',
      'vote.submitted': 'Submitted',
      'vote.banner': '{msg} (This window stays open. Choose Cancel to close it.)',
      'result.title': 'Reveal',
      'result.close': 'Close',
      'result.pass': 'Pass',
      'result.fail': 'Fail',
      'result.missing': 'Not submitted',
      'host.title': 'Investigation host',
      'host.close': 'Close',
      'host.enterVote': 'Go to final vote',
      'host.viewReveal': 'View reveal',
      'host.revealed': 'The result is revealed. This group: {result}. You can read the review points.',
      'host.waiting': 'Submitted. Waiting for the reveal.',
      'side.noneIv': 'No interviews yet',
      'side.noneHint': 'None yet',
      'badge.mock': 'Demo Q&A (Mock)',
      'prompt.investigate': 'Press E to investigate: {name}',
      'prompt.talk': 'Press E to talk: {name}',
      'prompt.door': 'Press E {label}',
      'prompt.enter': 'Enter',
      'scene.door': 'Door',
      'scene.player': 'Mario',
      'scene.busStop': 'Bus stop',
      'scene.hqBoard': 'Evidence wall / physics bench',
      'hint.stage': 'The teacher moved the investigation to Act {n}.',
      'api.fail': 'Request failed',
      'lang.aria': 'Language',
    },
  };

  const serverEn = {
    '未知案件，请选择 physics 或 chemistry': 'Unknown case. Choose physics or chemistry.',
    '课堂不存在': 'Room not found.',
    '教师权限校验失败': 'Teacher authorization failed.',
    'stage 须为 1/2/3': 'Stage must be 1, 2, or 3.',
    '提示不能为空': 'The hint cannot be empty.',
    '已揭晓，不能重新开票（单轮投票）': 'Already revealed. Voting cannot be reopened (single round).',
    '该小组ID已被占用，请换一个或使用原 token 重连': 'That group ID is taken. Choose another, or reconnect with the original token.',
    '小组身份校验失败': 'Group authorization failed.',
    '物品不存在': 'Item not found.',
    '人物不存在': 'Character not found.',
    '已揭晓，不能再提交': 'Already revealed. No further submissions.',
    '老师尚未开启投票或已截止': 'The teacher has not opened voting, or voting is closed.',
    '本组已提交，不能改选或重复提交': 'This group already submitted. You cannot change or submit again.',
    '无效的嫌疑人选择': 'Invalid suspect choice.',
    '请填写证据与科学分析依据': 'Enter the evidence and the scientific reasoning.',
    '导出失败': 'Export failed.',
    '请求失败': 'Request failed.',
    '最终投票已开启，请各组返回主持人处提交。': 'Final voting is open. Each group should return to the host to submit.',
    '最终投票已关闭。': 'Final voting is closed.',
    '已提交，等待揭晓': 'Submitted. Waiting for the reveal.',
    '……（对方没有更多可说的了）': '… (They have nothing more to say.)',
    '演示问答（Mock）': 'Demo Q&A (Mock)',
  };

  let lang = readStored();
  const listeners = [];

  function readStored() {
    try {
      const v = localStorage.getItem(KEY);
      if (v === 'en' || v === 'zh') return v;
    } catch (_) {}
    return 'zh';
  }

  function t(key, vars) {
    const table = dict[lang] || dict.zh;
    let s = table[key];
    if (s == null) s = dict.zh[key];
    if (s == null) return key;
    if (vars) {
      Object.keys(vars).forEach((k) => {
        s = s.split('{' + k + '}').join(String(vars[k]));
      });
    }
    return s;
  }

  function getLang() {
    return lang;
  }

  function resultLabel(code) {
    if (code === '合格') return t('result.pass');
    if (code === '不合格') return t('result.fail');
    if (code === '未提交') return t('result.missing');
    return code || '';
  }

  function serverText(msg) {
    if (!msg || lang !== 'en') return msg;
    if (serverEn[msg]) return serverEn[msg];
    const m = String(msg).match(/^教师将调查推进到第 (\d) 幕$/);
    if (m) return t('hint.stage', { n: m[1] });
    return msg;
  }

  function hintText(text) {
    return serverText(text);
  }

  function localizeCase(pack, language) {
    const loc = window.CaseLocale;
    if (!loc) return pack;
    return loc.packLocale(pack, language || lang);
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    const titleEl = document.querySelector('title[data-i18n]');
    if (titleEl) document.title = t(titleEl.getAttribute('data-i18n'));
    const sw = document.getElementById('langSwitch');
    if (sw) sw.setAttribute('aria-label', t('lang.aria'));
  }

  function updateToggle() {
    document.querySelectorAll('#langSwitch [data-set-lang]').forEach((btn) => {
      const on = btn.getAttribute('data-set-lang') === lang;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function setLang(next) {
    if (next !== 'en' && next !== 'zh') return;
    if (next === lang) {
      apply(document);
      updateToggle();
      return;
    }
    lang = next;
    try {
      localStorage.setItem(KEY, lang);
    } catch (_) {}
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    apply(document);
    updateToggle();
    listeners.forEach((fn) => {
      try {
        fn(lang);
      } catch (err) {
        console.warn(err);
      }
    });
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function bindToggle() {
    const sw = document.getElementById('langSwitch');
    if (!sw || sw.dataset.bound === '1') return;
    sw.dataset.bound = '1';
    sw.querySelectorAll('[data-set-lang]').forEach((btn) => {
      btn.addEventListener('click', () => setLang(btn.getAttribute('data-set-lang')));
    });
  }

  function init() {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    bindToggle();
    apply(document);
    updateToggle();
  }

  window.I18N = {
    t,
    getLang,
    setLang,
    onChange,
    apply,
    serverText,
    hintText,
    resultLabel,
    localizeCase,
    KEY,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
