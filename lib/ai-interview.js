/**
 * Single-turn suspect replies grounded on the case script for the current act.
 * Teacher-only fields (answer key, reveal, notes, calculated solution) stay out.
 */
const { chatComplete, modelName } = require('./deepseek');

const LIVE_LABELS = {
  zh: '真实AI（DeepSeek）',
  en: 'Live AI (DeepSeek)',
  'zh-TW': '真實 AI（DeepSeek）',
};

const LANG_LINE = {
  zh: 'Reply only in 简体中文.',
  en: 'Reply only in English.',
  'zh-TW': 'Reply only in 繁體中文.',
};

const ANSWER_MAX = 600;

function clipText(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function clipAnswer(value) {
  let text = String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length > 1) ||
    (text.startsWith('「') && text.endsWith('」') && text.length > 1)
  ) {
    text = text.slice(1, -1).trim();
  }
  if (text.length <= ANSWER_MAX) return text;
  const cut = text.slice(0, ANSWER_MAX);
  const punct = Math.max(
    cut.lastIndexOf('。'),
    cut.lastIndexOf('！'),
    cut.lastIndexOf('？'),
    cut.lastIndexOf('.'),
    cut.lastIndexOf('!'),
    cut.lastIndexOf('?')
  );
  if (punct > 180) return cut.slice(0, punct + 1);
  return `${cut.trim()}…`;
}

function revealHeadlines(raw) {
  const bags = [
    raw && raw.revealSummary,
    raw && raw.i18n && raw.i18n.en && raw.i18n.en.revealSummary,
    raw && raw.i18n && raw.i18n['zh-TW'] && raw.i18n['zh-TW'].revealSummary,
  ];
  return bags.map((bag) => bag && bag.headline).filter(Boolean);
}

function replyLeaks(text, raw) {
  const body = String(text || '');
  if (!body.trim()) return true;
  const banned = [
    '标准答案',
    '標準答案',
    'Answer key',
    'correctSuspectId',
    'revealSummary',
    'teacherNote',
    'teacherCheck',
    'teacherHint',
    '作为AI',
    '作為AI',
    '作为人工智能',
    '作為人工智能',
    '我是人工智能',
    'as an AI',
    'I am an AI',
    'language model',
    '语言模型',
    '語言模型',
  ];
  if (banned.some((phrase) => body.includes(phrase))) return true;
  return revealHeadlines(raw).some((headline) => headline && body.includes(headline));
}

function promptLeaks(system) {
  const banned = [
    'correctSuspectId',
    'revealSummary',
    'teacherNote',
    'teacherCheck',
    'teacherHint',
    '标准答案',
    '標準答案',
    'Answer key',
  ];
  return banned.some((phrase) => system.includes(phrase));
}

function qaLines(list, heading) {
  if (!list || !list.length) return '';
  const rows = list
    .slice(0, 12)
    .map((pair) => {
      if (!pair || !pair.q) return '';
      return `- Q: ${clipText(pair.q, 240)}\n  A: ${clipText(pair.a, 400)}`;
    })
    .filter(Boolean);
  if (!rows.length) return '';
  return `${heading}\n${rows.join('\n')}`;
}

function publicCaseBits(raw, lang) {
  const bag = lang !== 'zh' && raw && raw.i18n && raw.i18n[lang] ? raw.i18n[lang] : null;
  const title = clipText((bag && bag.title) || (raw && raw.title) || '', 120);
  const background = clipText((bag && bag.background) || (raw && raw.background) || '', 700);
  const briefingSrc = (bag && bag.briefing) || (raw && raw.briefing) || [];
  const briefing = clipText(Array.isArray(briefingSrc) ? briefingSrc.join(' ') : briefingSrc, 700);
  return { title, background, briefing };
}

/** Drop skeleton lines that name the official accusation. Keep the rest of the card. */
function scrubCard(value) {
  const text = String(value || '')
    .replace(/正确指认对象（[^）]*）[。.]?\s*/g, '')
    .replace(/正確指認對象（[^）]*）[。.]?\s*/g, '')
    .replace(/Correct accusation target\s*\([^)]*\)\.?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clipText(text, 400);
}

