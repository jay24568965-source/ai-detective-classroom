/** Thin client API — no secrets stored beyond session tokens */
function langHeader() {
  let lang = '';
  try {
    if (typeof window !== 'undefined' && window.I18N && typeof window.I18N.getLang === 'function') {
      lang = window.I18N.getLang();
    } else if (typeof localStorage !== 'undefined') {
      lang = localStorage.getItem('ai-detective-lang') || '';
    }
  } catch (_) {}
  if (lang === 'en' || lang === 'zh-TW') return { 'x-lang': lang };
  return {};
}

const API = {
  base: '',
  langHeader,
  async req(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...langHeader(), ...(opts.headers || {}) };
    const res = await fetch(this.base + path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || res.statusText || '请求失败');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },
  cases: () => API.req('/api/cases'),
  createRoom: (caseId, teacherName) =>
    API.req('/api/teacher/create', { method: 'POST', body: JSON.stringify({ caseId, teacherName }) }),
  teacherState: (code, token) =>
    API.req(`/api/teacher/${code}/state`, { headers: { 'x-teacher-token': token } }),
  teacherPost: (code, token, path, body) =>
    API.req(`/api/teacher/${code}${path}`, {
      method: 'POST',
      headers: { 'x-teacher-token': token },
      body: JSON.stringify(body || {}),
    }),
  exportUrl: (code, token, format) =>
    `/api/teacher/${code}/export?format=${format}&_t=${encodeURIComponent(token)}`,
  // export needs header — use fetch blob helper
  async exportLog(code, token, format) {
    const res = await fetch(`/api/teacher/${code}/export?format=${format}`, {
      headers: { 'x-teacher-token': token },
    });
    if (!res.ok) throw new Error('导出失败');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `log-${code}.${format}`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  join: (body) => API.req('/api/student/join', { method: 'POST', body: JSON.stringify(body) }),
  studentState: (code, token) =>
    API.req(`/api/student/${code}/state`, { headers: { 'x-group-token': token } }),
  studentPost: (code, token, path, body) =>
    API.req(`/api/student/${code}${path}`, {
      method: 'POST',
      headers: { 'x-group-token': token },
      body: JSON.stringify(body || {}),
    }),
};

window.API = API;
