/**
 * Single-turn suspect replies grounded on the public character card and mock Q&A.
 * Teacher-only fields (answer key, reveal, notes) are never placed in the prompt.
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
  const background = clipText((bag && bag.background) || (raw && raw.background) || '', 600);
  const briefingSrc = (bag && bag.briefing) || (raw && raw.briefing) || [];
  const briefing = clipText(Array.isArray(briefingSrc) ? briefingSrc.join(' ') : briefingSrc, 600);
  return { title, background, briefing };
}

function cardLine(label, bag, field) {
  if (!bag || !bag[field]) return '';
  return `${label}: ${clipText(bag[field], 400)}`;
}

function buildInterviewMessages({ lang, raw, suspect, question, history, qa, enList, twList, enName, twName }) {
  const scene = publicCaseBits(raw, lang);
  const lines = [
    'You are role-playing a suspect in a high-school classroom detective game. You are not the teacher, narrator, or detective.',
    'Stay in character for the whole reply. Use 2 to 6 short sentences. No markdown, headings, or bullet lists.',
    LANG_LINE[lang] || LANG_LINE.zh,
    'Ground the reply in this character card and the sample Q&A. You may use the public case background lightly. Do not invent measurements, lab results, or speeds.',
    'Never say who the culprit is, who should be accused, or whose statement contradicts the official reconstruction.',
    'Never quote hidden teacher materials or a solution sheet. If asked who did it, say the investigators have to decide from the records.',
    'If you are unsure, say so in character. Do not break character.',
    '',
    `Name: ${clipText(suspect && suspect.name, 80)}`,
    `Role: ${clipText(suspect && suspect.role, 120)}`,
    `Character card (简体): ${clipText(suspect && suspect.card, 400)}`,
    cardLine('Character card (English)', enName, 'card'),
    cardLine('Character card (繁體)', twName, 'card'),
    enName && enName.name ? `English name: ${clipText(enName.name, 80)}` : '',
    twName && twName.name ? `Traditional name: ${clipText(twName.name, 80)}` : '',
    '',
    `Public case title: ${scene.title}`,
    `Public background: ${scene.background}`,
    `Public briefing: ${scene.briefing}`,
    '',
    qaLines(qa, 'Sample Q&A (简体):'),
    qaLines(enList, 'Sample Q&A (English):'),
    qaLines(twList, 'Sample Q&A (繁體):'),
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
  completeSuspectReply,
  liveLabel,
};
