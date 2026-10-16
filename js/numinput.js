/*
 * Typed-in values for the sliders.
 *   SV.numInput   one number box (temperature, voltage, E_T ...)
 *   SV.sciInput   mantissa × 10^exponent boxes (doping, lifetime)
 *   SV.niceLog    maps a log slider's integer index to round values
 *                 (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 per decade), so the
 *                 thumb rests on readable numbers instead of every pixel.
 * Values commit while typing; the box is tidied up on Enter or blur.
 */
window.SV = window.SV || {};

SV.niceLog = (function () {
  const M = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
  return {
    fromIdx(i, lo) {
      i = Math.round(i);
      return M[i % 10] * Math.pow(10, lo + Math.floor(i / 10));
    },
    toIdx(x, lo) {
      const L = Math.log10(x) - lo;
      const d = Math.floor(L + 1e-9);
      let best = 0, bd = Infinity;
      for (let j = 0; j <= 10; j++) {
        const lv = d + (j === 10 ? 1 : Math.log10(M[j]));
        const dist = Math.abs(lv - L);
        if (dist < bd) { bd = dist; best = d * 10 + j; }
      }
      return best;
    }
  };
})();

SV.numInput = function (input, { min, max, decimals = 2, onCommit }) {
  const clamp = (v) => Math.max(min(), Math.min(max(), v));
  const fmt = (v) => {
    const s = v.toFixed(decimals);
    return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
  };
  let last = null;
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (!isFinite(v)) return;
    onCommit(clamp(v));
  });
  input.addEventListener('change', () => { if (last != null) input.value = fmt(last); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  return {
    set(v) {
      last = v;
      if (document.activeElement !== input) input.value = fmt(v);
    }
  };
};

SV.sciInput = function (root, { min, max, onCommit }) {
  const mant = root.querySelector('.mant'), exp = root.querySelector('.exp');
  mant.removeAttribute('min'); mant.removeAttribute('max');
  const clamp = (v) => Math.max(min, Math.min(max, v));
  exp.min = Math.floor(Math.log10(min)); exp.max = Math.floor(Math.log10(max));
  let last = null;
  const parts = (v) => {
    let e = Math.floor(Math.log10(v) + 1e-12);
    let m = Math.round(v / Math.pow(10, e) * 100) / 100;
    if (m >= 10) { m /= 10; e += 1; }
    return { m, e };
  };
  const show = (v) => {
    const { m, e } = parts(v);
    mant.value = m % 1 === 0 ? m.toFixed(1) : String(m);
    exp.value = e;
  };
  const read = () => {
    const m = parseFloat(mant.value), e = parseInt(exp.value, 10);
    if (!isFinite(m) || !isFinite(e) || m <= 0) return null;
    return clamp(m * Math.pow(10, e));
  };
  for (const el of [mant, exp]) {
    el.addEventListener('input', () => { const v = read(); if (v != null) onCommit(v); });
    el.addEventListener('change', () => { if (last != null) show(last); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
  }
  // arrow keys on the mantissa roll over into the next decade (9.9 -> 1.0 × 10^(n+1))
  mant.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    ev.preventDefault();
    const cur = last != null ? parts(last) : { m: 1, e: +exp.value || 0 };
    let m = Math.round((cur.m + (ev.key === 'ArrowUp' ? 0.1 : -0.1)) * 10) / 10, e = cur.e;
    if (m >= 10) { m = 1; e += 1; }
    if (m < 1) { m = 9.9; e -= 1; }
    const v = clamp(m * Math.pow(10, e));
    onCommit(v);
    show(v);
  });
  return {
    set(v) {
      last = v;
      if (!root.contains(document.activeElement)) show(v);
    }
  };
};
