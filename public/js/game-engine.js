/**
 * Reusable 2D classroom exploration engine.
 * Player is an original geometric Mario. Suspects/host use original geometric
 * Mario-universe silhouettes (not Nintendo spritesheets or ROM tiles).
 * Case content comes from JSON config; movement/UI/interview/vote are shared.
 */
(function () {
  const TILE = 1;
  const SPEED = 160;
  const PLAYER_R = 12;

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
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

    setMap(mapId, x, y) {
      const m = this.caseData.maps.find((mm) => mm.id === mapId);
      if (!m) return;
      this.map = m;
      this.canvas.width = m.width;
      this.canvas.height = m.height;
      this.player.x = x != null ? x : m.spawn.x;
      this.player.y = y != null ? y : m.spawn.y;
      this.near = null;
    }

    bindInput() {
      if (this._bound) return;
      this._bound = true;
      window.addEventListener('keydown', (e) => {
        if (this.inputBlocked) return;
        const k = e.key.toLowerCase();
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'e'].includes(k) || e.key === 'e' || e.key === 'E') {
          e.preventDefault();
        }
        this.keys[k] = true;
        if ((k === 'e') && !this.inputBlocked) this.tryInteract();
      });
      window.addEventListener('keyup', (e) => {
        this.keys[e.key.toLowerCase()] = false;
      });
    }

    setInputBlocked(v) {
      this.inputBlocked = !!v;
      if (v) this.keys = {};
    }

    tryInteract() {
      if (!this.near || this.inputBlocked || this.paused) return;
      this.player.investigating = 0.35;
      this.onInteract(this.near);
    }

    updateNear() {
      if (!this.map) return;
      const px = this.player.x;
      const py = this.player.y;
      const candidates = [];
      (this.map.items || []).forEach((it) => {
        const d = distPointRect(px, py, it);
        if (d < 36) candidates.push({ type: 'item', ref: it, d, label: `按 E 调查：${it.name}` });
      });
      (this.map.npcs || []).forEach((n) => {
        const d = Math.hypot(px - n.x, py - n.y);
        if (d < 42) {
          const isHost = n.id === 'host';
          const sus = isHost ? this.caseData.hostNpc : (this.caseData.suspects || []).find((s) => s.id === n.id);
          const name = sus ? sus.name : n.id;
          candidates.push({
            type: isHost ? 'host' : 'npc',
            ref: n,
            d,
            label: `按 E 交谈：${name}`,
            suspectId: n.id,
          });
        }
      });
      (this.map.doors || []).forEach((door) => {
        const d = distPointRect(px, py, door);
        if (d < 28) candidates.push({ type: 'door', ref: door, d, label: `按 E ${door.label || '进入'}` });
      });
      candidates.sort((a, b) => a.d - b.d);
      this.near = candidates[0] || null;
      this.onPrompt(this.near ? this.near.label : '');
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
      if (!this.map || this.inputBlocked || this.paused) {
        this.draw();
        return;
      }
      let dx = 0;
      let dy = 0;
      if (this.keys['w'] || this.keys['arrowup']) dy -= 1;
      if (this.keys['s'] || this.keys['arrowdown']) dy += 1;
      if (this.keys['a'] || this.keys['arrowleft']) dx -= 1;
      if (this.keys['d'] || this.keys['arrowright']) dx += 1;
      dx += this.touchDir.x;
      dy += this.touchDir.y;
      if (dx || dy) {
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        if (Math.abs(dx) > Math.abs(dy)) this.player.facing = dx > 0 ? 'right' : 'left';
        else this.player.facing = dy > 0 ? 'down' : 'up';
        this.player.anim += dt * 8;
        const nx = this.player.x + dx * SPEED * dt;
        const ny = this.player.y + dy * SPEED * dt;
        if (!this.collide(nx, this.player.y)) this.player.x = nx;
        if (!this.collide(this.player.x, ny)) this.player.y = ny;
      } else {
        this.player.anim = 0;
      }
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
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, m.width, m.height);
      this.drawSceneBackground(m);

      (m.zones || []).forEach((z) => {
        ctx.fillStyle = z.color || '#334155';
        ctx.globalAlpha = 0.45;
        ctx.fillRect(z.x, z.y, z.w, z.h);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '12px sans-serif';
        ctx.fillText(z.label || '', z.x + 6, z.y + 16);
      });

      (m.walls || []).forEach((w) => {
        ctx.fillStyle = '#475569';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = 'rgba(15,23,42,0.35)';
        ctx.fillRect(w.x, w.y + w.h - 6, w.w, 6);
      });

      (m.doors || []).forEach((d) => {
        ctx.fillStyle = '#0ea5e9';
        ctx.fillRect(d.x, d.y, d.w, d.h);
        ctx.fillStyle = '#e0f2fe';
        ctx.font = '11px sans-serif';
        ctx.fillText(d.label || '门', d.x, d.y - 4);
      });

      (m.items || []).forEach((it) => {
        const viewed = (this.progress.viewed || []).includes(it.id);
        const got = (it.evidenceIds || []).some((eid) => (this.progress.evidence || []).some((e) => e.id === eid));
        ctx.fillStyle = got ? '#22c55e' : viewed ? '#eab308' : '#f97316';
        ctx.fillRect(it.x, it.y, it.w, it.h);
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(it.x, it.y, it.w, it.h);
        // simple icon
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText('?', it.x + it.w / 2 - 4, it.y + it.h / 2 + 5);
      });

      // NPCs (drawn before player for simple occlusion when below)
      const sprites = [];
      (m.npcs || []).forEach((n) => {
        const isHost = n.id === 'host';
        const sus = isHost ? this.caseData.hostNpc : (this.caseData.suspects || []).find((s) => s.id === n.id);
        sprites.push({
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
        label: '马里奥',
        player: true,
        facing: this.player.facing,
        anim: this.player.anim,
        investigating: this.player.investigating,
      });
      sprites.sort((a, b) => a.y - b.y);
      sprites.forEach((s) => this.drawSprite(s));

      // map title
      ctx.fillStyle = 'rgba(15,23,42,0.8)';
      ctx.fillRect(8, 8, 220, 28);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(m.name, 16, 28);
    }

    drawSceneBackground(m) {
      const ctx = this.ctx;
      const id = m.id || '';
      const theme = m.theme || id;
      if (theme === 'road') {
        // dusk sky
        const sky = ctx.createLinearGradient(0, 0, 0, m.height);
        sky.addColorStop(0, '#1e3a5f');
        sky.addColorStop(0.45, '#3b4d6b');
        sky.addColorStop(0.45, '#2d3748');
        sky.addColorStop(1, '#1a202c');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, m.width, m.height);
        // asphalt road band
        ctx.fillStyle = '#374151';
        ctx.fillRect(0, m.height * 0.42, m.width, m.height * 0.38);
        ctx.strokeStyle = '#fbbf24';
        ctx.setLineDash([18, 16]);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, m.height * 0.61);
        ctx.lineTo(m.width, m.height * 0.61);
        ctx.stroke();
        ctx.setLineDash([]);
        // sidewalk / shoulder
        ctx.fillStyle = '#4b5563';
        ctx.fillRect(0, m.height * 0.38, m.width, 18);
        ctx.fillRect(0, m.height * 0.8, m.width, 22);
        // street lights glow
        for (let i = 0; i < 4; i++) {
          const lx = 80 + i * 180;
          ctx.fillStyle = 'rgba(253, 224, 71, 0.15)';
          ctx.beginPath();
          ctx.arc(lx, m.height * 0.4, 40, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#9ca3af';
          ctx.fillRect(lx - 3, m.height * 0.22, 6, m.height * 0.18);
        }
        // bus stop hint
        ctx.fillStyle = '#64748b';
        ctx.fillRect(m.width - 140, m.height * 0.28, 90, 50);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '12px sans-serif';
        ctx.fillText('公交站', m.width - 120, m.height * 0.28 - 6);
      } else if (theme === 'hq') {
        const g = ctx.createLinearGradient(0, 0, 0, m.height);
        g.addColorStop(0, '#1e293b');
        g.addColorStop(1, '#0f172a');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, m.width, m.height);
        // floor tiles
        for (let y = 40; y < m.height; y += 40) {
          for (let x = 0; x < m.width; x += 40) {
            ctx.fillStyle = ((x + y) / 40) % 2 ? '#1e293b' : '#243247';
            ctx.fillRect(x, y, 40, 40);
          }
        }
        // evidence wall board
        ctx.fillStyle = '#334155';
        ctx.fillRect(40, 50, 260, 120);
        ctx.strokeStyle = '#94a3b8';
        ctx.strokeRect(40, 50, 260, 120);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText('证据墙 / 物理工作台', 55, 75);
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = '#fef3c7';
          ctx.fillRect(55 + i * 70, 90, 55, 55);
        }
      } else if (theme === 'hall' || theme === 'corridor') {
        const g = ctx.createLinearGradient(0, 0, 0, m.height);
        g.addColorStop(0, '#2a1f18');
        g.addColorStop(1, '#1a120e');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, m.width, m.height);
        // wood floor
        for (let y = 0; y < m.height; y += 28) {
          ctx.fillStyle = y % 56 === 0 ? '#3f2a1e' : '#4a3224';
          ctx.fillRect(0, y, m.width, 28);
          ctx.strokeStyle = 'rgba(0,0,0,0.2)';
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(m.width, y);
          ctx.stroke();
        }
        // warm lamps
        ctx.fillStyle = 'rgba(251, 191, 36, 0.12)';
        ctx.fillRect(0, 0, m.width, 80);
      } else if (theme === 'kitchen') {
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(0, 0, m.width, m.height);
        ctx.fillStyle = '#374151';
        ctx.fillRect(0, m.height * 0.55, m.width, m.height * 0.45);
        // cabinets
        ctx.fillStyle = '#4b5563';
        for (let i = 0; i < 5; i++) ctx.fillRect(40 + i * 90, 60, 70, 90);
        ctx.fillStyle = '#9ca3af';
        ctx.fillRect(40, 160, 420, 16);
      } else if (theme === 'bath') {
        const g = ctx.createLinearGradient(0, 0, 0, m.height);
        g.addColorStop(0, '#0c4a6e');
        g.addColorStop(1, '#082f49');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, m.width, m.height);
        // tiles
        for (let y = 0; y < m.height; y += 32) {
          for (let x = 0; x < m.width; x += 32) {
            ctx.strokeStyle = 'rgba(125, 211, 252, 0.25)';
            ctx.strokeRect(x, y, 32, 32);
          }
        }
        // tub hint
        ctx.fillStyle = '#bae6fd';
        ctx.globalAlpha = 0.35;
        ctx.fillRect(m.width * 0.55, m.height * 0.45, 180, 90);
        ctx.globalAlpha = 1;
      } else {
        const grad = ctx.createLinearGradient(0, 0, m.width, m.height);
        grad.addColorStop(0, '#1a2332');
        grad.addColorStop(1, '#0f172a');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, m.width, m.height);
      }
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
  if (!CanvasRenderingContext2D.prototype.roundRect) {
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

  window.GameEngine = GameEngine;
})();
