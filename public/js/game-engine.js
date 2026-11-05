/**
 * Reusable 2D classroom exploration engine.
 * Player is an original geometric Mario. Suspects/host use original geometric
 * Mario-universe silhouettes (not Nintendo spritesheets or ROM tiles).
 * Case content comes from JSON config. The shared detective walks by click or tap.
 */
(function () {
  const SPEED = 230;
  const PLAYER_R = 12;
  const REACH = { item: 36, npc: 42, host: 42, door: 28 };

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function tr(key, vars, fallback) {
    if (typeof window !== 'undefined' && window.I18N && typeof window.I18N.t === 'function') {
      const s = window.I18N.t(key, vars);
      if (s && s !== key) return s;
    }
    if (!vars) return fallback;
    return String(fallback).replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
  }

  function distPointRect(px, py, r) {
    const cx = Math.max(r.x, Math.min(px, r.x + r.w));
    const cy = Math.max(r.y, Math.min(py, r.y + r.h));
    const dx = px - cx;
    const dy = py - cy;
    return Math.hypot(dx, dy);
  }

  class GameEngine {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.caseData = null;
      this.map = null;
      this.player = { x: 100, y: 100, facing: 'down', anim: 0, investigating: 0 };
      this.keys = {};
      this.inputBlocked = false;
      this.near = null;
      this.onInteract = opts.onInteract || (() => {});
      this.onPrompt = opts.onPrompt || (() => {});
      this.progress = { evidence: [], viewed: [], interviewed: [] };
      this.stage = 1;
      this.paused = false;
      this._last = 0;
      this._bound = false;
      this.touchDir = { x: 0, y: 0 };
      this.dest = null;
      this.pending = null;
      this.hover = null;
      this.fxTime = 0;
      this._stuck = 0;
      this._rain = null;
    }

    loadCase(caseData, progress, stage) {
      this.caseData = caseData;
      this.progress = progress || this.progress;
      this.stage = stage || 1;
      const startMap =
        (progress && progress.position && caseData.maps.find((m) => m.id === progress.position.mapId)) ||
        caseData.maps[0];
      this.setMap(startMap.id, progress && progress.position ? progress.position.x : null, progress && progress.position ? progress.position.y : null);
    }

    /** Swap localized case text without moving the player or rebuilding the room. */
    relocalize(caseData) {
      const mapId = this.map && this.map.id;
      const x = this.player.x;
      const y = this.player.y;
      this.caseData = caseData;
      if (mapId) this.setMap(mapId, x, y);
      else this.draw();
    }

    setMap(mapId, x, y) {
      const m = this.caseData.maps.find((mm) => mm.id === mapId);
      if (!m) return;
      this.map = m;
      this.canvas.width = m.width;
      this.canvas.height = m.height;
      this.player.x = x != null ? x : m.spawn.x;
      this.player.y = y != null ? y : m.spawn.y;
      this.near = null;
      this.dest = null;
      this.pending = null;
      this.hover = null;
      this._stuck = 0;
    }

    bindInput() {
      if (this._bound) return;
      this._bound = true;
      const canvas = this.canvas;
      canvas.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (e.cancelable) e.preventDefault();
        const p = this.clientToMap(e.clientX, e.clientY);
        this.handlePointer(p.x, p.y);
      });
      canvas.addEventListener('pointermove', (e) => {
        const p = this.clientToMap(e.clientX, e.clientY);
        this.hover = this.pickTarget(p.x, p.y);
      });
      canvas.addEventListener('pointerleave', () => {
        this.hover = null;
      });
    }

    clientToMap(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect ? this.canvas.getBoundingClientRect() : { left: 0, top: 0, width: this.canvas.width, height: this.canvas.height };
      const w = rect.width || this.canvas.width || 1;
      const h = rect.height || this.canvas.height || 1;
      return {
        x: ((clientX - rect.left) * this.canvas.width) / w,
        y: ((clientY - rect.top) * this.canvas.height) / h,
      };
    }

    reach(type) {
      return REACH[type] || 36;
    }

    pointInRect(x, y, r, pad) {
      const p = pad || 0;
      return x >= r.x - p && y >= r.y - p && x <= r.x + r.w + p && y <= r.y + r.h + p;
    }

    pickTarget(x, y) {
      if (!this.map) return null;
      const hits = [];
      (this.map.npcs || []).forEach((n) => {
        const d = Math.hypot(x - n.x, y - (n.y - 14));
        if (d < 32) hits.push({ type: n.id === 'host' ? 'host' : 'npc', id: n.id, ref: n, d });
      });
      (this.map.items || []).forEach((it) => {
        if (!this.pointInRect(x, y, it, 12)) return;
        const cx = it.x + it.w / 2;
        const cy = it.y + it.h / 2;
        hits.push({ type: 'item', id: it.id, ref: it, d: Math.hypot(x - cx, y - cy) });
      });
      (this.map.doors || []).forEach((door) => {
        if (!this.pointInRect(x, y, door, 10)) return;
        const cx = door.x + door.w / 2;
        const cy = door.y + door.h / 2;
        hits.push({ type: 'door', id: door.id, ref: door, d: Math.hypot(x - cx, y - cy) });
      });
      hits.sort((a, b) => a.d - b.d);
      return hits[0] || null;
    }

    /** Click or tap: walk to a floor point, or walk up to a hotspot and open it. */
    handlePointer(x, y) {
      if (!this.map || this.inputBlocked || this.paused) return;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const hit = this.pickTarget(x, y);
      if (hit) {
        const live = this.collectAll().find((c) => c.type === hit.type && c.id === hit.id);
        if (live && live.d < this.reach(live.type)) {
          this.dest = null;
          this.pending = null;
          this._stuck = 0;
          this.near = live;
          this.tryInteract();
          return;
        }
        this.pending = { type: hit.type, id: hit.id };
        this.dest = this.approachPoint(hit);
        this._stuck = 0;
        return;
      }
      if (!this.collide(x, y)) {
        this.pending = null;
        this.dest = { x, y };
        this._stuck = 0;
      }
    }

    approachPoint(hit) {
      const px = this.player.x;
      const py = this.player.y;
      if (hit.type === 'npc' || hit.type === 'host') {
        const nx = hit.ref.x;
        const ny = hit.ref.y;
        const d = Math.hypot(nx - px, ny - py) || 1;
        const stop = 30;
        if (d <= stop) return { x: px, y: py };
        const t = (d - stop) / d;
        const x = px + (nx - px) * t;
        const y = py + (ny - py) * t;
        if (!this.collide(x, y)) return { x, y };
        return { x: nx, y: ny };
      }
      const r = hit.ref;
      const qx = Math.max(r.x, Math.min(px, r.x + r.w));
      const qy = Math.max(r.y, Math.min(py, r.y + r.h));
      if (!this.collide(qx, qy)) return { x: qx, y: qy };
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      if (!this.collide(cx, cy)) return { x: cx, y: cy };
      return { x: px, y: py };
    }

    setInputBlocked(v) {
      this.inputBlocked = !!v;
      if (v) {
        this.keys = {};
        this.touchDir = { x: 0, y: 0 };
        this.dest = null;
        this.pending = null;
        this._stuck = 0;
      }
    }

    tryInteract() {
      if (!this.near || this.inputBlocked || this.paused) return;
      this.player.investigating = 0.35;
      this.onInteract(this.near);
    }

    collectAll() {
      if (!this.map) return [];
      const px = this.player.x;
      const py = this.player.y;
      const all = [];
      (this.map.items || []).forEach((it) => {
        all.push({
          type: 'item',
          id: it.id,
          ref: it,
          d: distPointRect(px, py, it),
          label: tr('prompt.investigate', { name: it.name }, `点击调查：${it.name}`),
        });
      });
      (this.map.npcs || []).forEach((n) => {
        const isHost = n.id === 'host';
        const sus = isHost ? this.caseData.hostNpc : (this.caseData.suspects || []).find((s) => s.id === n.id);
        const name = sus ? sus.name : n.id;
        all.push({
          type: isHost ? 'host' : 'npc',
          id: n.id,
          ref: n,
          d: Math.hypot(px - n.x, py - n.y),
          label: tr('prompt.talk', { name }, `点击交谈：${name}`),
          suspectId: n.id,
        });
      });
      (this.map.doors || []).forEach((door) => {
        const labelText = door.label || tr('prompt.enter', null, '进入');
        all.push({
          type: 'door',
          id: door.id,
          ref: door,
          d: distPointRect(px, py, door),
          label: tr('prompt.door', { label: labelText }, `点击${labelText}`),
        });
      });
      return all;
    }

    updateNear() {
      const all = this.collectAll();
      const inRange = all.filter((c) => c.d < this.reach(c.type));
      inRange.sort((a, b) => a.d - b.d);
      this.near = inRange[0] || null;
      if (this.pending && !this.near) {
        const hit = all.find((c) => c.type === this.pending.type && c.id === this.pending.id);
        const name = hit ? (hit.type === 'item' ? hit.ref.name : hit.type === 'door' ? (hit.ref.label || '') : hit.label) : '';
        const shown = hit && hit.type !== 'item' && hit.type !== 'door'
          ? ((hit.type === 'host' ? this.caseData.hostNpc : (this.caseData.suspects || []).find((s) => s.id === hit.id)) || {}).name || hit.id
          : name;
        this.onPrompt(shown ? tr('prompt.walking', { name: shown }, `前往：${shown}`) : '');
      } else {
        this.onPrompt(this.near ? this.near.label : '');
      }
      return all;
    }

    followDest(dt) {
      if (!this.dest) {
        this.player.anim = 0;
        return;
      }
      const all = this.collectAll();
      const live = this.pending ? all.find((c) => c.type === this.pending.type && c.id === this.pending.id) : null;
      if (live && live.d < this.reach(live.type)) {
        this.dest = null;
        this.pending = null;
        this._stuck = 0;
        this.player.anim = 0;
        this.near = live;
        this.tryInteract();
        return;
      }
      const dx = this.dest.x - this.player.x;
      const dy = this.dest.y - this.player.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 3) {
        if (!this.collide(this.dest.x, this.dest.y)) {
          this.player.x = this.dest.x;
          this.player.y = this.dest.y;
        }
        this.dest = null;
        this.player.anim = 0;
        this._stuck = 0;
        if (live && live.d < this.reach(live.type) + 10) {
          this.pending = null;
          this.near = live;
          this.tryInteract();
        } else {
          this.pending = null;
        }
        return;
      }
      const stepLen = Math.min(dist, SPEED * dt);
      const nx = this.player.x + (dx / dist) * stepLen;
      const ny = this.player.y + (dy / dist) * stepLen;
      if (Math.abs(dx) > Math.abs(dy)) this.player.facing = dx > 0 ? 'right' : 'left';
      else this.player.facing = dy > 0 ? 'down' : 'up';
      const ox = this.player.x;
      const oy = this.player.y;
      if (!this.collide(nx, this.player.y)) this.player.x = nx;
      if (!this.collide(this.player.x, ny)) this.player.y = ny;
      const moved = Math.hypot(this.player.x - ox, this.player.y - oy);
      if (moved < 0.25) {
        this._stuck += 1;
        if (this._stuck > 10) {
          this.dest = null;
          this.pending = null;
          this._stuck = 0;
          this.player.anim = 0;
        }
      } else {
        this._stuck = 0;
        this.player.anim += dt * 8;
      }
    }

    collide(nx, ny) {
      const body = { x: nx - PLAYER_R, y: ny - PLAYER_R, w: PLAYER_R * 2, h: PLAYER_R * 2 };
      for (const w of this.map.walls || []) {
        if (rectsOverlap(body, w)) return true;
      }
      // map bounds
      if (nx < PLAYER_R || ny < PLAYER_R || nx > this.map.width - PLAYER_R || ny > this.map.height - PLAYER_R) return true;
      return false;
    }

    step(dt) {
      this.fxTime += dt;
      if (!this.map) {
        this.draw();
        return;
      }
      if (!this.inputBlocked && !this.paused) this.followDest(dt);
      else this.player.anim = 0;
      if (this.player.investigating > 0) this.player.investigating -= dt;
      this.updateNear();
      this.draw();
    }

    start() {
      this.bindInput();
      this._last = performance.now();
      const loop = (t) => {
        const dt = Math.min(0.05, (t - this._last) / 1000);
        this._last = t;
        this.step(dt);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    draw() {
      const ctx = this.ctx;
      const m = this.map;
      if (!m) return;
      ctx.imageSmoothingEnabled = true;
      ctx.clearRect(0, 0, m.width, m.height);
      this.drawSceneBackground(m);

      (m.zones || []).forEach((z) => this.drawZone(z));
      (m.walls || []).forEach((w) => this.drawWall(w, m));
      (m.doors || []).forEach((d) => this.drawDoor(d, m));
      (m.items || []).forEach((it) => this.drawItem(it));

      // NPCs (drawn before player for simple occlusion when below)
      const sprites = [];
      (m.npcs || []).forEach((n) => {
        const isHost = n.id === 'host';
        const sus = isHost ? this.caseData.hostNpc : (this.caseData.suspects || []).find((s) => s.id === n.id);
        sprites.push({
          id: n.id,
          x: n.x,
          y: n.y,
          color: (sus && sus.portrait) || '#94a3b8',
          label: (sus && (sus.shortName || sus.name)) || n.id,
          host: isHost,
          sprite: sus && sus.sprite,
        });
      });
      sprites.push({
        x: this.player.x,
        y: this.player.y,
        color: '#38bdf8',
        label: tr('scene.player', null, '马里奥'),
        player: true,
        facing: this.player.facing,
        anim: this.player.anim,
        investigating: this.player.investigating,
      });
      sprites.sort((a, b) => a.y - b.y);
      sprites.forEach((s) => this.drawSprite(s));
      this.drawDestination();
      this.drawWeather(m);

      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const title = m.name || '';
      const titleW = Math.ceil(ctx.measureText(title).width) + 28;
      const plateW = Math.max(140, Math.min(titleW, m.width - 16));
      ctx.fillStyle = 'rgba(2, 6, 23, 0.82)';
      ctx.fillRect(8, 8, plateW, 28);
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(8.5, 8.5, plateW - 1, 27);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(title, 18, 27);
    }

    drawSceneBackground(m) {
      const theme = m.theme || m.id || '';
      if (theme === 'road') this.drawRoad(m);
      else if (theme === 'hq') this.drawHq(m);
      else if (theme === 'hall') this.drawHall(m);
      else if (theme === 'corridor') this.drawCorridor(m);
      else if (theme === 'kitchen') this.drawKitchen(m);
      else if (theme === 'bath') this.drawBath(m);
      else this.drawFallbackRoom(m);
      this.drawVignette(m);
      this.drawPlayerGlow();
    }

    fillStops(x0, y0, x1, y1, stops) {
      const g = this.ctx.createLinearGradient(x0, y0, x1, y1);
      stops.forEach((s) => g.addColorStop(s[0], s[1]));
      return g;
    }

    drawVignette(m) {
      const ctx = this.ctx;
      const g = ctx.createRadialGradient(m.width / 2, m.height / 2, m.width * 0.2, m.width / 2, m.height * 0.45, m.width * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.38)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, m.width, m.height);
    }

    drawPlayerGlow() {
      const ctx = this.ctx;
      const x = this.player.x;
      const y = this.player.y;
      const g = ctx.createRadialGradient(x, y, 8, x, y, 110);
      g.addColorStop(0, 'rgba(253, 224, 71, 0.16)');
      g.addColorStop(1, 'rgba(253, 224, 71, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 110, 0, Math.PI * 2);
      ctx.fill();
    }

    drawWoodFloor(m, dark, light) {
      const ctx = this.ctx;
      ctx.fillStyle = dark;
      ctx.fillRect(0, 0, m.width, m.height);
      for (let y = 0; y < m.height; y += 22) {
        ctx.fillStyle = (y / 22) % 2 ? light : dark;
        ctx.fillRect(0, y, m.width, 22);
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(m.width, y);
        ctx.stroke();
      }
    }

    drawWindow(x, y, w, h) {
      const ctx = this.ctx;
      ctx.fillStyle = '#1c1917';
      ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
      const sky = this.fillStops(x, y, x, y + h, [[0, '#0c4a6e'], [0.5, '#164e63'], [1, '#1e293b']]);
      ctx.fillStyle = sky;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(224, 242, 254, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w / 2, y + h);
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w, y + h / 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.55)';
      const t = this.fxTime || 0;
      for (let i = 0; i < 3; i++) {
        const yy = y + ((t * 36 + i * 13) % Math.max(8, h - 4));
        ctx.beginPath();
        ctx.moveTo(x + 4 + i * (w / 4), yy);
        ctx.lineTo(x + 2 + i * (w / 4), yy + 7);
        ctx.stroke();
      }
    }

    drawRoad(m) {
      const ctx = this.ctx;
      ctx.fillStyle = this.fillStops(0, 0, 0, m.height, [[0, '#111827'], [0.2, '#1f2937'], [1, '#0f172a']]);
      ctx.fillRect(0, 0, m.width, m.height);
      ctx.fillStyle = '#3f3f46';
      ctx.fillRect(0, 0, m.width, 78);
      ctx.fillRect(0, m.height - 86, m.width, 86);
      ctx.fillStyle = '#d6d3d1';
      ctx.fillRect(0, 76, m.width, 5);
      ctx.fillRect(0, m.height - 88, m.width, 5);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(24, 130);
      ctx.lineTo(m.width - 24, 130);
      ctx.moveTo(24, m.height - 120);
      ctx.lineTo(m.width - 24, m.height - 120);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
      ctx.setLineDash([26, 18]);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(30, 270);
      ctx.lineTo(m.width - 40, 270);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(160, 248);
      ctx.quadraticCurveTo(340, 272, 520, 246);
      ctx.moveTo(168, 262);
      ctx.quadraticCurveTo(350, 286, 530, 260);
      ctx.stroke();
      const sheen = this.fillStops(0, 150, 0, 400, [[0, 'rgba(125,211,252,0)'], [0.5, 'rgba(125,211,252,0.08)'], [1, 'rgba(125,211,252,0)']]);
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 110, m.width, 300);
      for (let i = 0; i < 5; i++) this.drawLamp(70 + i * 190, 78);
      this.drawBusShelter(m.width - 168, 18);
      [[140, 455], [188, 468], [760, 450]].forEach((p) => this.drawCone(p[0], p[1]));
      this.drawCautionTape(36, m.height - 102, m.width - 90);
    }

    drawLamp(x, y) {
      const ctx = this.ctx;
      ctx.fillStyle = '#9ca3af';
      ctx.fillRect(x, y, 4, 36);
      ctx.fillStyle = '#fde68a';
      ctx.fillRect(x - 8, y - 6, 20, 8);
      const glow = ctx.createRadialGradient(x + 2, y + 20, 4, x + 2, y + 40, 70);
      glow.addColorStop(0, 'rgba(253, 224, 71, 0.22)');
      glow.addColorStop(1, 'rgba(253, 224, 71, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x + 2, y + 28, 70, 0, Math.PI * 2);
      ctx.fill();
    }

    drawBusShelter(x, y) {
      const ctx = this.ctx;
      ctx.fillStyle = '#334155';
      ctx.fillRect(x, y + 28, 110, 8);
      ctx.fillStyle = 'rgba(125, 211, 252, 0.35)';
      ctx.fillRect(x + 8, y + 8, 90, 22);
      ctx.strokeStyle = '#e2e8f0';
      ctx.strokeRect(x + 8, y + 8, 90, 22);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(x + 6, y + 6, 4, 30);
      ctx.fillRect(x + 98, y + 6, 4, 30);
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(tr('scene.busStop', null, '公交站'), x + 28, y + 4);
    }

    drawCone(x, y) {
      const ctx = this.ctx;
      ctx.fillStyle = '#ea580c';
      ctx.beginPath();
      ctx.moveTo(x, y - 14);
      ctx.lineTo(x + 8, y);
      ctx.lineTo(x - 8, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 6, y - 7, 12, 3);
    }

    drawCautionTape(x, y, w) {
      const ctx = this.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, 10);
      ctx.clip();
      for (let i = -20; i < w; i += 16) {
        ctx.fillStyle = i % 32 === 0 ? '#facc15' : '#111827';
        ctx.beginPath();
        ctx.moveTo(x + i, y);
        ctx.lineTo(x + i + 16, y);
        ctx.lineTo(x + i + 6, y + 10);
        ctx.lineTo(x + i - 10, y + 10);
        ctx.fill();
      }
      ctx.restore();
    }

    drawHq(m) {
      const ctx = this.ctx;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, m.width, m.height);
      for (let y = 0; y < m.height; y += 40) {
        for (let x = 0; x < m.width; x += 40) {
          ctx.fillStyle = ((x + y) / 40) % 2 ? '#172033' : '#1e293b';
          ctx.fillRect(x, y, 40, 40);
        }
      }
      ctx.fillStyle = '#312e81';
      ctx.globalAlpha = 0.35;
      ctx.fillRect(80, 160, 280, 180);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#1e1b4b';
      ctx.fillRect(48, 56, 280, 130);
      ctx.strokeStyle = '#a5b4fc';
      ctx.strokeRect(48, 56, 280, 130);
      ctx.fillStyle = '#e0e7ff';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(tr('scene.hqBoard', null, '证据墙 / 物理工作台'), 62, 78);
      ['#fef3c7', '#fee2e2', '#dbeafe', '#dcfce7'].forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(64 + (i % 4) * 62, 92, 52, 36);
        ctx.strokeStyle = '#94a3b8';
        ctx.strokeRect(64 + (i % 4) * 62, 92, 52, 36);
      });
      ctx.fillStyle = '#334155';
      ctx.fillRect(520, 300, 200, 16);
      ctx.fillStyle = '#0ea5e9';
      ctx.globalAlpha = 0.25;
      ctx.fillRect(540, 250, 70, 40);
      ctx.globalAlpha = 1;
      this.drawWindow(m.width - 120, 16, 70, 22);
      const lamp = ctx.createRadialGradient(180, 120, 10, 180, 140, 160);
      lamp.addColorStop(0, 'rgba(253,224,71,0.12)');
      lamp.addColorStop(1, 'rgba(253,224,71,0)');
      ctx.fillStyle = lamp;
      ctx.fillRect(40, 40, 320, 240);
    }

    drawHall(m) {
      const ctx = this.ctx;
      this.drawWoodFloor(m, '#3f2a1d', '#4a3224');
      ctx.fillStyle = '#7f1d1d';
      ctx.globalAlpha = 0.55;
      ctx.fillRect(220, 180, 280, 160);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(254, 243, 199, 0.35)';
      ctx.strokeRect(220, 180, 280, 160);
      const chand = ctx.createRadialGradient(m.width / 2, 200, 8, m.width / 2, 220, 180);
      chand.addColorStop(0, 'rgba(253, 224, 71, 0.28)');
      chand.addColorStop(1, 'rgba(253, 224, 71, 0)');
      ctx.fillStyle = chand;
      ctx.beginPath();
      ctx.arc(m.width / 2, 210, 180, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fde68a';
      ctx.beginPath();
      ctx.arc(m.width / 2, 168, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#78716c';
      ctx.beginPath();
      ctx.moveTo(m.width / 2, 48);
      ctx.lineTo(m.width / 2, 160);
      ctx.stroke();
      for (let i = 0; i < 3; i++) this.drawWindow(140 + i * 180, 48, 48, 28);
      ctx.fillStyle = '#44403c';
      ctx.fillRect(90, 90, 70, 50);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? '#57534e' : '#292524';
        ctx.fillRect(96, 96 + i * 10, 58, 8);
      }
      ctx.fillStyle = '#44403c';
      ctx.fillRect(150, 70, 36, 44);
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(154, 74, 28, 28);
    }

    drawCorridor(m) {
      const ctx = this.ctx;
      this.drawWoodFloor(m, '#292018', '#3b2a20');
      ctx.fillStyle = '#4c1d1d';
      ctx.globalAlpha = 0.4;
      ctx.fillRect(m.width / 2 - 50, 70, 100, m.height - 140);
      ctx.globalAlpha = 1;
      for (let i = 0; i < 4; i++) {
        const y = 90 + i * 100;
        ctx.fillStyle = '#78350f';
        ctx.fillRect(36, y, 10, 16);
        const g = ctx.createRadialGradient(48, y + 8, 2, 70, y + 8, 50);
        g.addColorStop(0, 'rgba(253,224,71,0.2)');
        g.addColorStop(1, 'rgba(253,224,71,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(60, y + 8, 50, 0, Math.PI * 2);
        ctx.fill();
        this.drawWindow(m.width - 90, y, 40, 26);
      }
    }

    drawKitchen(m) {
      const ctx = this.ctx;
      ctx.fillStyle = '#1c1917';
      ctx.fillRect(0, 0, m.width, m.height);
      for (let y = 0; y < m.height; y += 32) {
        for (let x = 0; x < m.width; x += 32) {
          ctx.fillStyle = ((x / 32 + y / 32) % 2) ? '#292524' : '#44403c';
          ctx.fillRect(x, y, 32, 32);
        }
      }
      ctx.fillStyle = '#57534e';
      ctx.fillRect(40, 48, 460, 18);
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i % 2 ? '#44403c' : '#57534e';
        ctx.fillRect(48 + i * 88, 66, 76, 70);
        ctx.fillStyle = '#a8a29e';
        ctx.fillRect(74 + i * 88, 92, 8, 8);
      }
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(48, 150, 80, 50);
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(58, 158, 28, 18);
      ctx.fillRect(92, 158, 28, 18);
      this.drawWindow(m.width - 150, 56, 80, 46);
      const pot = ctx.createRadialGradient(240, 120, 4, 240, 140, 90);
      pot.addColorStop(0, 'rgba(251,191,36,0.18)');
      pot.addColorStop(1, 'rgba(251,191,36,0)');
      ctx.fillStyle = pot;
      ctx.beginPath();
      ctx.arc(240, 130, 90, 0, Math.PI * 2);
      ctx.fill();
    }

    drawBath(m) {
      const ctx = this.ctx;
      const g = this.fillStops(0, 0, 0, m.height, [[0, '#082f49'], [1, '#0c4a6e']]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, m.width, m.height);
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.22)';
      for (let y = 0; y < m.height; y += 28) {
        for (let x = 0; x < m.width; x += 28) ctx.strokeRect(x, y, 28, 28);
      }
      ctx.fillStyle = 'rgba(186, 230, 253, 0.28)';
      ctx.fillRect(500, 300, 200, 90);
      ctx.strokeStyle = '#e0f2fe';
      ctx.strokeRect(500, 300, 200, 90);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(540, 70, 90, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(548, 40, 74, 30);
      this.drawWindow(40, 56, 70, 40);
      const wet = ctx.createRadialGradient(340, 340, 8, 340, 340, 70);
      wet.addColorStop(0, 'rgba(224,242,254,0.2)');
      wet.addColorStop(1, 'rgba(224,242,254,0)');
      ctx.fillStyle = wet;
      ctx.beginPath();
      ctx.arc(340, 340, 70, 0, Math.PI * 2);
      ctx.fill();
    }

    drawFallbackRoom(m) {
      const ctx = this.ctx;
      ctx.fillStyle = this.fillStops(0, 0, m.width, m.height, [[0, '#1a2332'], [1, '#0f172a']]);
      ctx.fillRect(0, 0, m.width, m.height);
    }

    lightning() {
      const cycle = (this.fxTime || 0) % 6.8;
      if (cycle > 0.14) return 0;
      return (1 - cycle / 0.14) * 0.33;
    }

    ensureRain() {
      if (this._rain) return;
      this._rain = [];
      for (let i = 0; i < 80; i++) {
        this._rain.push({
          x: Math.random(),
          y: Math.random(),
          len: 8 + Math.random() * 12,
          v: 0.45 + Math.random() * 0.55,
          drift: 0.08 + Math.random() * 0.08,
        });
      }
    }

    drawRain(m, alpha, wind) {
      this.ensureRain();
      const ctx = this.ctx;
      ctx.strokeStyle = `rgba(186, 230, 253, ${0.35 * alpha})`;
      ctx.lineWidth = 1;
      const t = this.fxTime || 0;
      this._rain.forEach((drop) => {
        const x = ((drop.x + t * drop.drift * wind) % 1) * m.width;
        const y = ((drop.y + t * drop.v) % 1) * m.height;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 6 * wind, y + drop.len);
        ctx.stroke();
      });
    }

    drawWeather(m) {
      const theme = m.theme || '';
      if (theme === 'road') {
        this.drawRain(m, 1, 1);
        return;
      }
      if (theme === 'hall' || theme === 'corridor' || theme === 'kitchen' || theme === 'bath') {
        this.drawRain(m, 0.4, 1.3);
        const flash = this.lightning();
        if (flash > 0) {
          this.ctx.fillStyle = `rgba(224, 242, 254, ${flash})`;
          this.ctx.fillRect(0, 0, m.width, m.height);
        }
      }
    }

    isBorderWall(w, m) {
      return w.x <= 1 || w.y <= 1 || w.x + w.w >= m.width - 1 || w.y + w.h >= m.height - 1;
    }

    drawWall(w, m) {
      const ctx = this.ctx;
      const theme = m.theme || '';
      const border = this.isBorderWall(w, m);
      if (!border && theme === 'road') {
        ctx.fillStyle = '#57534e';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = '#facc15';
        for (let x = w.x; x < w.x + w.w; x += 18) ctx.fillRect(x, w.y + 4, 10, w.h - 8);
        return;
      }
      if (!border && (theme === 'hall' || theme === 'corridor' || theme === 'hq')) {
        ctx.fillStyle = theme === 'hq' ? '#334155' : '#3f2e22';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(w.x, w.y, w.w, 4);
        return;
      }
      if (!border && theme === 'kitchen') {
        ctx.fillStyle = '#44403c';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = '#d6d3d1';
        ctx.fillRect(w.x, w.y + w.h - 6, w.w, 6);
        return;
      }
      if (!border && theme === 'bath') {
        ctx.fillStyle = '#e0f2fe';
        ctx.globalAlpha = 0.55;
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#7dd3fc';
        ctx.strokeRect(w.x, w.y, w.w, w.h);
        return;
      }
      if (theme === 'road') {
        ctx.fillStyle = '#44403c';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = '#a8a29e';
        ctx.fillRect(w.x, w.y, w.w, Math.min(6, w.h));
        return;
      }
      if (theme === 'bath') {
        ctx.fillStyle = '#155e75';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.strokeStyle = 'rgba(224,242,254,0.25)';
        ctx.strokeRect(w.x, w.y, w.w, w.h);
        return;
      }
      if (theme === 'kitchen') {
        ctx.fillStyle = '#292524';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        return;
      }
      if (theme === 'hq') {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = '#334155';
        ctx.fillRect(w.x, w.y, w.w, Math.min(8, w.h));
        return;
      }
      ctx.fillStyle = '#3f2e22';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(w.x, w.y, w.w, Math.min(8, w.h));
      if (w.y <= 1 && w.w > 80) {
        for (let x = w.x + 24; x < w.x + w.w - 40; x += 90) this.drawWindow(x, w.y + 6, 36, Math.max(12, w.h - 12));
      }
    }

    drawZone(z) {
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = z.color || '#94a3b8';
      ctx.globalAlpha = 0.9;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(z.x + 0.5, z.y + 0.5, z.w - 1, z.h - 1);
      ctx.setLineDash([]);
      const label = z.label || '';
      ctx.font = '12px sans-serif';
      const tw = Math.ceil(ctx.measureText(label).width);
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
      ctx.fillRect(z.x + 6, z.y + 6, tw + 12, 18);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(label, z.x + 12, z.y + 19);
      ctx.restore();
    }

    drawDoor(d, m) {
      const ctx = this.ctx;
      const hot = (this.hover && this.hover.type === 'door' && this.hover.id === d.id)
        || (this.near && this.near.type === 'door' && this.near.id === d.id);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(d.x - 4, d.y - 4, d.w + 8, d.h + 8);
      const glow = this.fillStops(d.x, d.y, d.x, d.y + d.h, [[0, hot ? '#7dd3fc' : '#38bdf8'], [1, '#0369a1']]);
      ctx.fillStyle = glow;
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.strokeStyle = hot ? '#fef9c3' : 'rgba(255,255,255,0.7)';
      ctx.lineWidth = hot ? 3 : 1.5;
      ctx.strokeRect(d.x, d.y, d.w, d.h);
      ctx.fillStyle = '#fef3c7';
      ctx.beginPath();
      ctx.arc(d.x + d.w - 8, d.y + d.h / 2, 3, 0, Math.PI * 2);
      ctx.fill();
      const doorLabel = d.label || tr('scene.door', null, '门');
      ctx.font = 'bold 12px sans-serif';
      const doorW = ctx.measureText(doorLabel).width;
      let doorX = d.x;
      if (doorX + doorW > m.width - 8) doorX = Math.max(8, m.width - doorW - 8);
      const labelY = d.y > 24 ? d.y - 6 : d.y + d.h + 14;
      ctx.fillStyle = 'rgba(15,23,42,0.85)';
      ctx.fillRect(doorX - 4, labelY - 12, doorW + 8, 16);
      ctx.fillStyle = '#e0f2fe';
      ctx.fillText(doorLabel, doorX, labelY);
    }

    itemState(it) {
      const viewed = (this.progress.viewed || []).includes(it.id);
      const got = (it.evidenceIds || []).some((eid) => (this.progress.evidence || []).some((e) => e.id === eid));
      return { viewed, got, color: got ? '#4ade80' : viewed ? '#facc15' : '#fb923c' };
    }

    drawItem(it) {
      const ctx = this.ctx;
      const st = this.itemState(it);
      const hot = (this.hover && this.hover.type === 'item' && this.hover.id === it.id)
        || (this.near && this.near.type === 'item' && this.near.id === it.id);
      const pulse = 0.55 + Math.sin((this.fxTime || 0) * 4 + it.x) * 0.25;
      ctx.save();
      ctx.strokeStyle = st.color;
      ctx.globalAlpha = hot ? 1 : pulse;
      ctx.lineWidth = hot ? 3 : 2;
      ctx.shadowColor = st.color;
      ctx.shadowBlur = hot ? 16 : 8;
      const pad = hot ? 7 : 4;
      ctx.strokeRect(it.x - pad, it.y - pad, it.w + pad * 2, it.h + pad * 2);
      ctx.restore();
      this.drawProp(it);
      if (!st.got) {
        ctx.fillStyle = st.color;
        ctx.beginPath();
        ctx.arc(it.x + it.w - 2, it.y + 2, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('!', it.x + it.w - 5, it.y + 6);
      }
      if (hot) {
        ctx.font = '12px sans-serif';
        const tw = Math.ceil(ctx.measureText(it.name || '').width);
        const lx = Math.max(4, Math.min(it.x, (this.map.width || 800) - tw - 12));
        ctx.fillStyle = 'rgba(15,23,42,0.9)';
        ctx.fillRect(lx, it.y - 22, tw + 10, 16);
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(it.name || '', lx + 5, it.y - 10);
      }
    }

    drawProp(it) {
      const ctx = this.ctx;
      const x = it.x;
      const y = it.y;
      const w = it.w;
      const h = it.h;
      const id = it.id;
      if (id === 'carA' || id === 'carB') {
        const color = id === 'carA' ? '#2563eb' : '#9ca3af';
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(x + 2, y - 3, 8, 6);
        ctx.fillRect(x + w - 10, y - 3, 8, 6);
        ctx.fillRect(x + 2, y + h - 3, 8, 6);
        ctx.fillRect(x + w - 10, y + h - 3, 8, 6);
        ctx.fillStyle = color;
        ctx.fillRect(x + 6, y, w - 12, h);
        ctx.fillStyle = 'rgba(224,242,254,0.85)';
        ctx.fillRect(x + 10, y + 4, w * 0.35, h - 8);
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(x + w - 10, y + 4, 4, 6);
        ctx.fillRect(x + w - 10, y + h - 10, 4, 6);
        return;
      }
      if (id === 'sign') {
        ctx.fillStyle = '#57534e';
        ctx.fillRect(x + w / 2 - 2, y + 16, 4, h - 14);
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(x + w / 2, y + 14, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('50', x + w / 2, y + 18);
        ctx.textAlign = 'left';
        return;
      }
      if (id === 'skid') {
        ctx.strokeStyle = '#e7e5e4';
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(x, y + 8, w, h - 8);
        ctx.setLineDash([]);
        ctx.fillStyle = '#44403c';
        ctx.fillRect(x + w - 4, y, 3, h);
        ctx.fillStyle = '#ea580c';
        ctx.fillRect(x + w - 14, y, 12, 8);
        return;
      }
      if (id === 'logger' || id === 'whiteboard') {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(x, y + 6, w, h - 10);
        ctx.fillStyle = id === 'logger' ? '#052e16' : '#f8fafc';
        ctx.fillRect(x + 4, y + 10, w - 8, h - 20);
        ctx.fillStyle = id === 'logger' ? '#4ade80' : '#94a3b8';
        ctx.fillRect(x + 8, y + 16, w - 20, 3);
        ctx.fillRect(x + 8, y + 22, w - 28, 3);
        return;
      }
      if (id === 'calib' || id === 'report') {
        ctx.fillStyle = '#78350f';
        ctx.fillRect(x, y, w, h);
        ['#fef3c7', '#fecaca', '#dbeafe'].forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.fillRect(x + 6 + i * 12, y + 8, 8, h - 16);
        });
        return;
      }
      if (id === 'physicsDesk' || id === 'chemDesk') {
        ctx.fillStyle = '#44403c';
        ctx.fillRect(x, y + 10, w, h - 10);
        ctx.fillStyle = id === 'chemDesk' ? '#22c55e' : '#38bdf8';
        ctx.fillRect(x + 8, y, 10, 18);
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(x + w - 14, y + 12, 7, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      if (id === 'timelineBoard' || id === 'labReport') {
        ctx.fillStyle = '#b45309';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#fef3c7';
        ctx.fillRect(x + 6, y + 6, w - 12, h - 12);
        ctx.fillStyle = '#92400e';
        ctx.fillRect(x + 10, y + 12, w - 22, 3);
        ctx.fillRect(x + 10, y + 18, w - 28, 3);
        return;
      }
      if (id === 'cleanerShelf') {
        ctx.fillStyle = '#57534e';
        ctx.fillRect(x, y + h - 8, w, 8);
        ctx.fillRect(x, y + 8, w, 4);
        ['#22c55e', '#3b82f6', '#eab308', '#ef4444'].forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.fillRect(x + 4 + i * 11, y + 14, 8, 18);
        });
        return;
      }
      if (id === 'shoePrint') {
        ctx.fillStyle = 'rgba(254, 243, 199, 0.35)';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#e7e5e4';
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2 + 4, 8, 14, 0.4, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      if (id === 'cup') {
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, 12, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#7c2d12';
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, 7, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      if (id === 'medBox') {
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(x + 4, y + 6, w - 8, h - 10);
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + w / 2, y + 12);
        ctx.lineTo(x + w / 2, y + h - 12);
        ctx.moveTo(x + 12, y + h / 2);
        ctx.lineTo(x + w - 12, y + h / 2);
        ctx.stroke();
        return;
      }
      if (id === 'drain') {
        ctx.fillStyle = '#334155';
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h / 2, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#94a3b8';
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h / 2, 10, 0, Math.PI * 2);
        ctx.stroke();
        return;
      }
      ctx.fillStyle = '#fb923c';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText('?', x + w / 2 - 4, y + h / 2 + 5);
    }

    drawDestination() {
      if (!this.dest || !this.map) return;
      const ctx = this.ctx;
      const p = 0.45 + Math.sin((this.fxTime || 0) * 6) * 0.35;
      ctx.save();
      ctx.strokeStyle = `rgba(125, 211, 252, ${p})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(this.dest.x, this.dest.y, 12, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([4, 4]);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(this.player.x, this.player.y);
      ctx.lineTo(this.dest.x, this.dest.y);
      ctx.stroke();
      ctx.restore();
    }

    drawNpcAfford(s) {
      const ctx = this.ctx;
      const hot = (this.hover && (this.hover.type === 'npc' || this.hover.type === 'host') && this.hover.id === s.id)
        || (this.near && (this.near.type === 'npc' || this.near.type === 'host') && this.near.id === s.id);
      const talked = !s.host && (this.progress.interviewed || []).includes(s.id);
      ctx.save();
      ctx.strokeStyle = s.host ? '#fbbf24' : talked ? '#4ade80' : '#38bdf8';
      ctx.globalAlpha = hot ? 0.95 : 0.55;
      ctx.lineWidth = hot ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y + 16, hot ? 20 : 16, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (hot || s.host) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = s.host ? '#fef3c7' : '#e0f2fe';
        ctx.beginPath();
        ctx.arc(s.x + 16, s.y - 40, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(s.host ? '★' : '!', s.x + 12, s.y - 36);
      }
      ctx.restore();
    }


    drawMario(s) {
      const ctx = this.ctx;
      const bob = s.anim ? Math.sin(s.anim) * 2 : 0;
      const x = s.x;
      const y = s.y + bob;
      const face = s.facing === 'left' ? -1 : 1;
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(x, s.y + 16, 14, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // shoes
      ctx.fillStyle = '#78350f';
      ctx.fillRect(x - 12, y + 10, 10, 6);
      ctx.fillRect(x + 2, y + 10, 10, 6);
      // overalls
      ctx.fillStyle = '#1d4ed8';
      ctx.fillRect(x - 10, y - 2, 20, 14);
      // shirt
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(x - 10, y - 14, 20, 12);
      // hat
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(x - 12, y - 28, 24, 8);
      ctx.fillRect(x - 8, y - 34, 16, 8);
      // face
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(x, y - 20, 8, 0, Math.PI * 2);
      ctx.fill();
      // mustache + eye
      ctx.fillStyle = '#78350f';
      ctx.fillRect(x - 6 * face, y - 18, 10, 3);
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(x + 3 * face, y - 22, 1.5, 0, Math.PI * 2);
      ctx.fill();
      if (s.investigating > 0) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 18, y - 38, 36, 56);
      }
      this.paintName(s, s.y + 20);
    }

    paintShadow(x, groundY, rx) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(x, groundY, rx || 14, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    fillCircle(x, y, r) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    paintName(s, top) {
      const ctx = this.ctx;
      const text = s.label || '';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const tw = Math.ceil(ctx.measureText(text).width);
      ctx.fillStyle = 'rgba(15,23,42,0.82)';
      ctx.fillRect(s.x - tw / 2 - 4, top, tw + 8, 14);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(text, s.x, top + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    npcBob(s) {
      const bob = Math.sin(Date.now() / 480 + s.x * 0.015) * 1.2;
      return { x: s.x, y: s.y + bob };
    }

    drawSprite(s) {
      if (s.player) {
        this.drawMario(s);
        return;
      }
      this.drawNpcAfford(s);
      const draw = {
        luigi: this.drawLuigi,
        toad: this.drawToad,
        peach: this.drawPeach,
        yoshi: this.drawYoshi,
        wario: this.drawWario,
        koopa: this.drawKoopa,
        daisy: this.drawDaisy,
        toadette: this.drawToadette,
      }[s.sprite];
      if (draw) {
        draw.call(this, s);
        return;
      }
      this.drawFallbackBlob(s);
    }

    drawFallbackBlob(s) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y + 14, 12, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = s.color || '#94a3b8';
      ctx.beginPath();
      ctx.roundRect(s.x - 10, s.y - 18, 20, 28, 4);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x, s.y - 22, 8, 0, Math.PI * 2);
      ctx.fill();
      this.paintName(s, s.y + 18);
    }

    drawLuigi(s) {
      const ctx = this.ctx;
      const { x, y } = this.npcBob(s);
      this.paintShadow(x, s.y + 18, 13);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(x - 11, y + 12, 9, 6);
      ctx.fillRect(x + 2, y + 12, 9, 6);
      ctx.fillStyle = '#1d4ed8';
      ctx.fillRect(x - 10, y - 2, 20, 16);
      ctx.fillRect(x - 8, y - 10, 4, 10);
      ctx.fillRect(x + 4, y - 10, 4, 10);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x - 7, y + 2, 3, 3);
      ctx.fillRect(x + 4, y + 2, 3, 3);
      ctx.fillStyle = '#16a34a';
      ctx.fillRect(x - 10, y - 16, 20, 14);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(x - 15, y - 10, 5, 6);
      ctx.fillRect(x + 10, y - 10, 5, 6);
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.ellipse(x, y - 24, 7, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6b3a1a';
      ctx.fillRect(x - 6, y - 20, 10, 2);
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(x + 3, y - 26, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#15803d';
      ctx.fillRect(x - 12, y - 34, 24, 7);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(x - 8, y - 44, 16, 12);
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(x - 1, y - 42, 3, 7);
      ctx.fillRect(x - 1, y - 38, 7, 3);
      this.paintName(s, s.y + 22);
    }

    drawToad(s) {
      const ctx = this.ctx;
      const { x, y } = this.npcBob(s);
      this.paintShadow(x, s.y + 16, 16);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(x - 8, y + 8, 7, 5);
      ctx.fillRect(x + 1, y + 8, 7, 5);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(x - 7, y + 1, 14, 8);
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(x - 8, y - 8, 16, 10);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x - 2, y - 5, 4, 4);
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(x, y - 10, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      this.fillCircle(x - 3, y - 11, 2.2);
      this.fillCircle(x + 3, y - 11, 2.2);
      ctx.fillStyle = '#0f172a';
      this.fillCircle(x - 3, y - 11, 1);
      this.fillCircle(x + 3, y - 11, 1);
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.ellipse(x, y - 16, 18, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.ellipse(x, y - 26, 16, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      this.fillCircle(x - 7, y - 30, 3);
      this.fillCircle(x + 6, y - 27, 2.6);
      this.fillCircle(x - 1, y - 34, 2.2);
      this.paintName(s, s.y + 18);
    }

    drawPeach(s) {
      const ctx = this.ctx;
      const { x, y } = this.npcBob(s);
      this.paintShadow(x, s.y + 18, 16);
      ctx.fillStyle = '#f9a8d4';
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 6);
      ctx.lineTo(x + 9, y - 6);
      ctx.lineTo(x + 18, y + 16);
      ctx.lineTo(x - 18, y + 16);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fbcfe8';
      ctx.fillRect(x - 16, y + 12, 32, 4);
      ctx.fillStyle = '#f472b6';
      ctx.fillRect(x - 10, y - 16, 20, 12);
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(x, y - 10, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(x - 16, y - 12, 6, 5);
      ctx.fillRect(x + 10, y - 12, 6, 5);
      ctx.fillStyle = '#fde68a';
      ctx.fillRect(x - 12, y - 30, 6, 14);
      ctx.fillRect(x + 6, y - 30, 6, 14);
      ctx.fillRect(x - 8, y - 32, 16, 8);
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(x, y - 22, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      this.fillCircle(x - 3, y - 23, 1.2);
      this.fillCircle(x + 3, y - 23, 1.2);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(x - 9, y - 40, 18, 5);
      ctx.fillRect(x - 9, y - 46, 4, 8);
      ctx.fillRect(x - 2, y - 50, 4, 12);
      ctx.fillRect(x + 5, y - 46, 4, 8);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(x - 1, y - 48, 3, 3);
      ctx.fillStyle = '#fde68a';
      ctx.beginPath();
      ctx.arc(x, y - 52, 2, 0, Math.PI * 2);
      ctx.fill();
      this.paintName(s, s.y + 22);
    }

    drawYoshi(s) {
      const ctx = this.ctx;
      const { x, y } = this.npcBob(s);
      this.paintShadow(x + 2, s.y + 16, 18);
      ctx.fillStyle = '#ea580c';
      ctx.fillRect(x - 12, y + 10, 9, 6);
      ctx.fillRect(x + 2, y + 10, 9, 6);
      ctx.fillStyle = '#16a34a';
      ctx.beginPath();
      ctx.ellipse(x - 16, y + 2, 7, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.ellipse(x - 2, y - 2, 13, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.ellipse(x, y + 2, 7, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(x - 12, y - 10, 16, 7);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(x - 8, y - 8, 3, 3);
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.ellipse(x + 8, y - 16, 10, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + 18, y - 14, 8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#14532d';
      ctx.beginPath();
      ctx.arc(x + 20, y - 14, 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(x + 10, y - 18, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(x + 11, y - 18, 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 24);
      ctx.lineTo(x - 1, y - 32);
      ctx.lineTo(x + 2, y - 24);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 4, y - 24);
      ctx.lineTo(x + 7, y - 33);
      ctx.lineTo(x + 10, y - 24);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 12, y - 22);
      ctx.lineTo(x + 15, y - 30);
      ctx.lineTo(x + 18, y - 20);
      ctx.fill();
      this.paintName(s, s.y + 20);
    }

    drawWario(s) {
      const ctx = this.ctx;
      const { x, y } = this.npcBob(s);
      this.paintShadow(x, s.y + 18, 16);
      ctx.fillStyle = '#65a30d';
      ctx.fillRect(x - 14, y + 10, 12, 7);
      ctx.fillRect(x + 2, y + 10, 12, 7);
      ctx.fillStyle = '#7e22ce';
      ctx.fillRect(x - 13, y - 2, 26, 14);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x - 13, y - 12, 26, 12);
      ctx.fillRect(x - 4, y + 1, 3, 3);
      ctx.fillRect(x + 2, y + 1, 3, 3);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(x - 18, y - 8, 6, 6);
      ctx.fillRect(x + 12, y - 8, 6, 6);
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.ellipse(x, y - 20, 10, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fda4af';
      ctx.beginPath();
      ctx.arc(x + 4, y - 16, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#44403c';
      ctx.fillRect(x - 9, y - 16, 5, 3);
      ctx.fillRect(x - 5, y - 13, 5, 3);
      ctx.fillRect(x - 1, y - 16, 5, 3);
      ctx.fillRect(x + 3, y - 13, 6, 3);
      ctx.fillStyle = '#0f172a';
      this.fillCircle(x - 3, y - 22, 1.4);
      this.fillCircle(x + 4, y - 22, 1.4);
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(x - 10, y - 24);
      ctx.lineTo(x - 14, y - 18);
      ctx.lineTo(x - 8, y - 18);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 10, y - 24);
      ctx.lineTo(x + 14, y - 18);
      ctx.lineTo(x + 8, y - 18);
      ctx.fill();
      ctx.fillStyle = '#eab308';
      ctx.fillRect(x - 14, y - 32, 28, 8);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x - 10, y - 40, 20, 10);
      ctx.fillStyle = '#6b21a8';
      ctx.fillRect(x - 5, y - 38, 2, 6);
      ctx.fillRect(x - 3, y - 34, 2, 3);
      ctx.fillRect(x - 1, y - 38, 2, 6);
      ctx.fillRect(x + 1, y - 34, 2, 3);
      ctx.fillRect(x + 3, y - 38, 2, 6);
      this.paintName(s, s.y + 22);
    }

    drawKoopa(s) {
      const ctx = this.ctx;
      const { x, y } = this.npcBob(s);
      this.paintShadow(x, s.y + 16, 16);
      ctx.fillStyle = '#166534';
      ctx.beginPath();
      ctx.ellipse(x - 2, y - 4, 16, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fef9c3';
      ctx.beginPath();
      ctx.ellipse(x - 2, y - 4, 11, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#15803d';
      this.fillCircle(x - 6, y - 8, 3.2);
      this.fillCircle(x + 3, y - 2, 3.2);
      this.fillCircle(x - 4, y + 2, 2.6);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x + 4, y + 8, 8, 6);
      ctx.fillRect(x - 10, y + 8, 8, 6);
      ctx.beginPath();
      ctx.ellipse(x + 6, y + 2, 7, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.ellipse(x + 7, y + 3, 4, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(x + 8, y - 16, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.moveTo(x + 12, y - 14);
      ctx.lineTo(x + 22, y - 12);
      ctx.lineTo(x + 12, y - 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(x + 10, y - 18, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(x + 11, y - 18, 1.1, 0, Math.PI * 2);
      ctx.fill();
      this.paintName(s, s.y + 20);
    }

    drawDaisy(s) {
      const ctx = this.ctx;
      const { x, y } = this.npcBob(s);
      this.paintShadow(x, s.y + 16, 14);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(x - 8, y + 10, 7, 5);
      ctx.fillRect(x + 1, y + 10, 7, 5);
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.moveTo(x - 8, y - 4);
      ctx.lineTo(x + 8, y - 4);
      ctx.lineTo(x + 14, y + 12);
      ctx.lineTo(x - 14, y + 12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fed7aa';
      ctx.fillRect(x - 12, y + 8, 24, 4);
      ctx.fillStyle = '#ea580c';
      ctx.fillRect(x - 8, y - 14, 16, 11);
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(x, y - 9, 2.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(x - 14, y - 12, 5, 5);
      ctx.fillRect(x + 9, y - 12, 5, 5);
      ctx.fillStyle = '#92400e';
      ctx.fillRect(x - 11, y - 28, 5, 12);
      ctx.fillRect(x + 6, y - 28, 5, 12);
      ctx.fillRect(x - 7, y - 30, 14, 7);
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(x, y - 20, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#22c55e';
      this.fillCircle(x - 8, y - 20, 1.6);
      this.fillCircle(x + 8, y - 20, 1.6);
      ctx.fillStyle = '#0f172a';
      this.fillCircle(x - 3, y - 21, 1.2);
      this.fillCircle(x + 3, y - 21, 1.2);
      const petals = [
        [0, -46],
        [-6, -42],
        [6, -42],
        [-4, -36],
        [4, -36],
      ];
      ctx.fillStyle = '#f8fafc';
      petals.forEach(([dx, dy]) => {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, 3.3, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(x, y - 41, 2.6, 0, Math.PI * 2);
      ctx.fill();
      this.paintName(s, s.y + 20);
    }

    drawToadette(s) {
      const ctx = this.ctx;
      const { x, y } = this.npcBob(s);
      this.paintShadow(x, s.y + 16, 15);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(x - 7, y + 8, 6, 5);
      ctx.fillRect(x + 1, y + 8, 6, 5);
      ctx.fillStyle = '#f9a8d4';
      ctx.beginPath();
      ctx.moveTo(x - 7, y - 4);
      ctx.lineTo(x + 7, y - 4);
      ctx.lineTo(x + 12, y + 10);
      ctx.lineTo(x - 12, y + 10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fbcfe8';
      ctx.fillRect(x - 6, y - 8, 12, 6);
      ctx.fillStyle = '#be185d';
      ctx.fillRect(x - 14, y - 6, 4, 5);
      ctx.fillRect(x + 10, y - 6, 4, 5);
      ctx.fillStyle = '#9a3412';
      ctx.fillRect(x - 15, y - 16, 4, 14);
      ctx.fillRect(x + 11, y - 16, 4, 14);
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(x, y - 10, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      this.fillCircle(x - 2.6, y - 11, 2);
      this.fillCircle(x + 2.6, y - 11, 2);
      ctx.fillStyle = '#0f172a';
      this.fillCircle(x - 2.6, y - 11, 1);
      this.fillCircle(x + 2.6, y - 11, 1);
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.ellipse(x, y - 15, 16, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ec4899';
      ctx.beginPath();
      ctx.ellipse(x, y - 24, 14, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      this.fillCircle(x - 6, y - 28, 2.6);
      this.fillCircle(x + 5, y - 25, 2.4);
      this.fillCircle(x, y - 32, 2);
      this.paintName(s, s.y + 18);
    }

    getPosition() {
      return { mapId: this.map ? this.map.id : null, x: this.player.x, y: this.player.y };
    }
  }

  // roundRect polyfill
  if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      this.moveTo(x + rr, y);
      this.arcTo(x + w, y, x + w, y + h, rr);
      this.arcTo(x + w, y + h, x, y + h, rr);
      this.arcTo(x, y + h, x, y, rr);
      this.arcTo(x, y, x + w, y, rr);
      this.closePath();
    };
  }

  const root = typeof window !== 'undefined' ? window : globalThis;
  root.GameEngine = GameEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = GameEngine;
})();
