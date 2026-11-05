/**
 * AI inquiry adapter stub.
 * Current: Mock preset Q&A via server (no API keys).
 * Future: swap provider to 'convai' behind server proxy — never put secrets in frontend.
 */
const AIAdapter = {
  provider: 'mock',
  label() {
    if (this.provider === 'mock') {
      return window.I18N ? I18N.t('badge.mock') : '演示问答（Mock）';
    }
    const lang = window.I18N && I18N.getLang();
    if (lang === 'en') return 'Live AI (Convai)';
    if (lang === 'zh-TW') return '真實 AI（Convai）';
    return '真实AI（Convai）';
  },
  async ask({ code, token, suspectId, question }) {
    // Always go through server; Convai would be server-side later
    return API.studentPost(code, token, '/interview', { suspectId, question });
  },
  async presets({ code, token, suspectId }) {
    const res = await fetch(`/api/student/${code}/interview/${suspectId}/presets`, {
      headers: Object.assign({ 'x-group-token': token }, window.API && API.langHeader ? API.langHeader() : {}),
    });
    return res.json();
  },
};

window.AIAdapter = AIAdapter;
