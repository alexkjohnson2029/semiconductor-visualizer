/*
 * Recombination–generation view (Pierret Ch. 3).
 *
 * Flat bands of a uniformly doped sample with R–G centers at E_T. One
 * "featured" event of the chosen process plays step by step in the middle;
 * smaller events of the same mechanism run in the background, recombination
 * and generation in proportion to np/ni^2 (they balance in equilibrium).
 */
window.SV = window.SV || {};

SV.RG_PROCESSES = {
  b2bR: {
    mech: 'b2b', dir: 'R', title: 'Band-to-band recombination', dur: 3.6,
    steps: [
      [0, 'An electron at the bottom of the conduction band meets a hole at the top of the valence band.'],
      [0.35, 'The electron drops straight across the gap. The energy leaves as a photon, hν ≈ E_g.']
    ],
    note: 'Radiative. Strong in direct-gap GaAs, InP and GaN (LEDs, lasers); rare in Si, Ge and SiC, where the indirect gap also needs a phonon.'
  },
  b2bG: {
    mech: 'b2b', dir: 'G', title: 'Band-to-band generation', dur: 3.6,
    steps: [
      [0, 'A photon with hν ≥ E_g is absorbed.'],
      [0.4, 'Its energy lifts a valence electron into the conduction band, leaving a hole: one electron–hole pair.']
    ],
    note: 'Photogeneration (solar cells, photodiodes). The same process happens thermally, but across a full gap it is very slow.'
  },
  srhR: {
    mech: 'srh', dir: 'R', title: 'R–G center recombination', dur: 4.4,
    steps: [
      [0, 'An electron is captured by an empty R–G center at E_T, giving its energy to the lattice as phonons.'],
      [0.42, 'A hole is captured: the trapped electron drops into the valence band and fills it. The center is empty again.']
    ],
    note: 'Shockley–Read–Hall (trap-assisted). Dominant in Si. Centers near midgap (E_T ≈ E_i) are the most effective.'
  },
  srhG: {
    mech: 'srh', dir: 'G', title: 'R–G center generation', dur: 4.4,
    steps: [
      [0, 'A valence electron is emitted into the R–G center, leaving a hole behind.'],
      [0.5, 'The trapped electron is emitted into the conduction band. A pair is created using thermal energy from the lattice.']
    ],
    note: 'Wins wherever np < n_i², such as a reverse-biased depletion region. It supplies the reverse saturation (drift) current.'
  },
  aug: {
    mech: 'aug', dir: 'R', title: 'Auger recombination', dur: 4.4,
    steps: [
      [0, 'An electron and a hole meet.'],
      [0.25, 'They recombine, but the energy goes to a third carrier, kicking it high into the band.'],
      [0.5, 'The hot carrier relaxes back to the band edge, shedding the energy as phonons.']
    ],
    note: 'Needs three carriers, so it grows fast with density: important in heavily doped regions and at high injection.'
  },
  imp: {
    mech: 'aug', dir: 'G', title: 'Impact ionization', dur: 4.4,
    steps: [
      [0, 'A carrier accelerated by a strong field gains energy far above the band edge.'],
      [0.35, 'It collides and hands that energy to a valence electron, lifting it into the conduction band.'],
      [0.55, 'Now two electrons and a hole: each can repeat the process (avalanche).']
    ],
    note: 'The reverse of Auger. Needs ℰ of roughly 10⁵ V/cm or more; causes avalanche breakdown in reverse-biased junctions.'
  }
};