function cardLine(label, bag, field) {
  if (!bag || !bag[field]) return '';
  const text = field === 'card' ? scrubCard(bag[field]) : clipText(bag[field], 400);
  if (!text) return '';
  return `${label}: ${text}`;
}

function stageNumber(stage) {
  const n = Number(stage);
  if (n === 2 || n === 3) return n;
  return 1;
}

function localeBag(raw, lang) {
  if (!raw || !lang || lang === 'zh') return null;
  return raw.i18n && raw.i18n[lang] ? raw.i18n[lang] : null;
}

function actTitle(raw, stageNum, lang) {
  const bag = localeBag(raw, lang);
  const named = bag && bag.stages && (bag.stages[String(stageNum)] || bag.stages[stageNum]);
  if (named) return clipText(named, 80);
  const row = (raw && raw.stages || []).find((s) => Number(s.id) === stageNum);
  return clipText((row && row.name) || String(stageNum), 80);
}

/**
 * Student-visible case-file facts for this act and earlier acts.
 * Calculated solution rows and anything not yet unlocked stay out.
 */
function releasedEvidence(raw, stage) {
  const stageNum = stageNumber(stage);
  const unlocked = new Set();
  (raw && raw.stages || []).forEach((s) => {
    if (Number(s.id) <= stageNum) (s.unlockEvidence || []).forEach((id) => unlocked.add(id));
  });
  return (raw && raw.evidence || []).filter((ev) => {
    if (!ev || ev.stage === 'calc') return false;
    if (typeof ev.stage === 'number' && ev.stage > stageNum && !unlocked.has(ev.id)) return false;
    if (typeof ev.stage === 'number') return ev.stage <= stageNum || unlocked.has(ev.id);
    return unlocked.has(ev.id);
  });
}

function evidenceFact(raw, ev, lang) {
  const bag = localeBag(raw, lang);
  const loc = bag && bag.evidence && bag.evidence[ev.id];
  const name = clipText((loc && loc.name) || ev.name || ev.id, 80);
  const source = clipText((loc && loc.source) || ev.source || '', 80);
  const studentText = clipText((loc && loc.studentText) || ev.studentText || '', 500);
  if (!studentText) return '';
  const where = source ? `（${source}）` : '';
  return `- ${ev.id} ${name}${where}：${studentText}`;
}

function factBlock(raw, stage, lang) {
  const rows = releasedEvidence(raw, stage)
    .map((ev) => evidenceFact(raw, ev, lang))
    .filter(Boolean);
  const zhRows = lang !== 'zh'
    ? releasedEvidence(raw, stage).map((ev) => evidenceFact(raw, ev, 'zh')).filter(Boolean)
    : [];
  const parts = ['Case-file facts released for this act and earlier acts (use these; do not add measurements from a later act):'];
  parts.push(rows.length ? rows.join('\n') : '(none yet)');
  if (zhRows.length && lang !== 'zh') {
    parts.push('Same facts in 简体中文:');
    parts.push(zhRows.join('\n'));
  }
  return parts.join('\n');
}

function rosterBlock(raw, suspect, lang) {
  const bag = localeBag(raw, lang);
  const lines = (raw && raw.suspects || [])
    .filter((person) => person && person.id !== (suspect && suspect.id))
    .map((person) => {
      const loc = bag && bag.suspects && bag.suspects[person.id];
      const name = clipText((loc && loc.name) || person.name || person.id, 80);
      const role = clipText((loc && loc.role) || person.role || '', 120);
      return role ? `- ${name}：${role}` : `- ${name}`;
    });
  if (!lines.length) return '';
  return `Other people present (names and roles only; you do not know their private statements):\n${lines.join('\n')}`;
}

