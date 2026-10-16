/*
 * Canvas renderer for the band diagram, the charge-density and electric-field
 * strips, the drift/diffusion flow arrows, the carrier animation and the hover
 * crosshair.
 *
 * Static content (bands, labels, annotations) is drawn into an offscreen layer
 * and only redrawn when the model or the view changes; carriers and the hover
 * crosshair are drawn on top every frame.
 */
window.SV = window.SV || {};

SV.COLORS = {
  bg: '#060912',
  band: '#f3f6ff',
  bandGlow: 'rgba(170, 196, 255, 0.95)',
  ei: 'rgba(225, 232, 255, 0.55)',
  ef: '#ffc857',
  efGlow: 'rgba(255, 200, 87, 0.9)',
  fn: '#5cc8ff',
  fp: '#ff6b8b',
  electron: '#5cc8ff',
  hole: '#ff6b8b',
  field: '#b69cff',     // electric field, and drift (carriers pushed by the field)
  diff: '#ff5ccf',      // diffusion (carriers spreading down a concentration gradient)
  rgc: '#8ef0c4',       // R–G centers and recombination / generation events
  text: '#e8ecf8',
  dim: '#8a94ad',
  faint: '#78829e',
  grid: 'rgba(140, 160, 230, 0.07)',
  axis: 'rgba(160, 176, 230, 0.28)',
  pill: 'rgba(6, 9, 18, 0.8)'
};

