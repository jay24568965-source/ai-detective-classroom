/**
 * Suspect interview adapter.
 * Always posts to the server. DeepSeek runs only on the server when DEEPSEEK_API_KEY is set.
 * The badge follows the server's mode; this file never decides that a reply was live on its own.
 */
const AIAdapter = {
  provider: 'mock',
  model: '',
  label() {
    if (this.provider === 'deepseek') {
      return window.I18N ? I18N.t('badge.live') : '真实AI（DeepSeek）';
    }
    return window.I18N ? I18N.t('badge.mock') : '演示问答（Mock）';
  },
  /** @returns {'live'|'mock'} */
  applyServer(data) {
    const live = !!(data && data.mode === 'live' && data.adapter && data.adapter.provider === 'deepseek');
    this.provider = live ? 'deepseek' : 'mock';
    this.model = live && data.adapter.model ? String(data.adapter.model) : '';
    return live ? 'live' : 'mock';
  },
  async ask({ code, token, suspectId, question }) {
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
