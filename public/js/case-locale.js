/**
 * Apply an English overlay onto a Chinese public case view.
 * Shared by the browser and the Express server so both paths stay in sync.
 * Sprite ids, coordinates, evidence ids, and answer fields are left untouched.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CaseLocale = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function apply(zhView, en) {
    if (!zhView) return zhView;
    const out = JSON.parse(JSON.stringify(zhView));
    if (!en) return out;
    ['title', 'subject', 'durationHint', 'voteQuestion', 'background'].forEach((k) => {
      if (en[k]) out[k] = en[k];
    });
    if (Array.isArray(en.briefing)) out.briefing = en.briefing.slice();
    if (en.hostNpc && out.hostNpc) {
      ['name', 'shortName', 'role', 'greeting', 'votePrompt'].forEach((k) => {
        if (en.hostNpc[k]) out.hostNpc[k] = en.hostNpc[k];
      });
    }
    if (en.suspects && Array.isArray(out.suspects)) {
      out.suspects = out.suspects.map((s) => {
        const t = en.suspects[s.id];
        if (!t) return s;
        const next = Object.assign({}, s);
        ['name', 'shortName', 'role', 'card'].forEach((k) => {
          if (t[k]) next[k] = t[k];
        });
        return next;
      });
    }
    if (en.maps && Array.isArray(out.maps)) {
      out.maps = out.maps.map((m) => {
        const t = en.maps[m.id];
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
    if (en.evidence && Array.isArray(out.evidence)) {
      out.evidence = out.evidence.map((e) => {
        const t = en.evidence[e.id];
        if (!t) return e;
        return Object.assign({}, e, {
          name: t.name || e.name,
          source: t.source || e.source,
          studentText: t.studentText || e.studentText,
        });
      });
    }
    if (en.calcTasks && Array.isArray(out.calcTasks)) {
      out.calcTasks = out.calcTasks.map((task) => {
        const t = en.calcTasks[task.id];
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
    if (en.stages && Array.isArray(out.stages)) {
      out.stages = out.stages.map((s) =>
        Object.assign({}, s, { name: en.stages[String(s.id)] || en.stages[s.id] || s.name })
      );
    }
    if (out.revealSummary && en.revealSummary) out.revealSummary = en.revealSummary;
    return out;
  }

  /** Pick zh or en from a public case pack that always carries i18n.en. */
  function packLocale(pack, lang) {
    if (!pack) return pack;
    const en = pack.i18n && pack.i18n.en;
    let zh;
    if (pack.locale === 'en' && pack.i18n && pack.i18n.zh) {
      zh = pack.i18n.zh;
    } else {
      zh = JSON.parse(JSON.stringify(pack));
      delete zh.i18n;
      delete zh.locale;
    }
    if (lang === 'en' && en) return apply(zh, en);
    return JSON.parse(JSON.stringify(zh));
  }

  return { apply, packLocale };
});