SV.Diagram = (function () {
  const C = SV.COLORS;
  const MATH_STACK = '"STIX Two Text", "STIX Two Math", "Cambria Math", "Latin Modern Math", "Times New Roman", serif';
  const UI_STACK = '"Schibsted Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif';

  /* ---------- rich text ---------- */
  function fontFor(st, size) {
    switch (st) {
      case 'it': return `italic 400 ${size}px ${MATH_STACK}`;
      case 'rm': return `400 ${size}px ${MATH_STACK}`;
      case 'ui': return `500 ${size * 0.86}px ${UI_STACK}`;
      case 'sub': case 'sup': return `400 ${size * 0.7}px ${MATH_STACK}`;
      case 'subU': case 'supU': return `500 ${size * 0.62}px ${UI_STACK}`;
    }
  }
  function measureMath(ctx, src, size) {
    const parts = SV.fmt.parseMath(src);
    let w = 0;
    for (const p of parts) {
      ctx.font = fontFor(p.st, size);
      p.w = ctx.measureText(p.t).width + (p.st === 'it' ? size * 0.04 : 0);
      w += p.w;
    }
    return { parts, w };
  }
  function drawMath(ctx, src, x, y, opt = {}) {
    const size = opt.size || 15;
    const { parts, w } = measureMath(ctx, src, size);
    let cx = x;
    if (opt.align === 'right') cx = x - w;
    else if (opt.align === 'center') cx = x - w / 2;
    if (opt.pill) {
      ctx.fillStyle = C.pill;
      roundRect(ctx, cx - 6, y - size * 0.82, w + 12, size * 1.28, 5);
      ctx.fill();
    }
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = opt.color || C.text;
    for (const p of parts) {
      ctx.font = fontFor(p.st, size);
      let dy = 0;
      if (p.st === 'sub' || p.st === 'subU') dy = size * 0.26;
      if (p.st === 'sup' || p.st === 'supU') dy = -size * 0.4;
      ctx.fillText(p.t, cx, y + dy);
      cx += p.w;
    }
    return w;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function niceStep(span, target) {
    const raw = span / target;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    const n = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
    return n * p;
  }

  /* glowing sprites for carriers */
  function makeSprite(rgb, hollow) {
    const s = 28, c = document.createElement('canvas');
    c.width = c.height = s * 2;
    const g = c.getContext('2d');
    g.scale(2, 2);
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, `rgba(${rgb}, 0.55)`);
    grd.addColorStop(1, `rgba(${rgb}, 0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    g.beginPath();
    g.arc(s / 2, s / 2, hollow ? 3.6 : 3.3, 0, Math.PI * 2);
    if (hollow) {
      g.lineWidth = 1.6;
      g.strokeStyle = `rgb(${rgb})`;
      g.stroke();
    } else {
      g.fillStyle = `rgb(${rgb})`;
      g.fill();
    }
    return { img: c, size: s };
  }

  const rand = Math.random;
  /* background carriers live 8-18 s, starting at a random age so they fade out one at a time */
  const lifespan = () => { const life = 8 + rand() * 10; return { life, age: rand() * life }; };

  class Diagram {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.layer = document.createElement('canvas');      // bands, fills, levels
      this.lctx = this.layer.getContext('2d');
      this.top = document.createElement('canvas');        // labels and arrows, above the carriers
      this.tctx = this.top.getContext('2d');
      this.dpr = 1; this.w = 0; this.h = 0;
      this.model = null;
      this.opts = {};
      this.view = null;
      this.dirty = true;
      this.particles = [];
      this.acc = {};
      this.seedKey = '';
      this.boxes = [];
      this.hoverPx = null;
      this.hoverParticle = null;
      this.events = [];
      this.sprites = {
        e: makeSprite('92, 200, 255', false),
        h: makeSprite('255, 107, 139', true)
      };
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = Math.max(320, r.width);
      this.h = Math.max(320, r.height);
      for (const c of [this.canvas, this.layer, this.top]) {
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
      const key = [model.mode, model.mat.key, model.T, model.NA, model.ND, model.n0, model.p0].join('|');
      if (key !== this.seedKey || !prev || prev.mode !== model.mode) {
        this.seedKey = key;
        this.seed();
      }
    }

    /* ---------- geometry ---------- */
    geometry() {
      const m = this.model, w = this.w, h = this.h;
      const pn = m.mode === 'pn';
      const narrow = w < 640;
      const sideLabels = pn && !narrow;            // E_cp, E_ip ... on the left
      const left = narrow ? 46 : sideLabels ? 118 : 64;
      const right = narrow ? 58 : 92;
      const laneTop = 8, laneH = 48;
      const axisH = 34;
      const stripH = pn ? Math.round(Math.max(44, Math.min(74, h * 0.105))) : 0;
      const gap = pn ? 14 : 0;
      const bandTop = laneTop + laneH;
      const bandBot = h - axisH - (pn ? 2 * stripH + 2 * gap : 0) - 6;
      const plotL = left, plotR = w - right;
      const geo = {
        pn, narrow, sideLabels, plotL, plotR, plotW: plotR - plotL, laneTop, laneH,
        bandTop, bandBot, bandH: bandBot - bandTop,
        rhoTop: bandBot + gap, rhoBot: bandBot + gap + stripH,
        efTop: bandBot + 2 * gap + stripH, efBot: bandBot + 2 * gap + 2 * stripH,
        axisY: h - axisH + 6,
        tickX: sideLabels ? plotL - 70 : plotL - 10,
        bottom: pn ? bandBot + 2 * gap + 2 * stripH : bandBot
      };
      const xr = m.xMax - m.xMin;
      geo.X = (x) => plotL + (x - m.xMin) / xr * geo.plotW;
      geo.xOf = (px) => m.xMin + (px - plotL) / geo.plotW * xr;
      const v = this.view;
      geo.Y = (E) => bandTop + (v.eTop - E) / (v.eTop - v.eBot) * geo.bandH;
      geo.pxPerEv = geo.bandH / (v.eTop - v.eBot);
      return geo;
    }

    sampleXs(n) {
      const m = this.model, xs = [];
      for (let i = 0; i <= n; i++) xs.push(m.xMin + (m.xMax - m.xMin) * i / n);
      if (m.mode === 'pn') xs.push(-m.xp, 0, m.xn, m.pIn, m.nIn);
      return xs.filter((x) => x >= m.xMin && x <= m.xMax).sort((a, b) => a - b);
    }

    /*
     * Energy window for the plot. To keep the picture steady while a slider
     * moves, each edge only moves when the bands get too close to it or
     * leave too much empty space; it then jumps to a roomier position and
     * eases there, instead of tracking every small change.
     */
    targetView() {
      const m = this.model;
      let top = -Infinity, bot = Infinity;
      for (const x of this.sampleXs(80)) {
        top = Math.max(top, m.Ec(x));
        bot = Math.min(bot, m.Ev(x));
      }
      const span = top - bot;
      const fresh = { eTop: top + span * 0.17, eBot: bot - span * 0.17 };
      const t = this.viewTarget;
      if (!t || this.viewKey !== m.mode) { this.viewKey = m.mode; this.viewTarget = fresh; return fresh; }
      const ok = (room) => room > span * 0.08 && room < span * 0.5;
      if (ok(t.eTop - top) && ok(bot - t.eBot)) return t;
      // re-fit with extra room on any side that was running out
      const next = {
        eTop: ok(t.eTop - top) ? t.eTop : top + span * (t.eTop - top <= span * 0.08 ? 0.28 : 0.17),
        eBot: ok(bot - t.eBot) ? t.eBot : bot - span * (bot - t.eBot <= span * 0.08 ? 0.28 : 0.17)
      };
      this.viewTarget = next;
      return next;
    }

    /* ---------- per-frame ---------- */
    frame(dt) {
      if (!this.model || this.w === 0) return;
      const tv = this.targetView();
      if (!this.view) this.view = tv;
      else {
        const k = 1 - Math.exp(-dt * 4);
        const d1 = tv.eTop - this.view.eTop, d2 = tv.eBot - this.view.eBot;
        const span = tv.eTop - tv.eBot;
        if (Math.abs(d1) > span * 1e-4 || Math.abs(d2) > span * 1e-4) {
          this.view = { eTop: this.view.eTop + d1 * k, eBot: this.view.eBot + d2 * k };
          this.dirty = true;
        }
      }
      const geo = this.geometry();
      this.geo = geo;
      if (this.dirty) {
        this.drawStatic(geo);
        this.dirty = false;
      }
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.drawImage(this.layer, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.opts.carriers) {
        this.step(Math.min(dt, 0.05) * (this.hoverParticle ? 0.25 : 1), geo);
        this.drawParticles(ctx, geo);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.top, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.hoverPx != null) this.drawCrosshair(ctx, geo);
    }

    /* ---------- static layer ---------- */
    drawStatic(geo) {
      let ctx = this.lctx;
      const m = this.model, o = this.opts;
      for (const c of [this.lctx, this.tctx]) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, this.layer.width, this.layer.height);
        c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        c.lineJoin = 'round';
        c.lineCap = 'round';
      }

      const xs = this.sampleXs(Math.max(240, Math.round(geo.plotW / 2)));

      this.drawEnergyAxis(ctx, geo);
      if (geo.pn) this.drawContactZones(ctx, geo);
      if (geo.pn) this.drawDepletion(ctx, geo);
      this.drawBandFills(ctx, geo, xs);

      // intrinsic level
      ctx.save();
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = C.ei;
      ctx.lineWidth = 1.2;
      this.path(ctx, xs, m.Ei, geo);
      ctx.stroke();
      ctx.restore();

      // Fermi level(s)
      const biased = geo.pn && Math.abs(m.VA) > 1e-9;
      if (!biased) {
        this.glow(ctx, xs, m.EF, geo, C.ef, C.efGlow, 1.6);
      } else if (o.quasi) {
        ctx.save();
        ctx.setLineDash([9, 6]);
        ctx.lineWidth = 1.7;
        ctx.shadowBlur = 8;
        ctx.shadowColor = C.fp;
        ctx.strokeStyle = C.fp;
        this.path(ctx, xs, m.FP, geo); ctx.stroke();
        ctx.shadowColor = C.fn;
        ctx.strokeStyle = C.fn;
        ctx.lineDashOffset = 7;
        this.path(ctx, xs, m.FN, geo); ctx.stroke();
        ctx.restore();
      } else {
        this.glow(ctx, xs.filter((x) => x <= -m.xp), m.FP, geo, C.ef, C.efGlow, 1.6);
        this.glow(ctx, xs.filter((x) => x >= m.xn), m.FN, geo, C.ef, C.efGlow, 1.6);
      }

      // band edges
      this.glow(ctx, xs, m.Ec, geo, C.band, C.bandGlow, 2.2);
      this.glow(ctx, xs, m.Ev, geo, C.band, C.bandGlow, 2.2);

      this.drawContacts(ctx, geo);
      ctx = this.tctx;

      // labels are placed in priority order; later optional ones yield to earlier ones
      this.boxes = [];
      if (geo.pn) {
        this.boxes.push({ x: geo.X(m.pIn) + 6, y: geo.bandTop + 2, w: 56, h: 20 }, { x: geo.X(m.nIn) - 62, y: geo.bandTop + 2, w: 56, h: 20 });
        for (const x of [geo.X(-m.xp), geo.X(m.xn)]) this.boxes.push({ x: x - 22, y: geo.bandBot - 24, w: 44, h: 22 });
        this.inlineQuasiLabels(ctx, geo);
        if (o.flows) this.drawFlows(ctx, geo);
        this.drawSeriesDrop(ctx, geo);
      }
      if (o.diffs) {
        if (geo.pn) this.annotatePN(ctx, geo);
        else this.annotateBulk(ctx, geo);
      }
      this.drawLane(ctx, geo);
      this.drawLineLabels(ctx, geo);
      if (geo.pn) this.drawStrips(ctx, geo);
      this.drawXAxis(ctx, geo);
    }

    path(ctx, xs, f, geo) {
      ctx.beginPath();
      xs.forEach((x, i) => {
        const px = geo.X(x), py = geo.Y(f(x));
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
    }

    glow(ctx, xs, f, geo, core, glowColor, width) {
      if (!xs.length) return;
      ctx.save();
      ctx.strokeStyle = glowColor;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = width * 2.4;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 22;
      this.path(ctx, xs, f, geo); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 9;
      ctx.lineWidth = width;
      ctx.strokeStyle = core;
      this.path(ctx, xs, f, geo); ctx.stroke();
      ctx.restore();
    }

    drawBandFills(ctx, geo, xs) {
      const m = this.model;
      const fill = (f, edge, color0) => {
        ctx.save();
        ctx.beginPath();
        xs.forEach((x, i) => {
          const px = geo.X(x), py = geo.Y(f(x));
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.lineTo(geo.X(xs[xs.length - 1]), edge);
        ctx.lineTo(geo.X(xs[0]), edge);
        ctx.closePath();
        const ref = geo.Y(f(xs[Math.floor(xs.length / 2)]));
        const g = ctx.createLinearGradient(0, ref, 0, edge);
        g.addColorStop(0, color0);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fill();
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
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let e = Math.ceil(v.eBot / step) * step; e <= v.eTop + 1e-9; e += step) {
        const y = geo.Y(e);
        if (y < geo.bandTop + 4 || y > geo.bandBot - 4) continue;
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(geo.plotL, y); ctx.lineTo(geo.plotR, y); ctx.stroke();
        const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
        const s = (Math.abs(e) < step / 1000 ? 0 : e).toFixed(dec).replace('-', '−');
        ctx.fillText(s, geo.tickX, y);
      }
      ctx.restore();
      ctx.save();
      ctx.translate(geo.narrow ? 12 : 16, (geo.bandTop + geo.bandBot) / 2);
      ctx.rotate(-Math.PI / 2);
      drawMath(ctx, 'E `(eV)`', 0, 0, { size: 14, color: C.dim, align: 'center' });
      ctx.restore();
    }

    /* compressed zones standing for the rest of each neutral region out to the contact */
    drawContactZones(ctx, geo) {
      const m = this.model;
      ctx.save();
      for (const [a, b] of [[m.xMin, m.pIn], [m.nIn, m.xMax]]) {
        const x1 = geo.X(a), x2 = geo.X(b);
        ctx.fillStyle = 'rgba(150, 170, 230, 0.035)';
        ctx.fillRect(x1, geo.bandTop, x2 - x1, geo.bandH);
        // axis-break marks at the inner edge
        const xb = a === m.xMin ? x2 : x1;
        ctx.strokeStyle = 'rgba(160, 176, 230, 0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 5]);
        ctx.beginPath(); ctx.moveTo(xb, geo.bandTop); ctx.lineTo(xb, geo.bandBot); ctx.stroke();
        ctx.setLineDash([]);
        for (const y of [geo.bandTop + 4, geo.axisY]) {
          ctx.beginPath();
          ctx.moveTo(xb - 6, y + 5); ctx.lineTo(xb - 1, y - 5);
          ctx.moveTo(xb + 1, y + 5); ctx.lineTo(xb + 6, y - 5);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    drawDepletion(ctx, geo) {
      const m = this.model;
      const x1 = geo.X(-m.xp), x2 = geo.X(m.xn);
      const bottom = geo.efBot;
      ctx.save();
      const g = ctx.createLinearGradient(0, geo.laneTop, 0, bottom);
      g.addColorStop(0, 'rgba(182, 156, 255, 0.10)');
      g.addColorStop(0.5, 'rgba(182, 156, 255, 0.05)');
      g.addColorStop(1, 'rgba(182, 156, 255, 0.07)');
      ctx.fillStyle = g;
      ctx.fillRect(x1, geo.bandTop, x2 - x1, bottom - geo.bandTop);
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = 'rgba(182, 156, 255, 0.55)';
      ctx.lineWidth = 1;
      for (const x of [x1, x2]) {
        ctx.beginPath(); ctx.moveTo(x, geo.laneTop + 14); ctx.lineTo(x, bottom); ctx.stroke();
      }
      ctx.setLineDash([1, 4]);
      ctx.strokeStyle = 'rgba(232, 236, 248, 0.22)';
      const x0 = geo.X(0);
      ctx.beginPath(); ctx.moveTo(x0, geo.bandTop); ctx.lineTo(x0, bottom); ctx.stroke();
      ctx.restore();
    }

    drawContacts(ctx, geo) {
      const m = this.model;
      const labels = geo.pn ? ['`p contact`', '`n contact`'] : ['`0 V`', 'V'];
      ctx.save();
      [[m.xMin, labels[0], 'left'], [m.xMax, labels[1], 'right']].forEach(([x, label, side]) => {
        const px = geo.X(x);
        const g = ctx.createLinearGradient(px - 5, 0, px + 5, 0);
        g.addColorStop(0, 'rgba(200, 210, 235, 0.05)');
        g.addColorStop(0.5, 'rgba(200, 210, 235, 0.35)');
        g.addColorStop(1, 'rgba(200, 210, 235, 0.05)');
        ctx.fillStyle = g;
        ctx.fillRect(px - 4, geo.bandTop, 8, geo.bandH);
        if (geo.pn && geo.narrow) return;
        drawMath(ctx, label, px + (geo.pn ? (side === 'left' ? 4 : -4) : 0), geo.laneTop + 16,
          { size: geo.pn ? 13 : 14, color: C.dim, align: geo.pn ? side : 'center' });
      });
      ctx.restore();
    }

    /* ---------- label-collision bookkeeping ---------- */
    fits(r, geo) {
      return r.x >= geo.plotL - 2 && r.x + r.w <= geo.plotR + 6 && r.y >= geo.bandTop - 6 && r.y + r.h <= geo.bandBot + 6;
    }
    hits(r) {
      return this.boxes.some((b) => r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y);
    }
    /* place a pill label if there is room; returns the rect or null */
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

    /* vertical dimension arrow between two energies, with a label.
     * Returns null (and draws nothing) when an optional label has no room. */
    dimension(ctx, x, E1, E2, label, geo, opt = {}) {
      const y1 = geo.Y(E1), y2 = geo.Y(E2);
      const color = opt.color || 'rgba(232, 236, 248, 0.85)';
      const top = Math.min(y1, y2), bot = Math.max(y1, y2);
      const size = (opt.size || 14) * (geo.narrow ? 0.88 : 1);
      const { w } = measureMath(ctx, label, size);
      const ly = opt.labelY != null ? opt.labelY : (top + bot) / 2 + 5;
      const rectFor = (side) => side === 'right'
        ? { x: x + 3, y: ly - size * 0.9, w: w + 20, h: size * 1.35 }
        : { x: x - w - 23, y: ly - size * 0.9, w: w + 20, h: size * 1.35 };
      const arrowRect = { x: x - 6, y: top, w: 12, h: bot - top };
      let side = opt.side || 'right';
      const ok = (r) => this.fits(r, geo) && !this.hits(r);
      if (!ok(rectFor(side))) {
        const alt = side === 'right' ? 'left' : 'right';
        if (ok(rectFor(alt))) side = alt;
        else if (opt.optional) return null;
      }
      if (opt.optional && this.hits(arrowRect)) return null;

      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(x, top + 1); ctx.lineTo(x, bot - 1); ctx.stroke();
      const ah = Math.min(6, (bot - top) / 3);
      if (ah > 1.5) {
        for (const [y, d] of [[top, 1], [bot, -1]]) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 3.2, y + d * ah);
          ctx.lineTo(x + 3.2, y + d * ah);
          ctx.closePath(); ctx.fill();
        }
      }
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(x - 6, top); ctx.lineTo(x + 6, top);
      ctx.moveTo(x - 6, bot); ctx.lineTo(x + 6, bot);
      ctx.stroke();
      ctx.restore();
      drawMath(ctx, label, side === 'right' ? x + 10 : x - 10, ly, {
        size, color: opt.textColor || C.text,
        align: side === 'right' ? 'left' : 'right', pill: true
      });
      const r = rectFor(side);
      this.boxes.push(r, arrowRect);
      return { side, rect: r };
    }

    /* minority quasi-Fermi levels named where they separate from the majority level */
    inlineQuasiLabels(ctx, geo) {
      const m = this.model;
      if (!(Math.abs(m.VA) > 1e-9 && this.opts.quasi)) return;
      const xl = m.pIn, xr = m.nIn;
      if (Math.abs(geo.Y(m.FN(xl)) - geo.Y(m.FP(xl))) > 12) {
        const y = geo.Y(m.FN(xl)) + (m.FN(xl) > m.FP(xl) ? -7 : 16);
        this.placeLabel(ctx, 'F_N', geo.X(xl) + 8, y, { size: 15, color: C.fn }, geo);
      }
      if (Math.abs(geo.Y(m.FN(xr)) - geo.Y(m.FP(xr))) > 12) {
        const y = geo.Y(m.FP(xr)) + (m.FP(xr) < m.FN(xr) ? 16 : -7);
        this.placeLabel(ctx, 'F_P', geo.X(xr) - 8, y, { size: 15, color: C.fp, align: 'right' }, geo);
      }
    }

    /* ---------- drift and diffusion flows ---------- */
    drawFlows(ctx, geo) {
      const m = this.model, c = m.comps;
      const max = Math.max(c.nDiff, c.nDrift, c.pDiff, c.pDrift);
      const weight = (v) => Math.max(0, Math.min(1, 1 + Math.log10(Math.max(v, 1e-300) / max) / 8));
      const pVis = -m.xp - m.pIn, nVis = m.nIn - m.xn;
      const a = -m.xp - pVis * (geo.narrow ? 0.12 : 0.24);
      const b = m.xn + nVis * (geo.narrow ? 0.12 : 0.24);
      const small = geo.narrow;
      // try each candidate spot next to the arrow; the last one is forced
      const label = (src, color, spots) => {
        for (let i = 0; i < spots.length; i++) {
          const [x, y, align] = spots[i];
          if (this.placeLabel(ctx, src, x, y, { size: 13, color, align, force: i === spots.length - 1 }, geo)) return;
        }
      };

      // electrons in the conduction band
      const EcTop = Math.max(m.Ec(-m.xp), m.Ec(m.xn));
      const yE = Math.max(geo.bandTop + 30, geo.Y(EcTop) - 20);
      const xb = geo.X(b), xa = geo.X(a);
      this.flowLine(ctx, xb, yE, xa, yE, 'diff', weight(c.nDiff));
      const z = (v) => (weight(v) < 0.05 ? ' ≈ 0' : '');
      label((small ? '`diffusion' : '`electron diffusion') + z(c.nDiff) + '`', C.diff,
        [[xb, yE - 8, 'right'], [xb + 8, yE + 4, 'left'], [xb, yE + 18, 'right']]);
      const dA = -m.xp - pVis * 0.1, dB = m.xn + nVis * 0.1;
      this.flowCurve(ctx, geo, dA, dB, (x) => geo.Y(m.Ec(x)) - 11, 'drift', weight(c.nDrift));
      label(small ? '`drift`' : '`electron drift`', C.field,
        [[geo.X(dB) + 6, geo.Y(m.Ec(dB)) - 16, 'left'], [geo.X(0) + 14, geo.Y(m.Ec(0)) + 2, 'left'], [geo.X(dB) + 6, geo.Y(m.Ec(dB)) - 16, 'left']]);

      // holes in the valence band
      const EvBot = Math.min(m.Ev(-m.xp), m.Ev(m.xn));
      const yH = Math.min(geo.bandBot - 30, geo.Y(EvBot) + 20);
      this.flowLine(ctx, xa, yH, xb, yH, 'diff', weight(c.pDiff));
      label((small ? '`diffusion' : '`hole diffusion') + z(c.pDiff) + '`', C.diff,
        [[xa, yH + 18, 'left'], [xa - 8, yH + 4, 'right'], [xa, yH - 8, 'left']]);
      this.flowCurve(ctx, geo, dB, dA, (x) => geo.Y(m.Ev(x)) + 11, 'drift', weight(c.pDrift));
      label(small ? '`drift`' : '`hole drift`', C.field,
        [[geo.X(dA) - 6, geo.Y(m.Ev(dA)) + 24, 'right'], [geo.X(0) - 14, geo.Y(m.Ev(0)) + 8, 'right'], [geo.X(dA) - 6, geo.Y(m.Ev(dA)) + 24, 'right']]);
    }

    flowStyle(ctx, kind, w) {
      const color = kind === 'diff' ? C.diff : C.field;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.18 + 0.82 * w;
      ctx.lineWidth = 1 + 2.6 * w;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6 * w;
      ctx.setLineDash(kind === 'drift' ? [7, 5] : []);
      return 6 + 4 * w;
    }

    flowLine(ctx, x1, y1, x2, y2, kind, w) {
      ctx.save();
      const hl = this.flowStyle(ctx, kind, w);
      const dir = Math.sign(x2 - x1);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - dir * hl * 0.7, y2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - dir * hl, y2 - hl * 0.55);
      ctx.lineTo(x2 - dir * hl, y2 + hl * 0.55);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    flowCurve(ctx, geo, xa, xb, yOf, kind, w) {
      ctx.save();
      const hl = this.flowStyle(ctx, kind, w);
      const n = 60, pts = [];
      for (let i = 0; i <= n; i++) {
        const x = xa + (xb - xa) * i / n;
        pts.push([geo.X(x), yOf(x)]);
      }
      // stop the line short of the head
      let cut = pts.length - 1, acc = 0;
      while (cut > 1 && acc < hl * 0.7) {
        acc += Math.hypot(pts[cut][0] - pts[cut - 1][0], pts[cut][1] - pts[cut - 1][1]);
        cut--;
      }
      ctx.beginPath();
      pts.slice(0, cut + 1).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      const [ex, ey] = pts[pts.length - 1];
      const [px, py] = pts[Math.max(0, pts.length - 4)];
      const ang = Math.atan2(ey - py, ex - px);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - hl * Math.cos(ang - 0.5), ey - hl * Math.sin(ang - 0.5));
      ctx.lineTo(ex - hl * Math.cos(ang + 0.5), ey - hl * Math.sin(ang + 0.5));
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    /* IR drop across the neutral regions when the junction can't take more voltage */
    drawSeriesDrop(ctx, geo) {
      const m = this.model;
      for (const [a, b, drop] of [[m.xMin, m.pIn, m.dropP], [m.nIn, m.xMax, m.dropN]]) {
        if (Math.abs(drop) < 0.01) continue;
        const xc = (geo.X(a) + geo.X(b)) / 2;
        const top = Math.max(m.Ec(a), m.Ec(b));
        const y = Math.max(geo.bandTop + 22, geo.Y(top) - 14);
        this.placeLabel(ctx, '`IR drop`', xc, y - 15, { size: 12, color: C.dim, align: 'center', pill: false, force: true }, geo);
        this.placeLabel(ctx, '`' + drop.toFixed(2) + ' V`', xc, y, { size: 14, color: C.text, align: 'center', force: true }, geo);
      }
    }

    annotatePN(ctx, geo) {
      const m = this.model, f = SV.fmt;
      const pEdge = -m.xp, nEdge = m.xn;
      const pVis = pEdge - m.pIn, nVis = m.nIn - nEdge;
      const EcP = m.Ec(pEdge), EcN = m.Ec(nEdge);

      // barrier: dotted extension of E_c at the p edge over to the n side
      const xa = nEdge + nVis * (geo.narrow ? 0.2 : 0.5);
      ctx.save();
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = 'rgba(232, 236, 248, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(geo.X(pEdge), geo.Y(EcP));
      ctx.lineTo(geo.X(xa) + 22, geo.Y(EcP));
      ctx.stroke();
      ctx.restore();
      let lbl, subs;
      if (m.regime === 'equilibrium') {
        lbl = 'qV_{bi} = `' + f.eV(m.psi) + '`';
        subs = ['`= ` E_{cp} − E_{cn} `= ` kT "ln"(N_A N_D / n_i^2)', '`= ` kT "ln"(N_A N_D / n_i^2)'];
      } else if (m.regime === 'reverse' || m.regime === 'forward') {
        lbl = 'q(V_{bi} − V_A) = `' + f.eV(m.psi) + '`';
        subs = ['`= ` qV_{bi} − qV_A `, barrier ' + (m.VA > 0 ? 'lowered' : 'raised') + '`', '`= ` qV_{bi} − qV_A'];
      } else {
        lbl = (geo.narrow ? '' : '`Barrier ` ') + 'q(V_{bi} − V_j) = `' + f.eV(m.psi) + '`';
        subs = ['`only ` V_j `= ' + m.Vj.toFixed(3) + ' V of ` V_A ` sits across the junction`', 'V_j `= ' + m.Vj.toFixed(3) + ' V`'];
      }
      const yMid = (geo.Y(EcP) + geo.Y(EcN)) / 2;
      const hpx = Math.abs(geo.Y(EcP) - geo.Y(EcN));
      const tall = hpx > 64, tiny = hpx < 26;
      const labelY = tall ? yMid - 4 : tiny ? Math.max(geo.Y(EcP), geo.Y(EcN)) + 22 : yMid + 5;
      const res = this.dimension(ctx, geo.X(xa), EcP, EcN, lbl, geo, { size: 15, labelY, side: geo.narrow ? 'left' : 'right' });
      if (res) {
        const size = geo.narrow ? 12 : 13;
        const subY = tall ? yMid + 17 : labelY + 21;
        for (const sub of subs) {
          const { w } = measureMath(ctx, sub, size);
          const sx = res.side === 'right' ? geo.X(xa) + 10 : geo.X(xa) - 10 - w;
          const r = { x: sx - 6, y: subY - size, w: w + 12, h: size * 1.35 };
          if (this.fits(r, geo) && !this.hits(r)) {
            drawMath(ctx, sub, sx, subY, { size, color: C.dim, pill: true });
            this.boxes.push(r);
            break;
          }
        }
      }

      // optional annotations, most useful first
      const xg = m.pIn + pVis * 0.08;
      this.dimension(ctx, geo.X(xg), m.Ec(xg), m.Ev(xg), 'E_g = `' + f.eV(m.fr.Eg, 2) + '`', geo,
        { optional: true, labelY: geo.Y(m.Ec(xg)) + 20 });
      if (!geo.narrow) {
        const xf = m.nIn - nVis * 0.12;
        if (Math.abs(geo.Y(m.FN(xf)) - geo.Y(m.Ei(xf))) > 10) {
          this.dimension(ctx, geo.X(xf), m.FN(xf), m.Ei(xf), 'E_{Fn} − E_{in} = `' + f.eV(m.FN(xf) - m.Ei(xf)) + '`', geo,
            { color: 'rgba(255, 200, 87, 0.9)', size: 13, side: 'left', optional: true });
        }
        const xi = m.pIn + pVis * 0.5;
        if (geo.Y(m.FP(xi)) - geo.Y(m.Ei(xi)) > 10) {
          this.dimension(ctx, geo.X(xi), m.Ei(xi), m.FP(xi), 'E_{ip} − E_{Fp} = `' + f.eV(m.Ei(xi) - m.FP(xi)) + '`', geo,
            { color: 'rgba(255, 200, 87, 0.9)', size: 13, optional: true });
        }
        if (Math.abs(m.VA) > 1e-9 && this.opts.quasi && Math.abs(geo.Y(m.FN(0)) - geo.Y(m.FP(0))) > 12) {
          const xq = (pEdge + nEdge) / 2 + (nEdge - pEdge) * 0.18;
          const lab = m.regime === 'reverse' || m.regime === 'forward' ? 'qV_A' : 'qV_j';
          this.dimension(ctx, geo.X(xq), m.FN(0), m.FP(0), lab + ' = `' + f.eV(m.FN(0) - m.FP(0), 2) + '`', geo,
            { color: 'rgba(232, 236, 248, 0.85)', size: 13, optional: true });
        }
      }
    }

    annotateBulk(ctx, geo) {
      const m = this.model, f = SV.fmt;
      const xr = m.xMax - m.xMin;
      const xg = m.xMin + xr * 0.12;
      this.dimension(ctx, geo.X(xg), m.Ec(xg), m.Ev(xg), 'E_g = `' + f.eV(m.fr.Eg, 2) + '`', geo, { optional: true });
      const xa = m.xMin + xr * 0.72;
      this.dimension(ctx, geo.X(xa), m.Ec(xa), m.EF(xa), 'E_c − E_F = `' + f.eV(m.cMinusF) + '`', geo, { size: 14, optional: true });
      const xb = m.xMin + xr * 0.86;
      this.dimension(ctx, geo.X(xb), m.EF(xb), m.Ev(xb), 'E_F − E_v = `' + f.eV(m.fMinusV) + '`', geo, { size: 14, side: 'left', optional: true });
      const xc = m.xMin + xr * 0.42;
      if (Math.abs(geo.Y(m.EF(xc)) - geo.Y(m.Ei(xc))) > 10) {
        this.dimension(ctx, geo.X(xc), m.EF(xc), m.Ei(xc), 'E_F − E_i = `' + f.signed(m.FminusI, 3) + ' eV`', geo,
          { color: 'rgba(255, 200, 87, 0.9)', size: 14, optional: true });
      } else {
        drawMath(ctx, 'E_F ≈ E_i', geo.X(xc) + 8, geo.Y(m.EF(xc)) - 10, { size: 14, color: C.ef, pill: true });
      }
    }

    /* lane above the bands: depletion width bracket and field arrows */
    drawLane(ctx, geo) {
      const m = this.model, f = SV.fmt;
      const yb = geo.laneTop + 10, ya = geo.laneTop + geo.laneH - 14;
      ctx.save();
      if (geo.pn) {
        const x1 = geo.X(-m.xp), x2 = geo.X(m.xn);
        ctx.strokeStyle = 'rgba(182, 156, 255, 0.75)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1, yb + 6); ctx.lineTo(x1, yb); ctx.lineTo(x2, yb); ctx.lineTo(x2, yb + 6);
        ctx.stroke();
        const wl = f.length(m.W);
        drawMath(ctx, 'W = `' + wl.v + ' ' + wl.u + '`', (x1 + x2) / 2, yb + 4, { size: 14, color: C.text, align: 'center', pill: true });
      }
      if (this.opts.field) {
        let xsArrows = [], mag = () => 0, Escale = 1;
        if (geo.pn) {
          const x1 = geo.X(-m.xp), x2 = geo.X(m.xn);
          const n = Math.max(1, Math.floor((x2 - x1) / 34));
          for (let i = 0; i < n; i++) xsArrows.push(x1 + (x2 - x1) * (i + 0.5) / n);
          mag = (px) => Math.abs(m.field(geo.xOf(px)));
          Escale = m.Emax || 1;
        } else if (Math.abs(m.V) > 1e-6) {
          const n = Math.floor(geo.plotW / 70);
          for (let i = 0; i < n; i++) xsArrows.push(geo.plotL + geo.plotW * (i + 0.5) / n);
          mag = () => Math.abs(m.field);
          Escale = Math.abs(m.field);
        }
        const dir = geo.pn ? -1 : Math.sign(m.field);
        for (const px of xsArrows) {
          const r = Math.min(1, mag(px) / Escale);
          const len = 8 + 18 * r;
          ctx.globalAlpha = 0.35 + 0.65 * r;
          this.arrow(ctx, px - dir * len / 2, ya, px + dir * len / 2, ya, C.field, 1.6);
        }
        ctx.globalAlpha = 1;
        // ohmic field in the neutral regions once current is large (points p -> n)
        if (geo.pn && Math.abs(m.seriesDrop) > 0.01) {
          for (const [a, b] of [[m.xMin, m.pIn], [m.nIn, m.xMax]]) {
            const xc = (geo.X(a) + geo.X(b)) / 2;
            ctx.globalAlpha = 0.8;
            this.arrow(ctx, xc - 12, ya, xc + 12, ya, C.field, 1.6);
          }
          ctx.globalAlpha = 1;
        }
        if (xsArrows.length) {
          const lx = geo.pn ? geo.X(-m.xp) - 12 : geo.plotL + 6;
          drawMath(ctx, 'ℰ', lx, ya + 5, { size: 17, color: C.field, align: geo.pn ? 'right' : 'left' });
        }
      }
      ctx.restore();
    }

    arrow(ctx, x1, y1, x2, y2, color, w) {
      const a = Math.atan2(y2 - y1, x2 - x1), hl = 5.5;
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - Math.cos(a) * hl * 0.6, y2 - Math.sin(a) * hl * 0.6); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - hl * Math.cos(a - 0.45), y2 - hl * Math.sin(a - 0.45));
      ctx.lineTo(x2 - hl * Math.cos(a + 0.45), y2 - hl * Math.sin(a + 0.45));
      ctx.closePath(); ctx.fill();
    }

    /* level names at the plot edges: p side on the left, n side on the right */
    edgeLabels(ctx, items, x, align) {
      items.forEach((it) => { it.y = this.geo.Y(it.E) + 5; });
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
      this.geo = geo;
      const biased = geo.pn && Math.abs(m.VA) > 1e-9;
      const efColor = (side) => (biased && o.quasi ? (side === 'p' ? C.fp : C.fn) : C.ef);
      if (!geo.pn) {
        this.edgeLabels(ctx, [
          { s: 'E_c', E: m.Ec(m.xMax), c: C.band },
          { s: 'E_i', E: m.Ei(m.xMax), c: 'rgba(225,232,255,0.7)' },
          { s: 'E_F', E: m.EF(m.xMax), c: C.ef },
          { s: 'E_v', E: m.Ev(m.xMax), c: C.band }
        ], geo.plotR + 12, 'left');
        return;
      }
      const xr = m.xMax, xl = m.xMin;
      this.edgeLabels(ctx, [
        { s: 'E_{cn}', E: m.Ec(xr), c: C.band },
        { s: 'E_{in}', E: m.Ei(xr), c: 'rgba(225,232,255,0.7)' },
        { s: 'E_{Fn}', E: m.FN(xr), c: efColor('n') },
        { s: 'E_{vn}', E: m.Ev(xr), c: C.band }
      ], geo.plotR + 12, 'left');
      if (geo.sideLabels) {
        this.edgeLabels(ctx, [
          { s: 'E_{cp}', E: m.Ec(xl), c: C.band },
          { s: 'E_{ip}', E: m.Ei(xl), c: 'rgba(225,232,255,0.7)' },
          { s: 'E_{Fp}', E: m.FP(xl), c: efColor('p') },
          { s: 'E_{vp}', E: m.Ev(xl), c: C.band }
        ], geo.plotL - 12, 'right');
      }
      if (!geo.narrow) {
        ctx.save();
        ctx.font = `500 12px ${UI_STACK}`;
        ctx.fillStyle = C.dim;
        ctx.textAlign = 'left';
        ctx.fillText('p-type', geo.X(m.pIn) + 14, geo.bandTop + 16);
        ctx.textAlign = 'right';
        ctx.fillText('n-type', geo.X(m.nIn) - 14, geo.bandTop + 16);
        ctx.restore();
      }
    }

    drawStrips(ctx, geo) {
      const m = this.model, f = SV.fmt;
      const x1 = geo.X(-m.xp), x0 = geo.X(0), x2 = geo.X(m.xn);

      // charge density
      {
        const mid = (geo.rhoTop + geo.rhoBot) / 2, half = (geo.rhoBot - geo.rhoTop) / 2 - 4;
        const big = Math.max(m.NA, m.ND);
        const hA = Math.max(2, half * m.NA / big), hD = Math.max(2, half * m.ND / big);
        ctx.save();
        ctx.strokeStyle = C.axis; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(geo.plotL, mid); ctx.lineTo(geo.plotR, mid); ctx.stroke();
        ctx.fillStyle = 'rgba(255, 107, 139, 0.32)';
        ctx.fillRect(x1, mid, x0 - x1, hA);
        ctx.fillStyle = 'rgba(92, 200, 255, 0.32)';
        ctx.fillRect(x0, mid - hD, x2 - x0, hD);
        ctx.strokeStyle = 'rgba(255, 107, 139, 0.9)';
        ctx.strokeRect(x1 + 0.5, mid, x0 - x1, hA);
        ctx.strokeStyle = 'rgba(92, 200, 255, 0.9)';
        ctx.strokeRect(x0 + 0.5, mid - hD, x2 - x0, hD);
        ctx.font = `600 11px ${UI_STACK}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (x0 - x1 > 14 && hA > 11) { ctx.fillStyle = C.fp; for (let px = x1 + 8; px < x0 - 4; px += 16) ctx.fillText('−', px, mid + hA / 2); }
        if (x2 - x0 > 14 && hD > 11) { ctx.fillStyle = C.fn; for (let px = x0 + 8; px < x2 - 4; px += 16) ctx.fillText('+', px, mid - hD / 2); }
        ctx.restore();
        drawMath(ctx, 'ρ', geo.plotL - 12, mid + 5, { size: 17, color: C.dim, align: 'right' });
        if (!geo.narrow) {
          drawMath(ctx, '−qN_A', x1 - 8, mid + hA - 1, { size: 13, color: C.fp, align: 'right' });
          drawMath(ctx, '+qN_D', x2 + 8, mid - hD + 11, { size: 13, color: C.fn, align: 'left' });
        }
      }

      // electric field (negative: points from n to p)
      {
        const base = geo.efTop + 6, depth = geo.efBot - geo.efTop - 10;
        ctx.save();
        ctx.strokeStyle = C.axis; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(geo.plotL, base); ctx.lineTo(geo.plotR, base); ctx.stroke();
        const yPeak = base + depth;
        ctx.beginPath();
        ctx.moveTo(x1, base); ctx.lineTo(x0, yPeak); ctx.lineTo(x2, base); ctx.closePath();
        const g = ctx.createLinearGradient(0, base, 0, yPeak);
        g.addColorStop(0, 'rgba(182, 156, 255, 0.05)');
        g.addColorStop(1, 'rgba(182, 156, 255, 0.4)');
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = C.field; ctx.lineWidth = 1.5;
        ctx.shadowColor = C.field; ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.restore();
        drawMath(ctx, 'ℰ', geo.plotL - 12, base + depth / 2 + 6, { size: 17, color: C.field, align: 'right' });
        const lbl = '|ℰ|_{max} = ' + f.sciMath(m.Emax, 2, 'V/cm');
        drawMath(ctx, lbl, Math.min(x0 + 10, geo.plotR - 160), yPeak - 2, { size: 13, color: C.text, pill: true });
      }
    }

    drawXAxis(ctx, geo) {
      const m = this.model;
      const y = geo.axisY;
      const toUm = 1e4;
      const lo = geo.pn ? m.pIn : m.xMin, hi = geo.pn ? m.nIn : m.xMax;
      const step = niceStep((hi - lo) * toUm, geo.narrow ? 4 : 7);
      ctx.save();
      ctx.strokeStyle = C.axis; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(geo.plotL, y); ctx.lineTo(geo.plotR, y); ctx.stroke();
      ctx.font = `500 11px ${UI_STACK}`;
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const dec = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
      for (let u = Math.ceil(lo * toUm / step) * step; u <= hi * toUm + 1e-9; u += step) {
        const px = geo.X(u / toUm);
        if (geo.pn && (px < geo.X(m.pIn) + 10 || px > geo.X(m.nIn) - 10)) continue;
        ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + 4); ctx.stroke();
        const s = Math.abs(u) < step / 1000 ? '0' : u.toFixed(dec).replace('-', '−');
        ctx.fillText(s, px, y + 7);
      }
      if (geo.pn && !geo.narrow) {
        // compressed zones: how far it really is to each contact
        const cp = (geo.X(m.xMin) + geo.X(m.pIn)) / 2, cn = (geo.X(m.nIn) + geo.X(m.xMax)) / 2;
        ctx.fillText('≈' + SV.fmt.lengthStr(m.lp), cp, y + 7);
        ctx.fillText('≈' + SV.fmt.lengthStr(m.ln), cn, y + 7);
        ctx.fillText('to contact', cp, y + 19);
        ctx.fillText('to contact', cn, y + 19);
      }
      ctx.restore();
      drawMath(ctx, 'x `(µm)`', geo.plotR + 12, y + 17, { size: 13, color: C.dim });

      if (geo.pn) {
        const x1 = geo.X(-m.xp), x2 = geo.X(m.xn);
        const yl = geo.bandBot - 8;
        const close = x2 - x1 < 70;
        drawMath(ctx, '−x_p', x1 - (close ? 6 : 0), yl, { size: 14, color: C.field, align: close ? 'right' : 'center', pill: true });
        drawMath(ctx, 'x_n', x2 + (close ? 6 : 0), yl, { size: 14, color: C.field, align: close ? 'left' : 'center', pill: true });
      }
    }

    /* ---------- hover ---------- */
    setHover(px) {
      this.hoverPx = px;
    }

    /* everything at the hovered position, for the tooltip */
    info(px) {
      const geo = this.geo, m = this.model;
      if (!geo || px < geo.plotL || px > geo.plotR) return null;
      const x = geo.xOf(px);
      const out = { x, px };
      if (m.mode === 'pn') {
        const s = x < 0 ? 'p' : 'n';
        let region;
        if (x < m.pIn) region = `p-side neutral region, toward the contact (compressed: ≈${SV.fmt.lengthStr(m.lp)})`;
        else if (x > m.nIn) region = `n-side neutral region, toward the contact (compressed: ≈${SV.fmt.lengthStr(m.ln)})`;
        else if (x <= -m.xp) region = 'p-side neutral region';
        else if (x < 0) region = 'Depletion region, p side (ionized acceptors)';
        else if (x < m.xn) region = 'Depletion region, n side (ionized donors)';
        else region = 'n-side neutral region';
        out.region = region;
        out.side = s;
        out.compressed = x < m.pIn || x > m.nIn;
        const biased = Math.abs(m.VA) > 1e-9;
        out.levels = [
          { key: 'Ec', name: 'E_{c' + s + '}', E: m.Ec(x), color: C.band, desc: 'conduction-band edge' },
          { key: 'Ei', name: 'E_{i' + s + '}', E: m.Ei(x), color: 'rgba(225,232,255,0.75)', desc: 'intrinsic level' }
        ];
        if (biased) {
          out.levels.push({ key: 'FN', name: 'F_N', E: m.FN(x), color: C.fn, desc: s === 'n' ? 'electron quasi-Fermi level (= E_Fn here)' : 'electron quasi-Fermi level (minority)' });
          out.levels.push({ key: 'FP', name: 'F_P', E: m.FP(x), color: C.fp, desc: s === 'p' ? 'hole quasi-Fermi level (= E_Fp here)' : 'hole quasi-Fermi level (minority)' });
        } else {
          out.levels.push({ key: 'EF', name: 'E_{F' + s + '}', E: m.EF(x), color: C.ef, desc: 'Fermi level' });
        }
        out.levels.push({ key: 'Ev', name: 'E_{v' + s + '}', E: m.Ev(x), color: C.band, desc: 'valence-band edge' });
        out.n = m.nAt(x); out.p = m.pAt(x);
        out.field = m.field(x);
        out.V = m.Ei(m.xMin) - m.Ei(x);
      } else {
        out.region = 'Uniformly doped sample';
        out.levels = [
          { key: 'Ec', name: 'E_c', E: m.Ec(x), color: C.band, desc: 'conduction-band edge' },
          { key: 'Ei', name: 'E_i', E: m.Ei(x), color: 'rgba(225,232,255,0.75)', desc: 'intrinsic level' },
          { key: 'EF', name: 'E_F', E: m.EF(x), color: C.ef, desc: 'Fermi level' },
          { key: 'Ev', name: 'E_v', E: m.Ev(x), color: C.band, desc: 'valence-band edge' }
        ];
        out.n = m.n0; out.p = m.p0; out.field = m.field;
      }
      return out;
    }

    drawCrosshair(ctx, geo) {
      const inf = this.info(this.hoverPx);
      if (!inf) return;
      const px = this.hoverPx;
      ctx.save();
      ctx.strokeStyle = 'rgba(232, 236, 248, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(px, geo.bandTop); ctx.lineTo(px, geo.bottom); ctx.stroke();
      ctx.setLineDash([]);
      for (const lv of inf.levels) {
        const y = geo.Y(lv.E);
        if (y < geo.bandTop || y > geo.bandBot) continue;
        ctx.beginPath();
        ctx.arc(px, y, 3.6, 0, Math.PI * 2);
        ctx.fillStyle = C.bg; ctx.fill();
        ctx.lineWidth = 1.6; ctx.strokeStyle = lv.color; ctx.stroke();
      }
      ctx.restore();
    }

    /* ---------- carriers ---------- */
    seed() {
      this.particles = [];
      this.events = [];
      this.acc = {};
      const m = this.model;
      if (!m) return;
      if (m.mode === 'pn') {
        const cnt = (N) => Math.round(Math.max(8, Math.min(26, 9 + 2.6 * Math.log10(N / 1e13))));
        for (let i = 0; i < cnt(m.ND); i++) this.particles.push(this.bgParticle('e', 'n'));
        for (let i = 0; i < cnt(m.NA); i++) this.particles.push(this.bgParticle('h', 'p'));
        for (let i = 0; i < 2; i++) {
          this.particles.push(this.bgParticle('e', 'p'));
          this.particles.push(this.bgParticle('h', 'n'));
        }
      } else {
        const count = (c) => c >= m.ni
          ? Math.round(Math.min(70, 8 + 5.5 * Math.log10(c / m.ni)))
          : Math.round(8 * Math.pow(c / m.ni, 0.12));
        const ne = count(m.n0), nh = count(m.p0);
        for (let i = 0; i < ne; i++) this.particles.push(this.bulkParticle('e'));
        for (let i = 0; i < nh; i++) this.particles.push(this.bulkParticle('h'));
      }
    }

    bgParticle(sp, side) {
      const m = this.model;
      const [a, b] = side === 'p' ? [m.xMin, -m.xp] : [m.xn, m.xMax];
      return {
        sp, kind: 'bg', side, x: a + rand() * (b - a),
        vx: (rand() - 0.5) * 0.12, off: 3 + rand() * 13, alpha: 1, dying: false, ...lifespan()
      };
    }

    bulkParticle(sp) {
      return { sp, kind: 'bulk', x: rand(), vx: (rand() - 0.5) * 0.1, off: 3 + rand() * 13, alpha: 1, dying: false, ...lifespan() };
    }

    /* replace a carrier that has faded out with a new one somewhere else, fading in */
    recycle(p) {
      const q = p.kind === 'bg' ? this.bgParticle(p.sp, p.side) : this.bulkParticle(p.sp);
      q.alpha = 0; q.age = 0;
      return q;
    }

    step(dt, geo) {
      const m = this.model;
      if (m.mode === 'pn') this.stepPN(dt, geo); else this.stepBulk(dt);
    }

    stepBulk(dt) {
      const m = this.model;
      const vmag = 0.14 * Math.abs(m.V);
      const dirE = m.V > 0 ? 1 : -1;                        // electrons move toward the + contact
      const muRatio = Math.max(0.15, Math.min(1, m.muP / m.muN));
      this.particles = this.particles.map((p) => {
        p.age += dt;
        if (p.age > p.life) p.dying = true;
        if (p.dying) p.alpha -= dt * 1.5; else p.alpha = Math.min(1, p.alpha + dt * 1.5);
        return p.alpha <= 0 ? this.recycle(p) : p;
      });
      for (const p of this.particles) {
        p.vx += (rand() - 0.5) * 0.6 * dt;
        p.vx = Math.max(-0.07, Math.min(0.07, p.vx));
        const drift = p.sp === 'e' ? dirE * vmag : -dirE * vmag * muRatio;
        p.x += (p.vx + drift) * dt;
        if (p.x > 1) { p.x -= 1; p.tr = null; }
        if (p.x < 0) { p.x += 1; p.tr = null; }
        p.off += (rand() - 0.5) * 8 * dt;
        p.off = Math.max(2, Math.min(17, p.off));
        p.kind = vmag > 0 ? 'bulkDrift' : 'bulk';
      }
    }

    stepPN(dt) {
      const m = this.model;
      const xr = m.xMax - m.xMin;
      const kTv = m.Vbi / Math.log(5);                       // visual spread: 20% cross at V_A = 0
      const P0 = 0.2;
      const shareN = m.J0n / m.J0, shareP = m.J0p / m.J0;
      const vis = (s) => 0.2 + 0.8 * s;
      const R = 1.5;                                         // drift carriers per second (both species)
      const rates = {
        eDrift: R * vis(shareN), hDrift: R * vis(shareP),
        eTry: R * vis(shareN) / P0, hTry: R * vis(shareP) / P0
      };
      for (const key in rates) {
        this.acc[key] = (this.acc[key] || 0) + rates[key] * dt;
        while (this.acc[key] >= 1) { this.acc[key] -= 1; this.spawn(key, kTv); }
      }
      const EcN = m.Ec(m.xn), EvP = m.Ev(-m.xp);
      const Escale = Math.max(m.Emax, 1);
      const alive = [];
      for (const p of this.particles) {
        p.age += dt;
        if (p.kind === 'bg') {
          const [a, b] = p.side === 'p' ? [m.xMin, -m.xp] : [m.xn, m.xMax];
          p.vx += (rand() - 0.5) * 0.5 * dt;
          p.vx = Math.max(-0.08, Math.min(0.08, p.vx));
          p.x += p.vx * xr * dt;
          if (p.x < a) { p.x = a + (a - p.x); p.vx = Math.abs(p.vx); }
          if (p.x > b) { p.x = b - (p.x - b); p.vx = -Math.abs(p.vx); }
          if (p.x < a || p.x > b) p.x = a + rand() * Math.max(0, b - a);
          p.off += (rand() - 0.5) * 8 * dt;
          p.off = Math.max(2, Math.min(17, p.off));
          if (p.age > p.life) p.dying = true;
        } else if (p.kind === 'try') {
          const e = p.sp === 'e';
          const sgn = e ? -1 : 1;                              // electrons head -x, holes +x
          if (p.state === 'go') {
            p.x += sgn * p.v * xr * dt;
            const edge = e ? m.Ec(p.x) : m.Ev(p.x);
            const Eabs = e ? EcN + p.eps : EvP - p.eps;
            if (e ? edge > Eabs : edge < Eabs) {
              p.state = 'back';
            } else if (e ? p.x < -m.xp : p.x > m.xn) {
              p.state = 'cross';
              p.E = Eabs;
            }
          } else if (p.state === 'back') {
            p.x -= sgn * p.v * 0.8 * xr * dt;
            if (p.age > p.life) p.dying = true;
          } else {                                             // crossed: thermalize, then recombine
            p.v *= Math.exp(-dt * 0.9);
            p.x += sgn * p.v * xr * dt;
            const edge = e ? m.Ec(p.x) : m.Ev(p.x);
            const k = 1 - Math.exp(-dt * 2.2);
            p.E += (edge - p.E) * k;
            p.travel += p.v * dt;
            // recombine once it has gone far enough, or has nearly stopped,
            // so injected carriers never pile up beside the junction
            if ((p.travel > p.reach || p.v < 0.04 || p.age > 5) && !p.dying) {
              p.dying = true;
              this.events.push({ type: 'rec', x: p.x, t: 0 });
            }
          }
        } else if (p.kind === 'drift') {
          const e = p.sp === 'e';
          const sgn = e ? 1 : -1;                              // minority electrons fall to n, holes float to p
          const inside = p.x > -m.xp && p.x < m.xn;
          const speed = 0.05 + (inside ? 0.55 * Math.abs(m.field(p.x)) / Escale : 0);
          p.x += sgn * speed * xr * dt;
          const past = e ? p.x > m.xn : p.x < -m.xp;
          if (past) { p.travel += speed * dt; if (p.travel > 0.12) p.dying = true; }
          p.off += (rand() - 0.5) * 6 * dt;
          p.off = Math.max(2, Math.min(10, p.off));
        }
        if (p.kind !== 'bg' && p.age > 7) p.dying = true;   // nothing lingers
        if (p.dying) { p.alpha -= dt * (p.kind === 'bg' ? 1.5 : 2.2); } else { p.alpha = Math.min(1, p.alpha + dt * (p.kind === 'bg' ? 1.5 : 4)); }
        if (p.alpha > 0 && p.x >= m.xMin && p.x <= m.xMax) alive.push(p);
        else if (p.kind === 'bg') alive.push(this.recycle(p));
      }
      this.particles = alive;
      for (const ev of this.events) ev.t += dt / 1.0;
      this.events = this.events.filter((ev) => ev.t < 1);
    }

    spawn(key, kTv) {
      const m = this.model;
      const pW = -m.xp - m.pIn, nW = m.nIn - m.xn;
      if (key === 'eTry') {
        this.particles.push({ sp: 'e', kind: 'try', state: 'go', x: m.xn + rand() * nW * 0.5,
          eps: -kTv * Math.log(1 - rand()), v: 0.16 + rand() * 0.1, off: 3, age: 0, life: 1.2 + rand(),
          alpha: 0, travel: 0, reach: 0.12 + rand() * 0.25 });
      } else if (key === 'hTry') {
        this.particles.push({ sp: 'h', kind: 'try', state: 'go', x: -m.xp - rand() * pW * 0.5,
          eps: -kTv * Math.log(1 - rand()), v: 0.16 + rand() * 0.1, off: 3, age: 0, life: 1.2 + rand(),
          alpha: 0, travel: 0, reach: 0.12 + rand() * 0.25 });
      } else if (key === 'eDrift') {
        const x = -m.xp - rand() * pW * 0.3;
        this.particles.push({ sp: 'e', kind: 'drift', x, off: 3 + rand() * 6, age: 0, alpha: 0, travel: 0 });
        this.events.push({ type: 'gen', x, t: 0 });
      } else if (key === 'hDrift') {
        const x = m.xn + rand() * nW * 0.3;
        this.particles.push({ sp: 'h', kind: 'drift', x, off: 3 + rand() * 6, age: 0, alpha: 0, travel: 0 });
        this.events.push({ type: 'gen', x, t: 0 });
      }
    }

    drawParticles(ctx, geo) {
      const m = this.model;
      ctx.save();
      ctx.beginPath();
      ctx.rect(geo.plotL, geo.bandTop, geo.plotW, geo.bandH);
      ctx.clip();
      const EcN = m.mode === 'pn' ? m.Ec(m.xn) : 0;
      const EvP = m.mode === 'pn' ? m.Ev(-m.xp) : 0;
      if (m.mode === 'pn') for (const ev of this.events) this.drawRGEvent(ctx, geo, ev);
      for (const p of this.particles) {
        const x = m.mode === 'bulk' ? m.xMin + p.x * (m.xMax - m.xMin) : p.x;
        const e = p.sp === 'e';
        let y;
        if (p.kind === 'try') {
          const edge = e ? m.Ec(x) : m.Ev(x);
          const E = p.state === 'cross' ? p.E : (e ? EcN + p.eps : EvP - p.eps);
          const yEdge = geo.Y(edge), yE = geo.Y(E);
          y = e ? Math.min(yEdge - p.off, yE) : Math.max(yEdge + p.off, yE);
        } else {
          y = e ? geo.Y(m.Ec(x)) - p.off : geo.Y(m.Ev(x)) + p.off;
        }
        const sx = geo.X(x);
        const a = Math.max(0, Math.min(1, p.alpha));
        // trail colored by mechanism: diffusion (mint) or drift (violet)
        const trailColor = p.kind === 'try' ? C.diff : (p.kind === 'drift' || p.kind === 'bulkDrift') ? C.field : null;
        if (trailColor) {
          p.tr = p.tr || [];
          p.tr.push(sx, y);
          if (p.tr.length > 24) p.tr.splice(0, 2);
          const n = p.tr.length / 2;
          ctx.strokeStyle = trailColor;
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          for (let i = 1; i < n; i++) {
            ctx.globalAlpha = a * 0.75 * (i / n);
            ctx.beginPath();
            ctx.moveTo(p.tr[2 * i - 2], p.tr[2 * i - 1]);
            ctx.lineTo(p.tr[2 * i], p.tr[2 * i + 1]);
            ctx.stroke();
          }
        } else {
          p.tr = null;
        }
        const s = this.sprites[p.sp];
        ctx.globalAlpha = a;
        ctx.drawImage(s.img, sx - s.size / 2, y - s.size / 2, s.size, s.size);
        p.sx = sx; p.sy = y;
        if (p === this.hoverParticle) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(sx, y, 9, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.restore();
    }

    /* trap-assisted recombination (electron falls Ec -> E_T -> Ev) or generation (reverse) */
    drawRGEvent(ctx, geo, ev) {
      const m = this.model;
      const x = geo.X(ev.x);
      if (x < geo.plotL || x > geo.plotR) return;
      const yC = geo.Y(m.Ec(ev.x)) - 4, yV = geo.Y(m.Ev(ev.x)) + 4, yT = geo.Y(m.Ei(ev.x));
      const t = ev.t, a = Math.min(1, t * 8) * (1 - Math.max(0, (t - 0.75) / 0.25));
      const [y0, y2] = ev.type === 'rec' ? [yC, yV] : [yV, yC];
      const s1 = Math.min(1, t / 0.35), s2 = Math.max(0, Math.min(1, (t - 0.35) / 0.35));
      const yNow = t < 0.35 ? y0 + (yT - y0) * s1 : yT + (y2 - yT) * s2;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = C.rgc; ctx.fillStyle = C.rgc;
      ctx.shadowColor = C.rgc; ctx.shadowBlur = 8;
      ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, yNow); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeRect(x - 4, yT - 4, 8, 8);
      ctx.beginPath(); ctx.arc(x, yNow, 2.6, 0, Math.PI * 2); ctx.fill();
      // flash where the pair is destroyed (rec) or created (gen)
      const fy = ev.type === 'rec' ? y2 : y0;
      const ft = ev.type === 'rec' ? Math.max(0, (t - 0.68) / 0.3) : t / 0.3;
      if (ft > 0 && ft < 1) {
        const r = 3 + 12 * ft;
        const g = ctx.createRadialGradient(x, fy, 0, x, fy, r);
        g.addColorStop(0, 'rgba(142, 240, 196, 0.85)'); g.addColorStop(1, 'rgba(142, 240, 196, 0)');
        ctx.globalAlpha = a * (1 - ft);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, fy, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    /* carrier under the pointer, for the hover story */
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

  Diagram.drawMath = drawMath;
  return Diagram;
})();
