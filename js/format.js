/*
 * Number formatting and a tiny math-typesetting language shared by the
 * canvas and the HTML panels.
 *
 *   letters          -> italic variables      E, V, x
 *   _x  _{bi}        -> roman subscript       E_c, V_{bi}
 *   ^2  ^{-3}        -> roman superscript
 *   "text"           -> roman (upright) text  "ln", "cm"
 *   `text`           -> interface font, for numbers and units
 */
window.SV = window.SV || {};

SV.fmt = (function () {
  const MINUS = '−';

  function sciParts(x, digits) {
    if (x === 0 || !isFinite(x)) return { m: x === 0 ? '0' : String(x), e: 0 };
    let e = Math.floor(Math.log10(Math.abs(x)));
    let m = x / Math.pow(10, e);
    let ms = m.toFixed(digits);
    if (Math.abs(parseFloat(ms)) >= 10) { e += 1; ms = (x / Math.pow(10, e)).toFixed(digits); }
    return { m: ms.replace('-', MINUS), e };
  }

  /* "1.0 × 10^16" in the math mini-language (inside ui backticks) */
  function sciMath(x, digits = 1, unit = '') {
    const { m, e } = sciParts(x, digits);
    if (e >= -2 && e <= 3) return '`' + plain(x, digits) + (unit ? ' ' + unit : '') + '`';
    const u = unit ? '` ' + unit + '`' : '';
    return '`' + m + ' × 10`^{' + String(e).replace('-', MINUS) + '}' + u;
  }

  function sciHTML(x, digits = 1) {
    const { m, e } = sciParts(x, digits);
    if (e >= -2 && e <= 3) return plain(x, digits);
    return m + '&thinsp;×&thinsp;10<sup>' + String(e).replace('-', MINUS) + '</sup>';
  }

  function plain(x, digits) {
    const a = Math.abs(x);
    let s;
    if (a >= 1000 || a === 0) s = x.toFixed(a === 0 ? digits : 0);
    else {
      s = x.toPrecision(digits + 1);
      if (s.includes('e')) s = x.toFixed(digits);
    }
    return s.replace('-', MINUS);
  }

  function signed(x, d) {
    const s = Math.abs(x).toFixed(d);
    if (parseFloat(s) === 0) return s;
    return (x > 0 ? '+' : MINUS) + s;
  }

  function eV(x, d = 3) { return x.toFixed(d).replace('-', MINUS) + ' eV'; }

  /* length given in cm -> {value, unit} choosing µm or nm */
  function length(cm) {
    const um = cm * 1e4;
    if (um >= 100) return { v: um.toFixed(0), u: 'µm' };
    if (um >= 10) return { v: um.toFixed(1), u: 'µm' };
    if (um >= 0.1) return { v: um.toFixed(3), u: 'µm' };
    const nm = cm * 1e7;
    if (nm >= 10) return { v: nm.toFixed(1), u: 'nm' };
    return { v: nm.toFixed(2), u: 'nm' };
  }
  function lengthStr(cm) { const l = length(cm); return l.v + ' ' + l.u; }

  /* ---------- math mini-language ---------- */
  function parseMath(src) {
    const parts = [];
    let i = 0, ui = false, rm = false;
    const push = (t, st) => {
      const last = parts[parts.length - 1];
      if (last && last.st === st) last.t += t; else parts.push({ t, st });
    };
    while (i < src.length) {
      const c = src[i];
      if (c === '`') { ui = !ui; i++; continue; }
      if (c === '"') { rm = !rm; i++; continue; }
      if (c === '_' || c === '^') {
        let st = c === '_' ? 'sub' : 'sup';
        if (ui) st += 'U';
        i++;
        let t;
        if (src[i] === '{') {
          // matching brace, so nested groups like ^{qV_{BE}/kT} work
          let j = i, depth = 0;
          for (; j < src.length; j++) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}' && --depth === 0) break;
          }
          t = src.slice(i + 1, j); i = j + 1;
        } else { t = src[i]; i++; }
        parts.push({ t: t.replace(/-/g, MINUS), raw: t, st });
        continue;
      }
      if (!ui && !rm && /[A-Za-zα-ωΑ-Ωℰ]/.test(c)) { push(c, 'it'); i++; continue; }
      push(c === '-' && !ui ? MINUS : c, ui ? 'ui' : 'rm');
      i++;
    }
    return parts;
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function mathHTML(src) {
    return parseMath(src).map((p) => {
      const t = esc(p.t);
      switch (p.st) {
        case 'it': return '<i class="mi">' + t + '</i>';
        case 'rm': return '<span class="mr">' + t + '</span>';
        case 'ui': return '<span class="mu">' + t + '</span>';
        case 'sub': return '<sub class="mr">' + t + '</sub>';
        case 'sup': return /[A-Za-z]/.test(p.t) && p.t !== '*' ? '<sup>' + mathHTML(p.raw) + '</sup>' : '<sup class="mr">' + t + '</sup>';
        case 'subU': return '<sub class="mu">' + t + '</sub>';
        case 'supU': return '<sup class="mu">' + t + '</sup>';
      }
      return t;
    }).join('');
  }

  return { sciParts, sciMath, sciHTML, plain, signed, eV, length, lengthStr, parseMath, mathHTML, MINUS };
})();
