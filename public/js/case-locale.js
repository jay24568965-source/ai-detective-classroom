/**
 * Apply a locale overlay onto the simplified-Chinese public case view.
 * Shared by the browser and the Express server so both paths stay in sync.
 * Sprite ids, coordinates, evidence ids, and answer fields are left untouched.
 *
 * Supported codes: zh (default simplified), zh-TW (Traditional), en.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CaseLocale = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalizeLang(lang) {
    const v = String(lang || '').trim().toLowerCase().replace(/_/g, '-');
    if (v === 'en' || v === 'english') return 'en';
    if (v === 'zh-tw' || v === 'zh-hant' || v === 'zhtw' || v === 'zh-hk' || v === 'zh-hant-tw') return 'zh-TW';
    return 'zh';
  }

  function apply(zhView, overlay) {
    if (!zhView) return zhView;
    const out = JSON.parse(JSON.stringify(zhView));
    if (!overlay) return out;
    ['title', 'subject', 'durationHint', 'voteQuestion', 'background'].forEach((k) => {
      if (overlay[k]) out[k] = overlay[k];
    });
    if (Array.isArray(overlay.briefing)) out.briefing = overlay.briefing.slice();
    if (overlay.hostNpc && out.hostNpc) {
      ['name', 'shortName', 'role', 'greeting', 'votePrompt'].forEach((k) => {
        if (overlay.hostNpc[k]) out.hostNpc[k] = overlay.hostNpc[k];
      });
    }
    if (overlay.suspects && Array.isArray(out.suspects)) {
      out.suspects = out.suspects.map((s) => {
        const t = overlay.suspects[s.id];
        if (!t) return s;
        const next = Object.assign({}, s);
        ['name', 'shortName', 'role', 'card'].forEach((k) => {
          if (t[k]) next[k] = t[k];
        });
        return next;
      });
    }
    if (overlay.maps && Array.isArray(out.maps)) {
      out.maps = out.maps.map((m) => {
        const t = overlay.maps[m.id];
        if (!t) return m;
        const next = Object.assign({}, m, { name: t.name || m.name });
        if (t.doors && Array.isArray(m.doors)) {
          next.doors = m.doors.map((d) => Object.assign({}, d, { label: t.doors[d.id] || d.label }));
        }
        if (t.zones && Array.isArray(m.zones)) {
          next.zones = m.zones.map((z) => Object.assign({}, z, { label: t.zones[z.id] || z.label }));
        }
        if (t.items && Array.isArray(m.items)) {
          next.items = m.items.map((it) => Object.assign({}, it, { name: t.items[it.id] || it.name }));
        }
        return next;
      });
    }
    if (overlay.evidence && Array.isArray(out.evidence)) {
      out.evidence = out.evidence.map((e) => {
        const t = overlay.evidence[e.id];
        if (!t) return e;
        return Object.assign({}, e, {
          name: t.name || e.name,
          source: t.source || e.source,
          studentText: t.studentText || e.studentText,
        });
      });
    }
    if (overlay.calcTasks && Array.isArray(out.calcTasks)) {
      out.calcTasks = out.calcTasks.map((task) => {
        const t = overlay.calcTasks[task.id];
        if (!t) return task;
        const next = Object.assign({}, task, {
          title: t.title || task.title,
          prompt: t.prompt || task.prompt,
        });
        if (Array.isArray(task.fields)) {
          next.fields = task.fields.map((f) =>
            Object.assign({}, f, { label: (t.fields && t.fields[f.key]) || f.label })
          );
        }
        return next;
      });
    }
    if (overlay.stages && Array.isArray(out.stages)) {
      out.stages = out.stages.map((s) =>
        Object.assign({}, s, { name: overlay.stages[String(s.id)] || overlay.stages[s.id] || s.name })
      );
    }
    if (out.revealSummary && overlay.revealSummary) out.revealSummary = overlay.revealSummary;
    return out;
  }

  function baseZh(pack) {
    if (pack.locale && pack.locale !== 'zh' && pack.i18n && pack.i18n.zh) {
      return pack.i18n.zh;
    }
    const zh = JSON.parse(JSON.stringify(pack));
    delete zh.i18n;
    delete zh.locale;
    return zh;
  }

  /** Pick zh, zh-TW, or en from a public case pack that carries i18n overlays. */
  function packLocale(pack, lang) {
    if (!pack) return pack;
    const code = normalizeLang(lang);
    const zh = baseZh(pack);
    if (code === 'zh') return JSON.parse(JSON.stringify(zh));
    const overlay = pack.i18n && pack.i18n[code];
    if (!overlay) return JSON.parse(JSON.stringify(zh));
    return apply(zh, overlay);
  }

  return { apply, packLocale, normalizeLang };
});
