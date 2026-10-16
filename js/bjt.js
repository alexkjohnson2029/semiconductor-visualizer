/*
 * Bipolar junction transistor view (npn / pnp), Pierret Ch. 10 and 11.
 *
 * Draws the emitter–base–collector band diagram with both depletion regions,
 * quasi-Fermi levels, the neutral base width W, the minority-carrier profiles
 * and the electric field, and animates the carriers: injection from the
 * emitter, diffusion across the base, collection by the collector field,
 * back-injection into the emitter and recombination in the base.
 *
 * Shares the canvas with SV.Diagram; only one of them draws at a time.
 */
window.SV = window.SV || {};

SV.BJTView = (function () {
  const C = SV.COLORS;
  const { drawMath, measureMath, niceStep, makeSprite, UI_STACK } = SV.draw;
  const rand = Math.random;
  const lifespan = () => { const life = 8 + rand() * 10; return { life, age: rand() * life }; };
  const EI = 'rgba(225, 232, 255, 0.55)';

  /* visible particle rate (per second) for a current density in A/cm^2 */
  const rate = (J) => (J > 1e-7 ? 5 * Math.min(1, (Math.log10(J) + 7) / 9) : 0);

  class BJTView {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.layer = document.createElement('canvas');
      this.lctx = this.layer.getContext('2d');
      this.top = document.createElement('canvas');
      this.tctx = this.top.getContext('2d');
      this.model = null;
      this.opts = {};
      this.view = null;
      this.viewTarget = null;
      this.dirty = true;
      this.particles = [];
      this.events = [];
      this.acc = {};
      this.seedKey = '';
      this.boxes = [];
      this.hoverPx = null;
      this.hoverParticle = null;
      this.sprites = { e: makeSprite('92, 200, 255', false), h: makeSprite('255, 107, 139', true) };
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = Math.max(320, r.width);
      this.h = Math.max(320, r.height);
      for (const c of [this.layer, this.top]) {
        c.width = Math.round(this.w * this.dpr);
        c.height = Math.round(this.h * this.dpr);
      }
      this.dirty = true;
    }

    setModel(model, opts) {
      const prev = this.model;
      this.model = model;
      this.opts = opts;
      this.dirty = true;
      const key = [model.npn, model.mat.key, model.T, model.NE, model.NB, model.NC, model.WB].join('|');
      if (key !== this.seedKey || !prev) {
        this.seedKey = key;
        this.viewTarget = null;
        this.seed();
      }
    }

    /* ---------- geometry ---------- */
    geometry() {
      const w = this.w, h = this.h, m = this.model;
      const narrow = w < 640;
      const sideLabels = !narrow;
      const left = narrow ? 46 : 118, right = narrow ? 58 : 92;
      const laneTop = 8, laneH = 54;
      const axisH = 34;
      const stripH = Math.round(Math.max(44, Math.min(74, h * 0.1)));
      const gap = 14;
      const bandTop = laneTop + laneH;
      const bandBot = h - axisH - 2 * stripH - 2 * gap - 6;
      const plotL = left, plotR = w - right;
      const geo = {
        narrow, sideLabels, plotL, plotR, plotW: plotR - plotL, laneTop, laneH,
        bandTop, bandBot, bandH: bandBot - bandTop,
        minTop: bandBot + gap, minBot: bandBot + gap + stripH,
        efTop: bandBot + 2 * gap + stripH, efBot: bandBot + 2 * gap + 2 * stripH,
        axisY: h - axisH + 6, bottom: bandBot + 2 * gap + 2 * stripH,
        tickX: sideLabels ? plotL - 70 : plotL - 10
      };
      const xr = m.xMax - m.xMin;
      geo.X = (x) => plotL + (x - m.xMin) / xr * geo.plotW;
      geo.xOf = (px) => m.xMin + (px - plotL) / geo.plotW * xr;
      const v = this.view;
      geo.Y = (E) => bandTop + (v.eTop - E) / (v.eTop - v.eBot) * geo.bandH;
      return geo;
    }

    sampleXs(n) {
      const m = this.model, xs = [];
      for (let i = 0; i <= n; i++) xs.push(m.xMin + (m.xMax - m.xMin) * i / n);
      xs.push(m.xEl, 0, m.xBl, m.xBr, m.WB, m.xCr);
      return xs.filter((x) => x >= m.xMin && x <= m.xMax).sort((a, b) => a - b);
    }

    /* energy window with hysteresis (see Diagram.targetView) */
    targetView() {
      const m = this.model;
      let top = -Infinity, bot = Infinity;
      for (const x of this.sampleXs(80)) { top = Math.max(top, m.Ec(x)); bot = Math.min(bot, m.Ev(x)); }
      const span = top - bot;
      const t = this.viewTarget;
      if (!t) { this.viewTarget = { eTop: top + span * 0.17, eBot: bot - span * 0.17 }; return this.viewTarget; }
      const ok = (room) => room > span * 0.08 && room < span * 0.5;
      if (ok(t.eTop - top) && ok(bot - t.eBot)) return t;
      this.viewTarget = {
        eTop: ok(t.eTop - top) ? t.eTop : top + span * (t.eTop - top <= span * 0.08 ? 0.28 : 0.17),
        eBot: ok(bot - t.eBot) ? t.eBot : bot - span * (bot - t.eBot <= span * 0.08 ? 0.28 : 0.17)
      };
      return this.viewTarget;
    }

    frame(dt) {
      if (!this.model || !this.w) return;
      const tv = this.targetView();
      if (!this.view) this.view = { ...tv };
      else {
        const k = 1 - Math.exp(-dt * 4);
        const d1 = tv.eTop - this.view.eTop, d2 = tv.eBot - this.view.eBot;
        if (Math.abs(d1) + Math.abs(d2) > (tv.eTop - tv.eBot) * 2e-4) {
          this.view = { eTop: this.view.eTop + d1 * k, eBot: this.view.eBot + d2 * k };
          this.dirty = true;
        }
      }
      const geo = this.geometry();
      this.geo = geo;
      if (this.dirty) { this.drawStatic(geo); this.dirty = false; }
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.drawImage(this.layer, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.opts.carriers) {
        this.step(Math.min(dt, 0.05) * (this.hoverParticle ? 0.25 : 1));
        this.drawParticles(ctx, geo);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.top, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.hoverPx != null) this.drawCrosshair(ctx, geo);
    }

    /* ---------- static layer ---------- */
    drawStatic(geo) {
      const m = this.model, o = this.opts;
      for (const c of [this.lctx, this.tctx]) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, this.layer.width, this.layer.height);
        c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        c.lineJoin = 'round'; c.lineCap = 'round';
      }
      let ctx = this.lctx;
      const xs = this.sampleXs(Math.max(300, Math.round(geo.plotW / 2)));
      this.drawEnergyAxis(ctx, geo);
      this.drawRegions(ctx, geo);
      this.drawBandFills(ctx, geo, xs);

      ctx.save();
      ctx.setLineDash([5, 6]); ctx.strokeStyle = C.ei; ctx.lineWidth = 1.2;
      this.path(ctx, xs, m.Ei, geo); ctx.stroke();
      ctx.restore();

      if (m.opMode === 'equilibrium') {
        this.glow(ctx, xs, () => 0, geo, C.ef, C.efGlow, 1.6);
      } else if (o.quasi) {
        const clip = (f) => (x) => Math.max(this.view.eBot - 1, Math.min(this.view.eTop + 1, f(x)));
        ctx.save();
        ctx.beginPath(); ctx.rect(geo.plotL, geo.bandTop, geo.plotW, geo.bandH); ctx.clip();
        ctx.setLineDash([9, 6]); ctx.lineWidth = 1.7; ctx.shadowBlur = 8;
        ctx.shadowColor = C.fp; ctx.strokeStyle = C.fp;
        this.path(ctx, xs, clip(m.FP), geo); ctx.stroke();
        ctx.shadowColor = C.fn; ctx.strokeStyle = C.fn; ctx.lineDashOffset = 7;
        this.path(ctx, xs, clip(m.FN), geo); ctx.stroke();
        ctx.restore();
      } else {
        this.glow(ctx, xs.filter((x) => x <= m.xEl), () => m.FE, geo, C.ef, C.efGlow, 1.6);
        this.glow(ctx, xs.filter((x) => x >= m.xBl && x <= m.xBr), () => m.FB, geo, C.ef, C.efGlow, 1.6);
        this.glow(ctx, xs.filter((x) => x >= m.xCr), () => m.FC, geo, C.ef, C.efGlow, 1.6);
      }
      this.glow(ctx, xs, m.Ec, geo, C.band, C.bandGlow, 2.2);
      this.glow(ctx, xs, m.Ev, geo, C.band, C.bandGlow, 2.2);
      this.drawContacts(ctx, geo);

      ctx = this.tctx;
      this.boxes = [];
      for (const x of [m.xBl, m.xBr]) this.boxes.push({ x: geo.X(x) - 20, y: geo.bandBot - 24, w: 40, h: 22 });
      if (o.diffs) this.annotate(ctx, geo);
      if (o.flows) this.drawFlows(ctx, geo);
      this.drawLane(ctx, geo);
      this.drawLineLabels(ctx, geo);
      this.drawStrips(ctx, geo);
      this.drawXAxis(ctx, geo);
    }

    path(ctx, xs, f, geo) {
      ctx.beginPath();
      xs.forEach((x, i) => { const px = geo.X(x), py = geo.Y(f(x)); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    }

    glow(ctx, xs, f, geo, core, glowColor, width) {
      if (!xs.length) return;
      ctx.save();
      ctx.strokeStyle = glowColor; ctx.globalAlpha = 0.55; ctx.lineWidth = width * 2.4;
      ctx.shadowColor = glowColor; ctx.shadowBlur = 22;
      this.path(ctx, xs, f, geo); ctx.stroke();
      ctx.globalAlpha = 1; ctx.shadowBlur = 9; ctx.lineWidth = width; ctx.strokeStyle = core;
      this.path(ctx, xs, f, geo); ctx.stroke();
      ctx.restore();
    }

    drawBandFills(ctx, geo, xs) {
      const m = this.model;
      const fill = (f, edge, color0) => {
        ctx.save();
        this.path(ctx, xs, f, geo);
        ctx.lineTo(geo.X(xs[xs.length - 1]), edge); ctx.lineTo(geo.X(xs[0]), edge); ctx.closePath();
        const ref = geo.Y(f(xs[Math.floor(xs.length / 2)]));
        const g = ctx.createLinearGradient(0, ref, 0, edge);
        g.addColorStop(0, color0); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fill();
        ctx.restore();
      };
      fill(m.Ec, geo.bandTop, 'rgba(92, 200, 255, 0.075)');
      fill(m.Ev, geo.bandBot, 'rgba(255, 107, 139, 0.065)');
    }

    drawEnergyAxis(ctx, geo) {
      const v = this.view;
      const step = niceStep(v.eTop - v.eBot, geo.bandH > 360 ? 7 : 5);
      ctx.save();
      ctx.font = `500 11px ${UI_STACK}`;
      ctx.fillStyle = C.faint; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let e = Math.ceil(v.eBot / step) * step; e <= v.eTop + 1e-9; e += step) {
        const y = geo.Y(e);
        if (y < geo.bandTop + 4 || y > geo.bandBot - 4) continue;
        ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(geo.plotL, y); ctx.lineTo(geo.plotR, y); ctx.stroke();
        const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
        ctx.fillText((Math.abs(e) < step / 1000 ? 0 : e).toFixed(dec).replace('-', '−'), geo.tickX, y);
      }
      ctx.restore();
      ctx.save();
      ctx.translate(geo.narrow ? 12 : 16, (geo.bandTop + geo.bandBot) / 2);
      ctx.rotate(-Math.PI / 2);
      drawMath(ctx, 'E `(eV)`', 0, 0, { size: 14, color: C.dim, align: 'center' });
      ctx.restore();
    }

    /* depletion regions (violet) and a faint tint on the neutral base */
    drawRegions(ctx, geo) {
      const m = this.model;
      ctx.save();
      ctx.fillStyle = 'rgba(255, 200, 87, 0.035)';
      ctx.fillRect(geo.X(m.xBl), geo.bandTop, geo.X(m.xBr) - geo.X(m.xBl), geo.bottom - geo.bandTop);
      for (const [a, b] of [[m.xEl, m.xBl], [m.xBr, m.xCr]]) {
        const x1 = geo.X(a), x2 = geo.X(b);
        const g = ctx.createLinearGradient(0, geo.laneTop, 0, geo.bottom);
        g.addColorStop(0, 'rgba(182, 156, 255, 0.10)');
        g.addColorStop(0.5, 'rgba(182, 156, 255, 0.05)');
        g.addColorStop(1, 'rgba(182, 156, 255, 0.07)');
        ctx.fillStyle = g;
        ctx.fillRect(x1, geo.bandTop, x2 - x1, geo.bottom - geo.bandTop);
        ctx.setLineDash([3, 5]); ctx.strokeStyle = 'rgba(182, 156, 255, 0.55)'; ctx.lineWidth = 1;
        for (const x of [x1, x2]) { ctx.beginPath(); ctx.moveTo(x, geo.bandTop); ctx.lineTo(x, geo.bottom); ctx.stroke(); }
      }
      ctx.setLineDash([1, 4]); ctx.strokeStyle = 'rgba(232, 236, 248, 0.22)';
      for (const x of [0, m.WB]) { const px = geo.X(x); ctx.beginPath(); ctx.moveTo(px, geo.bandTop); ctx.lineTo(px, geo.bottom); ctx.stroke(); }
      ctx.restore();
    }

    drawContacts(ctx, geo) {
      const m = this.model;
      ctx.save();
      for (const x of [m.xMin, m.xMax]) {
        const px = geo.X(x);
        const g = ctx.createLinearGradient(px - 5, 0, px + 5, 0);
        g.addColorStop(0, 'rgba(200, 210, 235, 0.05)'); g.addColorStop(0.5, 'rgba(200, 210, 235, 0.35)'); g.addColorStop(1, 'rgba(200, 210, 235, 0.05)');
        ctx.fillStyle = g; ctx.fillRect(px - 4, geo.bandTop, 8, geo.bandH);
      }
      ctx.restore();
    }

    /* ---------- labels ---------- */
    fits(r, geo) { return r.x >= geo.plotL - 2 && r.x + r.w <= geo.plotR + 6 && r.y >= geo.bandTop - 6 && r.y + r.h <= geo.bandBot + 6; }
    hits(r) { return this.boxes.some((b) => r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y); }
    placeLabel(ctx, src, x, y, opt, geo) {
      const size = opt.size || 13;
      const { w } = measureMath(ctx, src, size);
      const sx = opt.align === 'right' ? x - w : opt.align === 'center' ? x - w / 2 : x;
      const r = { x: sx - 6, y: y - size * 0.85, w: w + 12, h: size * 1.3 };
      if (!opt.force && (!this.fits(r, geo) || this.hits(r))) return null;
      drawMath(ctx, src, x, y, { ...opt, size, pill: opt.pill !== false });
      this.boxes.push(r);
      return r;
    }

    dimension(ctx, x, E1, E2, label, geo, opt = {}) {
      const y1 = geo.Y(E1), y2 = geo.Y(E2);
      const top = Math.min(y1, y2), bot = Math.max(y1, y2);
      if (bot - top < 4) return null;
      const color = opt.color || 'rgba(232, 236, 248, 0.85)';
      const size = (opt.size || 14) * (geo.narrow ? 0.88 : 1);
      const { w } = measureMath(ctx, label, size);
      const ly = opt.labelY != null ? opt.labelY : (top + bot) / 2 + 5;
      const rectFor = (side) => side === 'right'
        ? { x: x + 3, y: ly - size * 0.9, w: w + 20, h: size * 1.35 }
        : { x: x - w - 23, y: ly - size * 0.9, w: w + 20, h: size * 1.35 };
      let side = opt.side || 'right';
      const ok = (r) => this.fits(r, geo) && !this.hits(r);
      if (!ok(rectFor(side))) {
        const alt = side === 'right' ? 'left' : 'right';
        if (ok(rectFor(alt))) side = alt; else if (opt.optional) return null;
      }
      ctx.save();
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(x, top + 1); ctx.lineTo(x, bot - 1); ctx.stroke();
      const ah = Math.min(6, (bot - top) / 3);
      if (ah > 1.5) {
        for (const [y, d] of [[top, 1], [bot, -1]]) {
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3.2, y + d * ah); ctx.lineTo(x + 3.2, y + d * ah); ctx.closePath(); ctx.fill();
        }
      }
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(x - 6, top); ctx.lineTo(x + 6, top); ctx.moveTo(x - 6, bot); ctx.lineTo(x + 6, bot); ctx.stroke();
      ctx.restore();
      drawMath(ctx, label, side === 'right' ? x + 10 : x - 10, ly, { size, color: opt.textColor || C.text, align: side === 'right' ? 'left' : 'right', pill: true });
      this.boxes.push(rectFor(side), { x: x - 6, y: top, w: 12, h: bot - top });
      return side;
    }

    names() {
      const m = this.model;
      return m.npn
        ? { ve: 'V_{BE}', vr: 'V_{CB}', vce: 'V_{CE}', min: 'electrons', maj: 'holes', minOne: 'electron', majOne: 'hole', minSym: 'n', majSym: 'p', types: ['n', 'p', 'n'] }
        : { ve: 'V_{EB}', vr: 'V_{BC}', vce: 'V_{EC}', min: 'holes', maj: 'electrons', minOne: 'hole', majOne: 'electron', minSym: 'p', majSym: 'n', types: ['p', 'n', 'p'] };
    }

    annotate(ctx, geo) {
      const m = this.model, f = SV.fmt, nm = this.names();
      const edge = m.npn ? m.Ec : m.Ev;           // band the injected carriers travel in
      const sub = m.npn ? 'c' : 'v';
      // emitter barrier: band edge in the base vs in the emitter
      const xb = m.xBl + (m.xBr - m.xBl) * 0.18;
      const lblE = m.VE === 0 ? 'qV_{bi,E} = `' + f.eV(m.psiE) + '`' : 'q(V_{bi,E} − ' + nm.ve + ') = `' + f.eV(m.psiE) + '`';
      // dotted extension of the emitter band edge into the base
      ctx.save();
      ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(232, 236, 248, 0.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(geo.X(m.xEl), geo.Y(edge(m.xEl))); ctx.lineTo(geo.X(xb) + 6, geo.Y(edge(m.xEl))); ctx.stroke();
      ctx.restore();
      this.dimension(ctx, geo.X(xb), edge(m.xBl), edge(m.xEl), lblE, geo, { size: 14, side: 'right' });

      // collector barrier
      const xc = m.xCr + (m.xMax - m.xCr) * 0.3;
      const lblC = m.VR === 0 ? 'qV_{bi,C} = `' + f.eV(m.psiC) + '`' : 'q(V_{bi,C} + ' + nm.vr + ') = `' + f.eV(m.psiC) + '`';
      ctx.save();
      ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(232, 236, 248, 0.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(geo.X(m.xBr), geo.Y(edge(m.xBr))); ctx.lineTo(geo.X(xc) + 6, geo.Y(edge(m.xBr))); ctx.stroke();
      ctx.restore();
      this.dimension(ctx, geo.X(xc), edge(m.xBr), edge(m.xCr), lblC, geo, { size: 14, side: 'right' });

      // optional: band gap in the emitter, and E_F splits
      const xg = m.xMin + (m.xEl - m.xMin) * 0.2;
      this.dimension(ctx, geo.X(xg), m.Ec(xg), m.Ev(xg), 'E_g = `' + f.eV(m.fr.Eg, 2) + '`', geo, { optional: true, labelY: geo.Y(m.Ec(xg)) + 20 });
      if (this.opts.quasi && m.opMode !== 'equilibrium' && !geo.narrow) {
        const xq = m.xMin + (m.xEl - m.xMin) * 0.62;
        if (Math.abs(geo.Y(m.FE) - geo.Y(m.FB)) > 14) {
          this.dimension(ctx, geo.X(xq), m.FE, m.FB, 'q' + nm.ve + ' = `' + f.eV(Math.abs(m.VE), 2) + '`', geo,
            { color: 'rgba(255, 200, 87, 0.9)', size: 13, optional: true });
        }
      }
      void sub;
    }

    /* flow arrows: injection → base transport → collection, and back-injection */
    drawFlows(ctx, geo) {
      const m = this.model, nm = this.names();
      const injE = m.JEn > 0 ? m.JEn : 0, back = m.JEp > 0 ? m.JEp : 0, rec = Math.max(0, m.JrecB);
      const ref = Math.max(injE, back, 1e-300);
      const weight = (v) => (v <= 0 ? 0 : Math.max(0, Math.min(1, 1 + Math.log10(v / ref) / 6)));
      const g = m.npn ? 1 : -1;
      const edge = m.npn ? m.Ec : m.Ev, other = m.npn ? m.Ev : m.Ec;
      const off = (x) => geo.Y(edge(x)) - g * 14;
      if (injE > 0) {
        // over the emitter barrier, across the base, down into the collector
        const a = m.xEl - (m.xEl - m.xMin) * 0.35, b = m.xCr + (m.xMax - m.xCr) * 0.45;
        const yTop = Math.min(geo.Y(edge(m.xBl)), geo.Y(edge(m.xEl))) - (m.npn ? 14 : -14);
        const yOf = (x) => (x < m.xBl ? (m.npn ? Math.min(off(x), yTop) : Math.max(off(x), yTop)) : off(x));
        this.flowCurve(ctx, geo, a, m.xBl, yOf, 'diff', weight(injE));
        this.flowCurve(ctx, geo, m.xBl, m.xBr, yOf, 'diff', weight(m.JCn));
        this.flowCurve(ctx, geo, m.xBr, b, yOf, 'drift', weight(m.JCn));
        const lab = (src, color, x, y, align) => this.placeLabel(ctx, src, x, y, { size: 13, color, align }, geo);
        const yl = (x) => yOf(x) + (m.npn ? -10 : 22);
        lab('`injected`', C.diff, geo.X(a), yl(a), 'left');
        if (!lab('`diffuse across base`', C.diff, geo.X((m.xBl + m.xBr) / 2), yl((m.xBl + m.xBr) / 2), 'center')) {
          lab('`diffuse`', C.diff, geo.X((m.xBl + m.xBr) / 2), yl((m.xBl + m.xBr) / 2), 'center');
        }
        lab('`collected (drift)`', C.field, geo.X(b), yl(b), 'right');
      }
      if (back > 0) {
        const a = m.xBl + (m.xBr - m.xBl) * 0.3, b = m.xEl - (m.xEl - m.xMin) * 0.4;
        const yOf = (x) => geo.Y(other(x)) + g * 14;
        const yLow = m.npn ? Math.max(yOf(m.xBl), yOf(m.xEl)) : Math.min(yOf(m.xBl), yOf(m.xEl));
        const yc = (x) => (x < m.xBl ? (m.npn ? Math.max(yOf(x), yLow) : Math.min(yOf(x), yLow)) : yOf(x));
        this.flowCurve(ctx, geo, a, b, yc, 'diff', weight(back));
        this.placeLabel(ctx, '`' + nm.maj + ' back-injected`', geo.X(b), yc(b) + (m.npn ? 20 : -10), { size: 13, color: C.diff, align: 'left' }, geo);
      }
      if (rec > 0 && injE > 0) {
        // recombination in the base: a short vertical arrow between the bands
        const x = m.xBl + (m.xBr - m.xBl) * 0.62, px = geo.X(x);
        const y1 = geo.Y(edge(x)) + g * 8, y2 = geo.Y(other(x)) - g * 8;
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.65 * weight(rec);
        ctx.setLineDash([3, 3]);
        SV.BJTView.arrow(ctx, px, y1, px, y2, C.rgc, 1.4);
        ctx.restore();
        this.placeLabel(ctx, '`recombine`', px + 8, (y1 + y2) / 2 + 4, { size: 12, color: C.rgc, align: 'left' }, geo);
      }
    }

    flowStyle(ctx, kind, w) {
      const color = kind === 'diff' ? C.diff : C.field;
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.globalAlpha = 0.18 + 0.82 * w; ctx.lineWidth = 1 + 2.6 * w;
      ctx.shadowColor = color; ctx.shadowBlur = 6 * w;
      ctx.setLineDash(kind === 'drift' ? [7, 5] : []);
      return 6 + 4 * w;
    }

    flowCurve(ctx, geo, xa, xb, yOf, kind, w) {
      ctx.save();
      const hl = this.flowStyle(ctx, kind, w);
      const n = 50, pts = [];
      for (let i = 0; i <= n; i++) { const x = xa + (xb - xa) * i / n; pts.push([geo.X(x), yOf(x)]); }
      let cut = pts.length - 1, acc = 0;
      while (cut > 1 && acc < hl * 0.7) { acc += Math.hypot(pts[cut][0] - pts[cut - 1][0], pts[cut][1] - pts[cut - 1][1]); cut--; }
      ctx.beginPath();
      pts.slice(0, cut + 1).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      const [ex, ey] = pts[pts.length - 1], [qx, qy] = pts[Math.max(0, pts.length - 4)];
      const ang = Math.atan2(ey - qy, ex - qx);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - hl * Math.cos(ang - 0.5), ey - hl * Math.sin(ang - 0.5));
      ctx.lineTo(ex - hl * Math.cos(ang + 0.5), ey - hl * Math.sin(ang + 0.5));
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    /* region names, neutral base width W, field arrows */
    drawLane(ctx, geo) {
      const m = this.model, f = SV.fmt, nm = this.names();
      const t = nm.types;
      const dope = (type, N, ref) => type + (N >= 10 * ref ? '⁺' : '');
      ctx.save();
      ctx.font = `600 13px ${UI_STACK}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const y0 = geo.laneTop + 14;
      const items = [
        [(m.xMin + m.xEl) / 2, 'Emitter', dope(t[0], m.NE, m.NB), C.text],
        [(m.xBl + m.xBr) / 2, 'Base', t[1], C.ef],
        [(m.xCr + m.xMax) / 2, 'Collector', dope(t[2], m.NC, m.NB * 10), C.text]
      ];
      for (const [x, name, ty, color] of items) {
        const px = geo.X(x);
        const label = geo.narrow ? name[0] + ' (' + ty + ')' : name + ' (' + ty + ')';
        ctx.fillStyle = color;
        ctx.fillText(label, px, y0);
      }
      // neutral base width
      const x1 = geo.X(m.xBl), x2 = geo.X(m.xBr), yb = y0 + 10;
      ctx.strokeStyle = 'rgba(255, 200, 87, 0.75)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x1, yb + 6); ctx.lineTo(x1, yb); ctx.lineTo(x2, yb); ctx.lineTo(x2, yb + 6); ctx.stroke();
      ctx.restore();
      const wl = f.length(m.W);
      drawMath(ctx, 'W = `' + wl.v + ' ' + wl.u + '`', (x1 + x2) / 2, yb + 16, { size: 13, color: C.text, align: 'center', pill: true });
      this.boxes.push({ x: (x1 + x2) / 2 - 50, y: yb, w: 100, h: 20 });

      if (this.opts.field) {
        const ya = geo.laneTop + geo.laneH - 6;
        const Escale = Math.max(m.EmaxE, m.EmaxC, 1);
        for (const [a, b] of [[m.xEl, m.xBl], [m.xBr, m.xCr]]) {
          const pa = geo.X(a), pb = geo.X(b);
          const n = Math.max(1, Math.floor((pb - pa) / 30));
          for (let i = 0; i < n; i++) {
            const px = pa + (pb - pa) * (i + 0.5) / n;
            const E = m.field(geo.xOf(px));          // ℰ = (1/q) dE_i/dx
            const dir = Math.sign(E) || 1;
            const r = Math.min(1, Math.abs(E) / Escale);
            const len = Math.min(8 + 16 * r, Math.max(6, (pb - pa) / n - 4));
            ctx.save();
            ctx.globalAlpha = 0.35 + 0.65 * r;
            SV.BJTView.arrow(ctx, px - dir * len / 2, ya, px + dir * len / 2, ya, C.field, 1.6);
            ctx.restore();
          }
        }
      }
    }

    edgeLabels(ctx, geo, items, x, align) {
      items.forEach((it) => { it.y = geo.Y(it.E) + 5; });
      items.sort((a, b) => a.y - b.y);
      for (let pass = 0; pass < 5; pass++) {
        for (let i = 1; i < items.length; i++) {
          const d = items[i].y - items[i - 1].y;
          if (d < 17) { const s = (17 - d) / 2; items[i].y += s; items[i - 1].y -= s; }
        }
      }
      for (const it of items) drawMath(ctx, it.s, x, it.y, { size: 16, color: it.c, align });
    }

    drawLineLabels(ctx, geo) {
      const m = this.model, o = this.opts;
      const eq = m.opMode === 'equilibrium';
      const fc = (minor) => (eq || !o.quasi ? C.ef : minor);
      const majC = m.npn ? C.fn : C.fp;     // emitter/collector majority color
      const r = m.xMax, l = m.xMin;
      this.edgeLabels(ctx, geo, [
        { s: 'E_c', E: m.Ec(r), c: C.band },
        { s: 'E_i', E: m.Ei(r), c: 'rgba(225,232,255,0.7)' },
        { s: eq ? 'E_F' : (o.quasi ? (m.npn ? 'F_N' : 'F_P') : 'E_{FC}'), E: m.FC, c: fc(majC) },
        { s: 'E_v', E: m.Ev(r), c: C.band }
      ], geo.plotR + 12, 'left');
      if (geo.sideLabels) {
        this.edgeLabels(ctx, geo, [
          { s: 'E_c', E: m.Ec(l), c: C.band },
          { s: 'E_i', E: m.Ei(l), c: 'rgba(225,232,255,0.7)' },
          { s: eq ? 'E_F' : (o.quasi ? (m.npn ? 'F_N' : 'F_P') : 'E_{FE}'), E: m.FE, c: fc(majC) },
          { s: 'E_v', E: m.Ev(l), c: C.band }
        ], geo.plotL - 12, 'right');
      }
      if (!eq && !geo.narrow) {
        // name the base's majority quasi-Fermi level
        const xb = m.xBl + (m.xBr - m.xBl) * 0.82;
        const lab = o.quasi ? (m.npn ? 'F_P' : 'F_N') : 'E_{FB}';
        this.placeLabel(ctx, lab, geo.X(xb), geo.Y(m.FB) + (m.npn ? 17 : -8), { size: 14, color: o.quasi ? (m.npn ? C.fp : C.fn) : C.ef, align: 'center' }, geo);
      }
    }

    /* minority-carrier excess and electric field strips */
    drawStrips(ctx, geo) {
      const m = this.model, f = SV.fmt, nm = this.names();
      // excess minority carriers, each region on its own scale
      {
        const mid = (geo.minTop + geo.minBot) / 2, half = (geo.minBot - geo.minTop) / 2 - 3;
        ctx.save();
        ctx.strokeStyle = C.axis; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(geo.plotL, mid); ctx.lineTo(geo.plotR, mid); ctx.stroke();
        const baseCol = m.npn ? '92, 200, 255' : '255, 107, 139';
        const outCol = m.npn ? '255, 107, 139' : '92, 200, 255';
        const seg = (a, b, fn, peak, rgb) => {
          if (!(Math.abs(peak) > 0)) return;
          const n = 60;
          ctx.beginPath();
          ctx.moveTo(geo.X(a), mid);
          for (let i = 0; i <= n; i++) {
            const x = a + (b - a) * i / n;
            ctx.lineTo(geo.X(x), mid - half * fn(x) / Math.abs(peak));
          }
          ctx.lineTo(geo.X(b), mid);
          ctx.closePath();
          ctx.fillStyle = `rgba(${rgb}, 0.22)`; ctx.fill();
          ctx.strokeStyle = `rgb(${rgb})`; ctx.lineWidth = 1.5; ctx.shadowColor = `rgb(${rgb})`; ctx.shadowBlur = 6;
          ctx.beginPath();
          for (let i = 0; i <= n; i++) {
            const x = a + (b - a) * i / n, px = geo.X(x), py = mid - half * fn(x) / Math.abs(peak);
            if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
          }
          ctx.stroke(); ctx.shadowBlur = 0;
        };
        const peakB = Math.abs(m.dB0) > Math.abs(m.dBW) ? m.dB0 : m.dBW;
        seg(m.xBl, m.xBr, m.dBase, peakB, baseCol);
        // emitter and collector: only show injected excess, not the tiny reverse-bias deficit
        if (m.dE0 > 0) seg(m.xMin, m.xEl, m.dEm, m.dE0, outCol);
        if (m.dC0 > 0) seg(m.xCr, m.xMax, m.dCo, m.dC0, outCol);
        ctx.restore();
        drawMath(ctx, 'Δ' + nm.minSym + ', Δ' + nm.majSym, geo.plotL - 12, mid + 5, { size: 15, color: C.dim, align: 'right' });
        if (!geo.narrow) {
          const lab = (src, x, y, align, color) => drawMath(ctx, src, x, y, { size: 12, color, align, pill: true });
          const cB = m.npn ? C.electron : C.hole, cO = m.npn ? C.hole : C.electron;
          const sgn = (v) => (v < 0 ? '−' : '');
          if (m.dB0 !== 0) lab('Δ' + nm.minSym + '_B(0) = ' + sgn(m.dB0) + f.sciMath(Math.abs(m.dB0), Math.abs(m.dB0) >= 100 && Math.abs(m.dB0) < 1e4 ? 0 : 1, 'cm^{−3}'), geo.X(m.xBl) + 4, m.dB0 > 0 ? geo.minTop + 10 : geo.minBot - 2, 'left', cB);
          if (m.dE0 > 0) lab('Δ' + nm.majSym + '_E = ' + sgn(m.dE0) + f.sciMath(Math.abs(m.dE0), 1), geo.X(m.xEl) - 6, m.dE0 > 0 ? geo.minTop + 10 : geo.minBot - 2, 'right', cO);
          if (m.dC0 > 0) lab('Δ' + nm.majSym + '_C = ' + sgn(m.dC0) + f.sciMath(Math.abs(m.dC0), 1), geo.X(m.xCr) + 6, m.dC0 > 0 ? geo.minTop + 10 : geo.minBot - 2, 'left', cO);
          if (m.opMode === 'equilibrium') drawMath(ctx, '`no excess carriers in equilibrium`', (geo.plotL + geo.plotR) / 2, mid - 6, { size: 12, color: C.faint, align: 'center' });
        }
      }
      // electric field magnitude
      {
        const base = geo.efTop + 6, depth = geo.efBot - geo.efTop - 10;
        const Emax = Math.max(m.EmaxE, m.EmaxC, 1);
        ctx.save();
        ctx.strokeStyle = C.axis; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(geo.plotL, base); ctx.lineTo(geo.plotR, base); ctx.stroke();
        for (const [a, b] of [[m.xEl, m.xBl], [m.xBr, m.xCr]]) {
          const n = 50;
          ctx.beginPath(); ctx.moveTo(geo.X(a), base);
          for (let i = 0; i <= n; i++) { const x = a + (b - a) * i / n; ctx.lineTo(geo.X(x), base + depth * Math.abs(m.field(x)) / Emax); }
          ctx.lineTo(geo.X(b), base); ctx.closePath();
          const g = ctx.createLinearGradient(0, base, 0, base + depth);
          g.addColorStop(0, 'rgba(182, 156, 255, 0.05)'); g.addColorStop(1, 'rgba(182, 156, 255, 0.4)');
          ctx.fillStyle = g; ctx.fill();
          ctx.strokeStyle = C.field; ctx.lineWidth = 1.5; ctx.shadowColor = C.field; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;
        }
        ctx.restore();
        drawMath(ctx, '|ℰ|', geo.plotL - 12, base + depth / 2 + 6, { size: 16, color: C.field, align: 'right' });
        if (!geo.narrow) {
          const yE = base + depth * m.EmaxE / Emax, yC = base + depth * m.EmaxC / Emax;
          drawMath(ctx, f.sciMath(m.EmaxE, 1, 'V/cm'), geo.X(0) - 8, Math.max(base + 14, yE - 2), { size: 12, color: C.text, align: 'right', pill: true });
          drawMath(ctx, f.sciMath(m.EmaxC, 1, 'V/cm'), geo.X(m.WB) + 8, Math.max(base + 14, Math.min(yC - 2, base + depth)), { size: 12, color: C.text, align: 'left', pill: true });
        }
      }
    }

    drawXAxis(ctx, geo) {
      const m = this.model;
      const y = geo.axisY, toUm = 1e4;
      const step = niceStep((m.xMax - m.xMin) * toUm, geo.narrow ? 4 : 8);
      ctx.save();
      ctx.strokeStyle = C.axis; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(geo.plotL, y); ctx.lineTo(geo.plotR, y); ctx.stroke();
      ctx.font = `500 11px ${UI_STACK}`; ctx.fillStyle = C.faint;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const dec = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
      for (let u = Math.ceil(m.xMin * toUm / step) * step; u <= m.xMax * toUm + 1e-9; u += step) {
        const px = geo.X(u / toUm);
        ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + 4); ctx.stroke();
        ctx.fillText(Math.abs(u) < step / 1000 ? '0' : u.toFixed(dec).replace('-', '−'), px, y + 7);
      }
      ctx.restore();
      drawMath(ctx, 'x `(µm)`', geo.plotR + 12, y + 17, { size: 13, color: C.dim });
    }

    /* ---------- hover ---------- */
    setHover(px) { this.hoverPx = px; }

    info(px) {
      const geo = this.geo, m = this.model;
      if (!geo || px < geo.plotL || px > geo.plotR) return null;
      const x = geo.xOf(px), nm = this.names();
      const reg = m.region(x);
      const names = {
        E: 'Emitter (neutral)', EB: 'Emitter–base depletion region', B: 'Neutral base',
        CB: 'Collector–base depletion region', C: 'Collector (neutral)'
      };
      const eq = m.opMode === 'equilibrium';
      const levels = [
        { key: 'Ec', name: 'E_c', E: m.Ec(x), color: C.band, desc: 'conduction-band edge' },
        { key: 'Ei', name: 'E_i', E: m.Ei(x), color: 'rgba(225,232,255,0.75)', desc: 'intrinsic level' }
      ];
      if (eq) levels.push({ key: 'EF', name: 'E_F', E: 0, color: C.ef, desc: 'Fermi level' });
      else {
        levels.push({ key: 'FN', name: 'F_N', E: m.FN(x), color: C.fn, desc: 'electron quasi-Fermi level' });
        levels.push({ key: 'FP', name: 'F_P', E: m.FP(x), color: C.fp, desc: 'hole quasi-Fermi level' });
      }
      levels.push({ key: 'Ev', name: 'E_v', E: m.Ev(x), color: C.band, desc: 'valence-band edge' });
      void nm;
      return { x, px, region: names[reg], levels, n: m.nAt(x), p: m.pAt(x), field: m.field(x) };
    }

    drawCrosshair(ctx, geo) {
      const inf = this.info(this.hoverPx);
      if (!inf) return;
      const px = this.hoverPx;
      ctx.save();
      ctx.strokeStyle = 'rgba(232, 236, 248, 0.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(px, geo.bandTop); ctx.lineTo(px, geo.bottom); ctx.stroke();
      ctx.setLineDash([]);
      for (const lv of inf.levels) {
        const y = geo.Y(lv.E);
        if (y < geo.bandTop || y > geo.bandBot) continue;
        ctx.beginPath(); ctx.arc(px, y, 3.6, 0, Math.PI * 2);
        ctx.fillStyle = C.bg; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = lv.color; ctx.stroke();
      }
      ctx.restore();
    }

    /* ---------- carriers ---------- */
    seed() {
      this.particles = []; this.events = []; this.acc = {};
      const m = this.model;
      const cnt = (N) => Math.round(Math.max(6, Math.min(22, 7 + 2.4 * Math.log10(N / 1e13))));
      const minSp = m.npn ? 'e' : 'h', majSp = m.npn ? 'h' : 'e';
      for (let i = 0; i < cnt(m.NE); i++) this.particles.push(this.bgParticle(minSp, 'E'));
      for (let i = 0; i < cnt(m.NB); i++) this.particles.push(this.bgParticle(majSp, 'B'));
      for (let i = 0; i < cnt(m.NC); i++) this.particles.push(this.bgParticle(minSp, 'C'));
    }

    span(reg) {
      const m = this.model;
      return reg === 'E' ? [m.xMin, m.xEl] : reg === 'B' ? [m.xBl, m.xBr] : [m.xCr, m.xMax];
    }

    bgParticle(sp, reg) {
      const [a, b] = this.span(reg);
      return { sp, kind: 'bg', reg, x: a + rand() * (b - a), vx: (rand() - 0.5) * 0.1, off: 3 + rand() * 12, alpha: 1, dying: false, ...lifespan() };
    }

    step(dt) {
      const m = this.model, xr = m.xMax - m.xMin;
      const minSp = m.npn ? 'e' : 'h', majSp = m.npn ? 'h' : 'e';
      // spawn: base-minority carriers injected from the emitter (and from the collector in saturation)
      const injE = m.JinjE, injC = m.JinjC;             // injection from each forward-biased junction
      const recFrac = m.JEn > 0 ? Math.min(0.5, Math.max(0.06, m.JrecB / m.JEn)) : 0.2;
      const rates = {
        injE: rate(injE),
        injC: rate(injC),
        backE: m.JEp > 0 ? rate(injE + m.JEp) * Math.max(0.1, m.JEp / (injE + m.JEp)) : 0,
        backC: m.JCp > 0 ? rate(injC + m.JCp) * Math.max(0.1, m.JCp / (injC + m.JCp)) : 0
      };
      for (const key in rates) {
        this.acc[key] = (this.acc[key] || 0) + rates[key] * dt;
        while (this.acc[key] >= 1) { this.acc[key] -= 1; this.spawn(key, minSp, majSp, recFrac); }
      }
      if (this.particles.length > 160) this.particles.splice(0, this.particles.length - 160);

      const alive = [];
      const W = m.xBr - m.xBl;
      for (const p of this.particles) {
        p.age += dt;
        if (p.kind === 'bg') {
          const [a, b] = this.span(p.reg);
          p.vx += (rand() - 0.5) * 0.5 * dt;
          p.vx = Math.max(-0.07, Math.min(0.07, p.vx));
          p.x += p.vx * xr * dt * (p.reg === 'B' ? Math.min(1, 3 * W / xr) : 1);
          if (p.x < a) { p.x = a + (a - p.x); p.vx = Math.abs(p.vx); }
          if (p.x > b) { p.x = b - (p.x - b); p.vx = -Math.abs(p.vx); }
          if (p.x < a || p.x > b) p.x = a + rand() * Math.max(0, b - a);
          p.off += (rand() - 0.5) * 8 * dt; p.off = Math.max(2, Math.min(15, p.off));
          if (p.age > p.life) p.dying = true;
        } else if (p.kind === 'inj') {
          // dir +1: emitter -> collector, -1: collector -> emitter
          const d = p.dir;
          const inBase = p.x > m.xBl && p.x < m.xBr;
          const pastBase = d > 0 ? p.x >= m.xBr : p.x <= m.xBl;
          if (!p.entered) {
            p.x += d * 0.16 * xr * dt;
            if (d > 0 ? p.x > m.xBl : p.x < m.xBr) p.entered = true;
          } else if (!pastBase) {
            // diffusion across the base: random steps with a net drift down the gradient
            const v = W / 1.6;
            p.x += d * v * dt + (rand() - 0.5) * W * 0.9 * Math.sqrt(dt);
            if (d > 0 && p.x < m.xBl) p.x = m.xBl + (m.xBl - p.x);
            if (d < 0 && p.x > m.xBr) p.x = m.xBr - (p.x - m.xBr);
            if (p.rec && inBase && (d > 0 ? p.x - m.xBl : m.xBr - p.x) > p.rec * W && !p.dying) {
              p.dying = true; p.fast = true;
              this.events.push({ x: p.x, t: 0, sp: p.sp });
            }
          } else {
            // swept through the depletion region by the field, then fades in the far region
            const inDep = d > 0 ? p.x < m.xCr : p.x > m.xEl;
            p.x += d * (inDep ? 0.5 : 0.07) * xr * dt;
            if (!inDep) { p.travel = (p.travel || 0) + dt; if (p.travel > 0.8) p.dying = true; }
          }
          // carrier energy: holds above the barrier, then relaxes to the band edge
          p.E += (this.edgeE(p.sp, p.x) - p.E) * (1 - Math.exp(-dt * (p.entered ? 2.5 : 0)));
          if (p.age > 9) p.dying = true;
        } else if (p.kind === 'back') {
          const d = p.dir;                 // -1: base -> emitter, +1: base -> collector
          p.x += d * 0.12 * xr * dt;
          const out = d < 0 ? p.x < m.xEl : p.x > m.xCr;
          p.E += (this.edgeE(p.sp, p.x) - p.E) * (1 - Math.exp(-dt * (out ? 2.5 : 0)));
          if (out) {
            p.travel = (p.travel || 0) + dt;
            if (p.travel > p.reach && !p.dying) { p.dying = true; p.fast = true; this.events.push({ x: p.x, t: 0, sp: p.sp }); }
          }
          if (p.age > 7) p.dying = true;
        }
        if (p.dying) p.alpha -= dt * (p.fast ? 3 : 1.5); else p.alpha = Math.min(1, p.alpha + dt * (p.kind === 'bg' ? 1.5 : 4));
        if (p.alpha > 0 && p.x >= m.xMin && p.x <= m.xMax) alive.push(p);
        else if (p.kind === 'bg') { const q = this.bgParticle(p.sp, p.reg); q.alpha = 0; q.age = 0; alive.push(q); }
      }
      this.particles = alive;
      for (const ev of this.events) ev.t += dt;
      this.events = this.events.filter((ev) => ev.t < 1);
    }

    edgeE(sp, x) { return sp === 'e' ? this.model.Ec(x) : this.model.Ev(x); }

    spawn(key, minSp, majSp, recFrac) {
      const m = this.model;
      const padE = m.xEl - m.xMin, padC = m.xMax - m.xCr;
      const g = (sp) => (sp === 'e' ? 1 : -1);
      if (key === 'injE' || key === 'injC') {
        const d = key === 'injE' ? 1 : -1;
        const x = d > 0 ? m.xEl - rand() * padE * 0.35 : m.xCr + rand() * padC * 0.35;
        // just over the barrier: the band edge on the base side of that junction
        const top = this.edgeE(minSp, d > 0 ? m.xBl : m.xBr);
        const E = top + g(minSp) * (0.01 + rand() * 0.04) * m.fr.Eg;
        this.particles.push({ sp: minSp, kind: 'inj', dir: d, x, E, off: 3 + rand() * 5, age: 0, alpha: 0, entered: false,
          rec: rand() < recFrac ? 0.15 + rand() * 0.75 : 0 });
      } else {
        const d = key === 'backE' ? -1 : 1;
        const x = d < 0 ? m.xBl + rand() * (m.xBr - m.xBl) * 0.3 : m.xBr - rand() * (m.xBr - m.xBl) * 0.3;
        const top = this.edgeE(majSp, d < 0 ? m.xEl : m.xCr);
        const E = top + g(majSp) * (0.01 + rand() * 0.04) * m.fr.Eg;
        this.particles.push({ sp: majSp, kind: 'back', dir: d, x, E, off: 3, age: 0, alpha: 0, reach: 0.4 + rand() * 0.6 });
      }
    }

    drawParticles(ctx, geo) {
      const m = this.model;
      ctx.save();
      ctx.beginPath(); ctx.rect(geo.plotL, geo.bandTop, geo.plotW, geo.bandH); ctx.clip();
      for (const ev of this.events) this.drawRec(ctx, geo, ev);
      for (const p of this.particles) {
        const e = p.sp === 'e';
        const yEdge = geo.Y(this.edgeE(p.sp, p.x));
        let y = e ? yEdge - p.off : yEdge + p.off;
        if (p.E != null) { const yE = geo.Y(p.E); y = e ? Math.min(y, yE) : Math.max(y, yE); }
        const sx = geo.X(p.x);
        const a = Math.max(0, Math.min(1, p.alpha));
        const trail = p.kind === 'inj' ? (p.entered && (p.dir > 0 ? p.x >= m.xBr : p.x <= m.xBl) ? C.field : C.diff) : p.kind === 'back' ? C.diff : null;
        if (trail) {
          p.tr = p.tr || [];
          p.tr.push(sx, y);
          if (p.tr.length > 24) p.tr.splice(0, 2);
          const n = p.tr.length / 2;
          ctx.strokeStyle = trail; ctx.lineWidth = 2; ctx.lineCap = 'round';
          for (let i = 1; i < n; i++) {
            ctx.globalAlpha = a * 0.7 * (i / n);
            ctx.beginPath(); ctx.moveTo(p.tr[2 * i - 2], p.tr[2 * i - 1]); ctx.lineTo(p.tr[2 * i], p.tr[2 * i + 1]); ctx.stroke();
          }
        }
        const s = this.sprites[p.sp];
        ctx.globalAlpha = a;
        ctx.drawImage(s.img, sx - s.size / 2, y - s.size / 2, s.size, s.size);
        p.sx = sx; p.sy = y;
        if (p === this.hoverParticle) {
          ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(sx, y, 9, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.restore();
    }

    /* recombination: the carrier drops across the gap through an R–G center */
    drawRec(ctx, geo, ev) {
      const m = this.model;
      const x = geo.X(ev.x);
      const yC = geo.Y(m.Ec(ev.x)) - 4, yV = geo.Y(m.Ev(ev.x)) + 4, yT = geo.Y(m.Ei(ev.x));
      const t = ev.t, a = Math.min(1, t * 8) * (1 - Math.max(0, (t - 0.75) / 0.25));
      const [y0, y2] = ev.sp === 'e' ? [yC, yV] : [yV, yC];
      const s1 = Math.min(1, t / 0.35), s2 = Math.max(0, Math.min(1, (t - 0.35) / 0.35));
      const yNow = t < 0.35 ? y0 + (yT - y0) * s1 : yT + (y2 - yT) * s2;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = C.rgc; ctx.fillStyle = C.rgc; ctx.shadowColor = C.rgc; ctx.shadowBlur = 8;
      ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, yNow); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeRect(x - 4, yT - 4, 8, 8);
      ctx.beginPath(); ctx.arc(x, yNow, 2.6, 0, Math.PI * 2); ctx.fill();
      const ft = Math.max(0, (t - 0.68) / 0.3);
      if (ft > 0 && ft < 1) {
        const r = 3 + 12 * ft;
        const g = ctx.createRadialGradient(x, y2, 0, x, y2, r);
        g.addColorStop(0, 'rgba(142, 240, 196, 0.85)'); g.addColorStop(1, 'rgba(142, 240, 196, 0)');
        ctx.globalAlpha = a * (1 - ft); ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y2, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    particleAt(px, py) {
      if (!this.opts.carriers) return null;
      let best = null, bd = 13;
      for (const p of this.particles) {
        if (p.sx == null || p.alpha < 0.3) continue;
        const d = Math.hypot(p.sx - px, p.sy - py);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    }
  }

  BJTView.arrow = function (ctx, x1, y1, x2, y2, color, w) {
    const a = Math.atan2(y2 - y1, x2 - x1), hl = 5.5;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - Math.cos(a) * hl * 0.6, y2 - Math.sin(a) * hl * 0.6); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - hl * Math.cos(a - 0.45), y2 - hl * Math.sin(a - 0.45));
    ctx.lineTo(x2 - hl * Math.cos(a + 0.45), y2 - hl * Math.sin(a + 0.45));
    ctx.closePath(); ctx.fill();
  };

  return BJTView;
})();