SV.RGView = (function () {
  const C = SV.COLORS;
  const drawMath = SV.Diagram.drawMath;
  const PHOTON = '#fff1a8', PHONON = '#ffb35c', TRAP = '#8ef0c4';
  const rand = Math.random;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const ease = (s) => s * s * (3 - 2 * s);
  const lerp = (a, b, s) => a + (b - a) * s;

  function sprite(rgb, hollow) {
    const s = 28, c = document.createElement('canvas');
    c.width = c.height = s * 2;
    const g = c.getContext('2d');
    g.scale(2, 2);
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, `rgba(${rgb}, 0.6)`);
    grd.addColorStop(1, `rgba(${rgb}, 0)`);
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    g.beginPath(); g.arc(s / 2, s / 2, hollow ? 3.8 : 3.5, 0, Math.PI * 2);
    if (hollow) { g.lineWidth = 1.7; g.strokeStyle = `rgb(${rgb})`; g.stroke(); }
    else { g.fillStyle = `rgb(${rgb})`; g.fill(); }
    return c;
  }

  class RGView {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.model = null;
      this.proc = 'srhR';
      this.events = [];
      this.carriers = [];
      this.feat = { t: 0, pause: 0 };
      this.acc = 0;
      this.tally = { R: 0, G: 0 };
      this.step = -1;
      this.onStep = null;
      this.sprites = { e: sprite('92, 200, 255', false), h: sprite(SV.COLORS.holeRGB || '255, 107, 139', true) };
      this.key = '';
    }

    setModel(model, proc, opts) {
      const key = [model.mat.key, model.T, model.n0, model.p0].join('|');
      const condKey = key + '|' + model.ratio.toPrecision(4) + '|' + proc;
      if (key !== this.key) { this.key = key; this.seed(model); }
      if (condKey !== this.condKey) { this.condKey = condKey; this.tally = { R: 0, G: 0 }; }
      if (proc !== this.proc) { this.feat = { t: 0, pause: 0 }; this.events = []; }
      this.model = model;
      this.proc = proc;
      this.opts = opts || {};
      if (this.carriers.length && model) this.reseedCounts(model);
    }

    seed(model) {
      this.carriers = [];
      this.reseedCounts(model);
    }

    reseedCounts(m) {
      const count = (c) => c >= m.ni
        ? Math.round(Math.min(40, 6 + 4.2 * Math.log10(c / m.ni)))
        : Math.round(Math.max(0, 6 * Math.pow(c / m.ni, 0.12)));
      const want = { e: Math.min(40, count(m.n)), h: Math.min(40, count(m.p)) };
      for (const sp of ['e', 'h']) {
        const have = this.carriers.filter((c) => c.sp === sp);
        if (have.length > want[sp]) {
          let drop = have.length - want[sp];
          this.carriers = this.carriers.filter((c) => !(c.sp === sp && drop-- > 0));
        }
        for (let i = have.length; i < want[sp]; i++) {
          this.carriers.push({ sp, x: rand(), vx: (rand() - 0.5) * 0.06, off: 3 + rand() * 14 });
        }
      }
    }

    geometry() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = this.canvas.width / dpr, h = this.canvas.height / dpr;
      const narrow = w < 640;
      const m = this.model;
      const plotL = narrow ? 30 : 64, plotR = w - (narrow ? 56 : 96);
      const bandTop = 58, bandBot = h - 30;
      const Eg = m.fr.Eg;
      const eTop = m.Ec + 1.05 * Eg, eBot = m.Ev - 0.5 * Eg;
      const Y = (E) => bandTop + (eTop - E) / (eTop - eBot) * (bandBot - bandTop);
      return {
        dpr, w, h, narrow, plotL, plotR, plotW: plotR - plotL, bandTop, bandBot, Y,
        X: (f) => plotL + f * (plotR - plotL),
        yC: Y(m.Ec), yV: Y(m.Ev), yT: Y(m.ET), yI: Y(m.Ei), pxPerEv: (bandBot - bandTop) / (eTop - eBot)
      };
    }

    frame(dt) {
      if (!this.model) return;
      dt = Math.min(dt, 0.05);
      const g = this.geometry();
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      this.drawBands(ctx, g);
      const animate = this.opts.animate !== false;
      if (animate) this.update(dt, g);
      this.drawCarriers(ctx, g);
      for (const ev of this.events) this.drawEvent(ctx, g, ev, false);
      this.drawEvent(ctx, g, { kind: this.proc, x: 0.5, t: Math.min(1, this.feat.t) }, true);
      this.drawTally(ctx, g);
      // featured step for the caption
      const P = SV.RG_PROCESSES[this.proc];
      let s = 0;
      P.steps.forEach((st, i) => { if (this.feat.t >= st[0]) s = i; });
      if (this.feat.t >= 1) s = P.steps.length - 1;
      if (s !== this.step) { this.step = s; if (this.onStep) this.onStep(s); }
    }

    update(dt, g) {
      const P = SV.RG_PROCESSES[this.proc];
      // featured event loops with a short pause
      if (this.feat.t < 1) this.feat.t += dt / P.dur;
      else {
        this.feat.pause += dt;
        if (this.feat.pause > 1.1) this.feat = { t: 0, pause: 0 };
      }
      // background events: recombination vs generation in proportion to np / ni^2
      const m = this.model;
      const lr = clamp(Math.log10(m.ratio), -40, 40);
      const fR = 1 / (1 + Math.pow(10, -lr / 4));
      this.acc += dt * 1.0;
      while (this.acc >= 1) {
        this.acc -= 1;
        const pair = Object.keys(SV.RG_PROCESSES).filter((k) => SV.RG_PROCESSES[k].mech === P.mech);
        const kR = pair.find((k) => SV.RG_PROCESSES[k].dir === 'R');
        const kG = pair.find((k) => SV.RG_PROCESSES[k].dir === 'G');
        const kind = rand() < fR ? kR : kG;
        let x;
        do { x = 0.07 + rand() * 0.86; } while (Math.abs(x - 0.5) < 0.16);
        this.events.push({ kind, x, t: 0, dur: SV.RG_PROCESSES[kind].dur * 0.75 });
      }
      for (const ev of this.events) {
        ev.t += dt / ev.dur;
        if (ev.t >= 1 && !ev.counted) { ev.counted = true; this.tally[SV.RG_PROCESSES[ev.kind].dir]++; }
      }
      this.events = this.events.filter((ev) => ev.t < 1.05);
      for (const c of this.carriers) {
        c.vx += (rand() - 0.5) * 0.3 * dt;
        c.vx = clamp(c.vx, -0.05, 0.05);
        c.x += c.vx * dt;
        if (c.x < 0) c.x += 1;
        if (c.x > 1) c.x -= 1;
        c.off = clamp(c.off + (rand() - 0.5) * 8 * dt, 2, 18);
      }
    }

    /* ---------- static-ish drawing ---------- */
    line(ctx, g, y, color, glow, width, dash) {
      ctx.save();
      if (dash) ctx.setLineDash(dash);
      if (glow) {
        ctx.strokeStyle = glow; ctx.globalAlpha = 0.55; ctx.lineWidth = width * 2.4;
        ctx.shadowColor = glow; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.moveTo(g.plotL, y); ctx.lineTo(g.plotR, y); ctx.stroke();
        ctx.globalAlpha = 1; ctx.shadowBlur = 8;
      }
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(g.plotL, y); ctx.lineTo(g.plotR, y); ctx.stroke();
      ctx.restore();
    }

    drawBands(ctx, g) {
      const m = this.model;
      // band tint
      let gr = ctx.createLinearGradient(0, g.yC, 0, g.bandTop);
      gr.addColorStop(0, 'rgba(92, 200, 255, 0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.fillRect(g.plotL, g.bandTop, g.plotW, g.yC - g.bandTop);
      gr = ctx.createLinearGradient(0, g.yV, 0, g.bandBot);
      gr.addColorStop(0, 'rgba(255, 107, 139, 0.07)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.fillRect(g.plotL, g.yV, g.plotW, g.bandBot - g.yV);

      this.line(ctx, g, g.yI, C.ei, null, 1.2, [5, 6]);
      // R–G centers
      this.line(ctx, g, g.yT, 'rgba(142, 240, 196, 0.55)', null, 1.1, [2, 5]);
      ctx.save();
      for (let x = g.plotL + 24; x < g.plotR - 10; x += 56) {
        if (Math.abs(x - g.X(0.5)) < 30) continue;
        ctx.strokeStyle = 'rgba(142, 240, 196, 0.5)'; ctx.lineWidth = 1.2;
        ctx.strokeRect(x - 3.5, g.yT - 3.5, 7, 7);
      }
      ctx.restore();
      if (m.ratio === 1) {
        this.line(ctx, g, g.Y(m.EF), C.ef, C.efGlow, 1.6);
      } else {
        this.line(ctx, g, g.Y(m.FN), C.fn, null, 1.6, [9, 6]);
        this.line(ctx, g, g.Y(m.FP), C.fp, null, 1.6, [9, 6]);
      }
      this.line(ctx, g, g.yC, C.band, C.bandGlow, 2.2);
      this.line(ctx, g, g.yV, C.band, C.bandGlow, 2.2);

      // labels on the right
      const items = [
        { s: 'E_c', y: g.yC, c: C.band },
        { s: 'E_T', y: g.yT, c: TRAP },
        { s: 'E_i', y: g.yI, c: 'rgba(225,232,255,0.7)' },
        { s: 'E_v', y: g.yV, c: C.band }
      ];
      if (m.ratio === 1) items.push({ s: 'E_F', y: g.Y(m.EF), c: C.ef });
      else { items.push({ s: 'F_N', y: g.Y(m.FN), c: C.fn }); items.push({ s: 'F_P', y: g.Y(m.FP), c: C.fp }); }
      items.forEach((it) => { it.ly = it.y + 5; });
      items.sort((a, b) => a.ly - b.ly);
      for (let pass = 0; pass < 6; pass++) {
        for (let i = 1; i < items.length; i++) {
          const d = items[i].ly - items[i - 1].ly;
          if (d < 17) { const s = (17 - d) / 2; items[i].ly += s; items[i - 1].ly -= s; }
        }
      }
      for (const it of items) {
        if (it.y < g.bandTop - 10 || it.y > g.bandBot + 10) continue;
        drawMath(ctx, it.s, g.plotR + 12, it.ly, { size: 16, color: it.c });
      }
      // band names
      ctx.save();
      ctx.font = '500 12px "Schibsted Grotesk", system-ui, sans-serif';
      ctx.fillStyle = C.dim;
      ctx.fillText('Conduction band', g.plotL + 8, g.bandTop + 14);
      ctx.fillText('Valence band', g.plotL + 8, g.bandBot - 8);
      ctx.restore();
    }

    drawTally(ctx, g) {
      const P = SV.RG_PROCESSES[this.proc];
      const names = { b2b: ['band-to-band recombination', 'band-to-band generation'], srh: ['R–G center recombination', 'R–G center generation'], aug: ['Auger', 'impact ionization'] }[P.mech];
      ctx.save();
      ctx.font = '500 12px "Schibsted Grotesk", system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = C.dim;
      const y = 26;
      if (!g.narrow) {
        ctx.fillText(`Background events: ${this.tally.R} ${names[0]}, ${this.tally.G} ${names[1]}`, g.plotR, y);
      }
      ctx.restore();
    }

    dot(ctx, x, y, sp, a) {
      const s = this.sprites[sp], z = this.big ? 40 : 28;
      ctx.globalAlpha = a;
      ctx.drawImage(s, x - z / 2, y - z / 2, z, z);
      ctx.globalAlpha = 1;
    }

    drawCarriers(ctx, g) {
      ctx.save();
      for (const c of this.carriers) {
        const x = g.X(c.x);
        const y = c.sp === 'e' ? g.yC - c.off : g.yV + c.off;
        this.dot(ctx, x, y, c.sp, 0.55);
      }
      ctx.restore();
    }

    /* ---------- event pieces ---------- */
    jump(ctx, x, y1, y2, s, color, a) {
      // dashed glowing path of a vertical transition, drawn up to progress s
      if (s <= 0) return;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.setLineDash([3, 4]);
      ctx.shadowColor = color; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, lerp(y1, y2, s)); ctx.stroke();
      ctx.restore();
    }
    photon(ctx, x1, y1, x2, y2, s, a, label) {
      if (s <= 0) return;
      const len = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1);
      const head = len * s, tail = Math.max(0, head - 70);
      ctx.save();
      ctx.translate(x1, y1); ctx.rotate(ang);
      ctx.globalAlpha = a;
      ctx.strokeStyle = PHOTON; ctx.lineWidth = 1.8; ctx.shadowColor = PHOTON; ctx.shadowBlur = 8;
      ctx.beginPath();
      for (let d = tail; d <= head; d += 2) {
        const yy = Math.sin(d * 0.35) * 5;
        if (d === tail) ctx.moveTo(d, yy); else ctx.lineTo(d, yy);
      }
      ctx.stroke();
      ctx.fillStyle = PHOTON;
      ctx.beginPath(); ctx.moveTo(head + 6, 0); ctx.lineTo(head - 2, -4); ctx.lineTo(head - 2, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
      if (label) drawMath(ctx, label, x1 + (x2 - x1) * s + 12, y1 + (y2 - y1) * s - 6, { size: 14, color: PHOTON, pill: true });
    }
    phonon(ctx, x, y, s, a, dir, label) {
      if (s <= 0 || s >= 1) return;
      ctx.save();
      ctx.globalAlpha = a * (1 - s);
      ctx.strokeStyle = PHONON; ctx.lineWidth = 1.5;
      const x0 = x + dir * 6 * s * 6;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const px = x0 + dir * i * 4, py = y + (i % 2 ? -4 : 4);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
      if (label && s < 0.85) drawMath(ctx, label, x0 + dir * 32, y + 4, { size: 12, color: PHONON, align: dir > 0 ? 'left' : 'right', pill: true });
    }
    trapBox(ctx, x, y, filled, a, label) {
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = TRAP; ctx.lineWidth = 1.6; ctx.shadowColor = TRAP; ctx.shadowBlur = 8;
      ctx.strokeRect(x - 5, y - 5, 10, 10);
      if (filled) { ctx.fillStyle = 'rgba(92, 200, 255, 0.95)'; ctx.fillRect(x - 3, y - 3, 6, 6); }
      ctx.restore();
      if (label) drawMath(ctx, '`R–G center`', x - 12, y + 4, { size: 12, color: TRAP, align: 'right', pill: true });
    }
    flash(ctx, x, y, s, a) {
      if (s <= 0 || s >= 1) return;
      ctx.save();
      ctx.globalAlpha = a * (1 - s);
      const r = 4 + 16 * s;
      const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255, 255, 255, 0.9)'); grd.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    drawEvent(ctx, g, ev, featured) {
      const t = ev.t;
      if (t < 0) return;
      const A = (featured ? 1 : 0.5) * seg(t, 0, 0.06) * (1 - seg(t, 0.94, 1.0));
      const x = g.X(ev.x);
      const yc = g.yC - 7, yv = g.yV + 7, yt = g.yT, mid = (g.yC + g.yV) / 2;
      const span = featured ? 70 : 42;
      const L = featured;                         // labels only on the featured event
      this.big = featured;
      ctx.save();
      switch (ev.kind) {
        case 'b2bR': {
          const s1 = ease(seg(t, 0, 0.35)), s2 = ease(seg(t, 0.35, 0.6));
          const ex = lerp(x - span, x, s1), hx = lerp(x + span, x, s1);
          if (t < 0.6) {
            this.jump(ctx, x, yc, yv, s2, C.electron, A);
            this.dot(ctx, ex, lerp(yc, yv, s2), 'e', A);
            this.dot(ctx, hx, yv, 'h', A);
          }
          this.flash(ctx, x, yv, seg(t, 0.58, 0.75), A);
          this.photon(ctx, x, mid, x + (featured ? 150 : 80), mid - (featured ? 90 : 50), ease(seg(t, 0.6, 0.95)), A,
            L ? 'hν ≈ E_g' : null);
          break;
        }
        case 'b2bG': {
          this.photon(ctx, x - (featured ? 160 : 90), mid - (featured ? 90 : 50), x, mid, ease(seg(t, 0, 0.4)), A * (1 - seg(t, 0.4, 0.45)),
            L && t < 0.42 ? 'hν ≥ E_g' : null);
          const s2 = ease(seg(t, 0.42, 0.62)), s3 = ease(seg(t, 0.62, 1));
          if (t >= 0.42) {
            this.flash(ctx, x, mid, seg(t, 0.4, 0.55), A);
            this.jump(ctx, x, yv, yc, s2, C.electron, A * (1 - s3));
            this.dot(ctx, lerp(x, x + span, s3), lerp(yv, yc, s2), 'e', A);
            this.dot(ctx, lerp(x, x - span, s3), yv, 'h', A);
          }
          break;
        }
        case 'srhR': {
          const s1 = ease(seg(t, 0, 0.22)), s2 = ease(seg(t, 0.22, 0.42));
          const sh = ease(seg(t, 0.42, 0.62)), s4 = ease(seg(t, 0.62, 0.8));
          const filled = t >= 0.42 && t < 0.8;
          this.trapBox(ctx, x, yt, filled, Math.max(A, featured ? 1 : 0.5), L);
          if (t < 0.42) {
            this.jump(ctx, x, yc, yt, s2, C.electron, A);
            this.dot(ctx, lerp(x - span, x, s1), lerp(yc, yt, s2), 'e', A);
          }
          this.phonon(ctx, x + 10, yt - 12, seg(t, 0.38, 0.6), A, 1, L ? '`phonon`' : null);
          if (t >= 0.42 && t < 0.8) {
            this.dot(ctx, lerp(x + span, x, sh), yv, 'h', A);
            if (t >= 0.62) {
              this.jump(ctx, x, yt, yv, s4, C.electron, A);
              this.dot(ctx, x, lerp(yt, yv, s4), 'e', A);
            }
          }
          this.phonon(ctx, x + 10, (yt + yv) / 2, seg(t, 0.74, 0.95), A, 1, L ? '`phonon`' : null);
          this.flash(ctx, x, yv, seg(t, 0.78, 0.95), A);
          break;
        }
        case 'srhG': {
          const s1 = ease(seg(t, 0.08, 0.3)), sh = ease(seg(t, 0.3, 0.7));
          const s2 = ease(seg(t, 0.5, 0.72)), s3 = ease(seg(t, 0.72, 1));
          const filled = t >= 0.3 && t < 0.5;
          this.trapBox(ctx, x, yt, filled, Math.max(A, featured ? 1 : 0.5), L);
          this.phonon(ctx, x - 10, (yt + yv) / 2, seg(t, 0, 0.2), A, -1, L ? '`phonon absorbed`' : null);
          if (t < 0.3) {
            this.jump(ctx, x, yv, yt, s1, C.electron, A);
            this.dot(ctx, x, lerp(yv, yt, s1), 'e', A);
          }
          if (t >= 0.3) this.dot(ctx, lerp(x, x + span, sh), yv, 'h', A);
          this.phonon(ctx, x - 10, yt - 12, seg(t, 0.4, 0.58), A, -1, null);
          if (t >= 0.5) {
            this.jump(ctx, x, yt, yc, s2, C.electron, A * (1 - s3));
            this.dot(ctx, lerp(x, x - span, s3), lerp(yt, yc, s2), 'e', A);
          }
          break;
        }
        case 'aug': {
          const s1 = ease(seg(t, 0, 0.25)), s2 = ease(seg(t, 0.25, 0.45));
          const s3 = ease(seg(t, 0.3, 0.5));
          const x2 = x + (featured ? 34 : 22);
          const hot = g.yC - g.pxPerEv * this.model.fr.Eg * 0.85;
          if (t < 0.45) {
            this.jump(ctx, x, yc, yv, s2, C.electron, A);
            this.dot(ctx, lerp(x - span, x, s1), lerp(yc, yv, s2), 'e', A);
            this.dot(ctx, lerp(x + span, x, s1), yv, 'h', A);
          }
          this.flash(ctx, x, yv, seg(t, 0.43, 0.6), A);
          // energy handed to the third carrier
          if (t > 0.28 && t < 0.55) {
            ctx.save();
            ctx.globalAlpha = A * 0.8 * (1 - seg(t, 0.48, 0.55));
            ctx.strokeStyle = PHONON; ctx.setLineDash([2, 4]); ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(x + 4, mid); ctx.quadraticCurveTo(x2 + 18, mid - 20, x2 + 2, lerp(yc, hot, s3) + 8); ctx.stroke();
            ctx.restore();
          }
          // hot carrier rises, then relaxes in steps
          let y2;
          if (t < 0.5) y2 = lerp(yc, hot, s3);
          else {
            const r = seg(t, 0.5, 0.92);
            const stepped = Math.floor(r * 5) / 5 + ease((r * 5) % 1) / 5;
            y2 = lerp(hot, yc, Math.min(1, stepped));
            if (r > 0 && r < 1) this.phonon(ctx, x2 + 10, y2 + 6, (r * 5) % 1, A, 1, L && r < 0.25 ? '`phonons`' : null);
          }
          this.jump(ctx, x2, yc, y2, 1, C.electron, A * 0.6);
          this.dot(ctx, x2, y2, 'e', A);
          if (L && t > 0.4 && t < 0.62) drawMath(ctx, '`hot electron`', x2 + 14, y2 + 4, { size: 12, color: C.electron, pill: true });
          break;
        }
        case 'imp': {
          const s1 = seg(t, 0, 0.35), s2 = ease(seg(t, 0.35, 0.55)), s3 = ease(seg(t, 0.55, 1));
          const hot = g.yC - g.pxPerEv * this.model.fr.Eg * 1.15;
          const e1x = lerp(x - (featured ? 170 : 90), x, s1);
          const e1y = t < 0.35 ? lerp(yc, hot, s1 * s1) : lerp(hot, yc, s2);
          if (featured && t < 0.4) {
            ctx.save();
            ctx.globalAlpha = A;
            ctx.strokeStyle = C.field; ctx.fillStyle = C.field; ctx.lineWidth = 1.6;
            for (let i = 0; i < 3; i++) {
              const ax = x - 150 + i * 46;
              ctx.beginPath(); ctx.moveTo(ax + 20, 40); ctx.lineTo(ax + 4, 40); ctx.stroke();
              ctx.beginPath(); ctx.moveTo(ax, 40); ctx.lineTo(ax + 6, 36); ctx.lineTo(ax + 6, 44); ctx.closePath(); ctx.fill();
            }
            ctx.restore();
            drawMath(ctx, 'ℰ `strong field`', x - 150, 28, { size: 13, color: C.field });
          }
          // trail of the accelerating carrier
          this.jump(ctx, e1x, yc, e1y, 1, C.electron, A * 0.4);
          this.dot(ctx, lerp(e1x, x + span, s3), e1y, 'e', A);
          if (L && t < 0.33) drawMath(ctx, '`hot electron`', e1x + 12, e1y - 8, { size: 12, color: C.electron, pill: true });
          if (t >= 0.35) {
            const x3 = x + 16;
            this.flash(ctx, x3, (yc + yv) / 2, seg(t, 0.35, 0.5), A);
            this.jump(ctx, x3, yv, yc, s2, C.electron, A * (1 - s3));
            this.dot(ctx, lerp(x3, x3 + span * 0.6, s3), lerp(yv, yc, s2), 'e', A);
            this.dot(ctx, lerp(x3, x3 - span, s3), yv, 'h', A);
            if (L && t > 0.6 && t < 0.95) drawMath(ctx, '`new pair`', x3 + 10, (yc + yv) / 2, { size: 12, color: C.text, pill: true });
          }
          break;
        }
      }
      ctx.restore();
      this.big = false;
    }
  }

  return RGView;
})();
