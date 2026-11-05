/**
 * AI inquiry adapter stub.
 * Current: Mock preset Q&A via server (no API keys).
 * Future: swap provider to 'convai' behind server proxy — never put secrets in frontend.
 */
const AIAdapter = {
  provider: 'mock',
  label() {
    return this.provider === 'mock' ? '演示问答（Mock）' : '真实AI（Convai）';
  },
  async ask({ code, token, suspectId, question }) {
    // Always go through server; Convai would be server-side later
    return API.studentPost(code, token, '/interview', { suspectId, question });
  },
  async presets({ code, token, suspectId }) {
    const res = await fetch(`/api/student/${code}/interview/${suspectId}/presets`, {
      headers: { 'x-group-token': token },
    });
    return res.json();
  },
};

window.AIAdapter = AIAdapter;
