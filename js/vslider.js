/*
 * Applied-voltage slider. Vertical on wide screens, horizontal on narrow ones.
 * The track is piecewise linear: reverse bias [min, 0] uses the lower 40%,
 * forward bias [0, max] the upper 60%, so the exponential forward region
 * gets fine control even when the reverse range is much larger.
 * Dragging snaps to a step of at least ~3 px, holds at 0 V across a small
 * dead zone, and is pulled onto round values and marks (like V_bi) so the
 * value stays put while the pointer wanders a little.
 */
window.SV = window.SV || {};

SV.VSlider = class {
  constructor(root, { min, max, value, onChange }) {
    this.root = root;
    this.min = min; this.max = max; this.value = value;
    this.onChange = onChange;
    this.split = 0.4;
    this.track = root.querySelector('.vs-track');
    this.fill = root.querySelector('.vs-fill');
    this.thumb = root.querySelector('.vs-thumb');
    this.ticks = root.querySelector('.vs-ticks');
    this.thumb.setAttribute('role', 'slider');
    this.thumb.tabIndex = 0;

    const onPointer = (ev) => {
      const r = this.track.getBoundingClientRect();
      const vertical = this.isVertical();
      const len = vertical ? r.height : r.width;
      const t = vertical ? 1 - (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width;
      this.set(this.snap(Math.max(0, Math.min(1, t)), len), true);
    };
    this.track.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      this.track.setPointerCapture(ev.pointerId);
      this.root.classList.add('dragging');
      this.thumb.focus({ preventScroll: true });
      onPointer(ev);
      const move = (e) => onPointer(e);
      const up = () => {
        this.root.classList.remove('dragging');
        this.track.removeEventListener('pointermove', move);
        this.track.removeEventListener('pointerup', up);
        this.track.removeEventListener('pointercancel', up);
      };
      this.track.addEventListener('pointermove', move);
      this.track.addEventListener('pointerup', up);
      this.track.addEventListener('pointercancel', up);
    });
    this.thumb.addEventListener('keydown', (ev) => {
      const big = ev.shiftKey ? 0.1 : 0.01;
      let v = this.value;
      switch (ev.key) {
        case 'ArrowUp': case 'ArrowRight': v += big; break;
        case 'ArrowDown': case 'ArrowLeft': v -= big; break;
        case 'PageUp': v += 0.5; break;
        case 'PageDown': v -= 0.5; break;
        case 'Home': v = this.min; break;
        case 'End': v = this.max; break;
        case '0': v = 0; break;
        default: return;
      }
      ev.preventDefault();
      this.set(Math.round(v * 100) / 100, true);
    });
    this.render();
  }

  isVertical() {
    const r = this.track.getBoundingClientRect();
    return r.height >= r.width;
  }

  toT(v) {
    if (v <= 0) return this.min >= 0 ? 0 : this.split * (1 - v / this.min);
    return this.split + (1 - this.split) * (v / this.max);
  }
  fromT(t) {
    let v;
    if (t <= this.split) v = this.min * (1 - t / this.split);
    else v = this.max * (t - this.split) / (1 - this.split);
    return Math.round(v * 100) / 100;
  }

  /* track position t -> value, with steps, a dead zone at 0 and detents */
  snap(t, len) {
    const zPx = this.toT(0) * len, px = t * len;
    if (Math.abs(px - zPx) < 8) return 0;
    const fwd = px > zPx;
    const vpp = fwd ? this.max / ((1 - this.split) * len) : -this.min / (this.split * len);
    const raw = fwd ? this.max * (t - this.split) / (1 - this.split) : this.min * (1 - t / this.split);
    for (const mk of this.marks || []) {
      if (Math.abs(raw - mk.v) < 4 * vpp) return mk.v;
    }
    const round = fwd ? 0.1 : 0.5;
    const r0 = Math.round(raw / round) * round;
    if (Math.abs(raw - r0) < 3 * vpp) return Math.round(r0 * 100) / 100;
    const step = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5].find((s) => s >= 2.5 * vpp) || 0.5;
    return Math.round(Math.round(raw / step) * step * 100) / 100;
  }

  setRange(min, max, split, marks) {
    this.min = min; this.max = max;
    if (split != null) this.split = split;
    this.marks = marks || [];
    if (this.value > max) this.value = max;
    if (this.value < min) this.value = min;
    this.buildTicks();
    this.render();
  }

  set(v, fromUser) {
    v = Math.max(this.min, Math.min(this.max, v));
    if (Math.abs(v) < 0.005) v = 0;
    const changed = v !== this.value;
    this.value = v;
    this.render();
    if (changed && fromUser && this.onChange) this.onChange(v);
  }

  buildTicks() {
    const marks = new Set([this.min, 0, this.max]);
    if (this.min <= -4) { marks.add(-1); marks.add(-2.5); }
    else if (this.min <= -1.5) { marks.add(-1); }
    if (this.max >= 1.5) marks.add(Math.floor(this.max / 2 * 10) / 10);
    const sorted = [...marks].sort((a, b) => a - b);
    this.ticks.innerHTML = sorted.map((v) => {
      const t = this.toT(v) * 100;
      const label = (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2).replace(/\.?0+$/, '') + (v === 0 ? '' : '');
      return `<span class="vs-tick${v === 0 ? ' zero' : ''}" style="--t:${t}%"><span>${label}</span></span>`;
    }).join('');
  }

  render() {
    const t = this.toT(this.value), z = this.toT(0);
    this.root.style.setProperty('--t', (t * 100) + '%');
    this.root.style.setProperty('--z', (z * 100) + '%');
    this.root.style.setProperty('--lo', (Math.min(t, z) * 100) + '%');
    this.root.style.setProperty('--hi', (Math.max(t, z) * 100) + '%');
    this.root.dataset.bias = this.value > 0 ? 'forward' : this.value < 0 ? 'reverse' : 'zero';
    this.thumb.setAttribute('aria-valuemin', this.min);
    this.thumb.setAttribute('aria-valuemax', this.max);
    this.thumb.setAttribute('aria-valuenow', this.value);
    this.thumb.setAttribute('aria-valuetext', `${this.value.toFixed(2)} volts`);
  }
};