function buildInterviewMessages({ lang, raw, suspect, question, history, qa, enList, twList, enName, twName, stage }) {
  const scene = publicCaseBits(raw, lang);
  const stageNum = stageNumber(stage);
  const actName = actTitle(raw, stageNum, lang);
  const ownCard = scrubCard(suspect && suspect.card);
  const lines = [
    'You are role-playing a suspect in a high-school classroom detective game. You are not the teacher, narrator, or detective.',
    'Stay in character for the whole reply. Use 2 to 6 short sentences. No markdown, headings, or bullet lists.',
    LANG_LINE[lang] || LANG_LINE.zh,
    'You know the case script for the current act. Scripted clues below are things this character can actually say. If the question matches one, give that clue in your own words. Do not answer with only a vague refusal when a scripted clue fits.',
    'Released case-file facts listed below can also be said, in character, when the question asks about them. Do not invent a measurement, lab result, time, or speed that is not written there or in the scripted clues.',
    'Do not combine those facts into a reconstructed speed, gap, or concentration. Students do that calculation themselves.',
    'Only the current act and earlier acts are open. If the question needs a later-act file that is not in the released facts, say you do not know that yet.',
    'Never name a culprit, say who should be accused, or announce a reconstructed final figure or an end-of-class solution. Never quote hidden teacher materials. If asked who did it, say the investigators have to decide from the records.',
    'If no scripted clue or released fact fits, say you are unsure, in character. Do not break character.',
    '',
    `Current act: ${actName} (stage ${stageNum} of 3).`,
    '',
    `Name: ${clipText(suspect && suspect.name, 80)}`,
    `Role: ${clipText(suspect && suspect.role, 120)}`,
    ownCard ? `Character knowledge (简体): ${ownCard}` : '',
    cardLine('Character knowledge (English)', enName, 'card'),
    cardLine('Character knowledge (繁體)', twName, 'card'),
    enName && enName.name ? `English name: ${clipText(enName.name, 80)}` : '',
    twName && twName.name ? `Traditional name: ${clipText(twName.name, 80)}` : '',
    '',
    `Public case title: ${scene.title}`,
    `Public background: ${scene.background}`,
    `Public briefing: ${scene.briefing}`,
    '',
    factBlock(raw, stageNum, lang),
    '',
    rosterBlock(raw, suspect, lang),
    '',
    qaLines(qa, 'Scripted clues this character can say now (use the matching clue; do not refuse it, 简体):'),
    qaLines(enList, 'Scripted clues this character can say now (English):'),
    qaLines(twList, 'Scripted clues this character can say now (繁體):'),
  ].filter((line) => line !== '');

  const system = lines.join('\n');
  if (promptLeaks(system)) {
    const err = new Error('prompt rejected');
    err.code = 'PROMPT';
    throw err;
  }

  const messages = [{ role: 'system', content: system }];
  (history || []).slice(-4).forEach((turn) => {
    if (!turn || !turn.question || !turn.answer) return;
    messages.push({ role: 'user', content: clipText(turn.question, 500) });
    messages.push({ role: 'assistant', content: clipText(turn.answer, ANSWER_MAX) });
  });
  messages.push({ role: 'user', content: clipText(question, 500) });
  return messages;
}

/**
 * @returns {Promise<{ text: string, model: string }>}
 */
async function completeSuspectReply(ctx) {
  const messages = buildInterviewMessages(ctx);
  const result = await chatComplete({ messages, maxTokens: 320 });
  const text = clipAnswer(result.text);
  if (!text || replyLeaks(text, ctx.raw)) {
    const err = new Error('rejected reply');
    err.code = 'REJECTED';
    throw err;
  }
  return { text, model: result.model || modelName() };
}

function liveLabel(lang) {
  if (lang === 'en') return LIVE_LABELS.en;
  if (lang === 'zh-TW') return LIVE_LABELS['zh-TW'];
  return LIVE_LABELS.zh;
}

module.exports = {
  LIVE_LABELS,
  ANSWER_MAX,
  clipAnswer,
  replyLeaks,
  buildInterviewMessages,
  releasedEvidence,
  stageNumber,
  completeSuspectReply,
  liveLabel,
};
