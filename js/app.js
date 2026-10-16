/* Wires the controls to the physics engine and the renderer. */
(function () {
  const P = SV.physics, F = SV.fmt, MATS = SV.MATERIALS, C = SV.COLORS;
  const $ = (id) => document.getElementById(id);
  const mh = F.mathHTML;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    material: 'Si',
    mode: 'pn',
    T: 300,
    NA: 1e16,
    ND: 1e16,
    bulkType: 'n',
    bulkN: 1e16,
    VA: 0,        // pn junction applied voltage
    Vbulk: 0,     // voltage across the single-material bar
    ivScale: 'linear',
    rgProc: 'srhR',
    rgU: 0,
    rgET: 0,
    rgTau: null,  // null: use the material's default lifetime
    show: { carriers: !reduceMotion, flows: true, quasi: true, field: true, diffs: true }
  };

  /* ---------- URL hash (shareable state) ---------- */
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const num = (k, lo, hi) => { const v = parseFloat(h.get(k)); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null; };
    if (MATS[h.get('m')]) state.material = h.get('m');
    if (['bulk', 'pn', 'rg'].includes(h.get('mode'))) state.mode = h.get('mode');
    if (SV.RG_PROCESSES[h.get('proc')]) state.rgProc = h.get('proc');
    const u = num('u', -1, 1), et = num('et', -2, 2), tau = num('tau', 1e-10, 1e-3);
    if (u != null) state.rgU = u;
    if (et != null) state.rgET = et;
    if (tau) state.rgTau = tau;
    const NA = num('NA', 1e13, 1e19), ND = num('ND', 1e13, 1e19), N = num('N', 1e13, 1e19);
    const T = num('T', 200, 500), VA = num('VA', -5, 5), V = num('V', -2, 2);
    if (NA) state.NA = NA;
    if (ND) state.ND = ND;
    if (N) state.bulkN = N;
    if (T) state.T = T;
    if (VA != null) state.VA = VA;
    if (V != null) state.Vbulk = V;
    if (['n', 'p', 'i'].includes(h.get('type'))) state.bulkType = h.get('type');
  }
  let hashTimer = 0;
  function writeHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      const s = new URLSearchParams();
      s.set('m', state.material);
      s.set('mode', state.mode);
      if (state.mode === 'pn') {
        s.set('NA', state.NA.toExponential(2)); s.set('ND', state.ND.toExponential(2)); s.set('VA', state.VA.toFixed(2));
      } else if (state.mode === 'bulk') {
        s.set('type', state.bulkType); s.set('N', state.bulkN.toExponential(2)); s.set('V', state.Vbulk.toFixed(2));
      } else {
        s.set('type', state.bulkType); s.set('N', state.bulkN.toExponential(2));
        s.set('proc', state.rgProc); s.set('u', state.rgU.toFixed(2)); s.set('et', state.rgET.toFixed(3));
        if (state.rgTau) s.set('tau', state.rgTau.toExponential(2));
      }
      s.set('T', String(state.T));
      history.replaceState(null, '', '#' + s.toString());
    }, 200);
  }

  /* ---------- material picker with table-value cards ---------- */
  function buildMaterials() {
    $('materials').innerHTML = SV.MATERIAL_ORDER.map((k) => {
      const m = MATS[k];
      return `<button type="button" class="mat" role="radio" data-mat="${k}" aria-describedby="mat-card">
        <span class="sym">${m.label}</span><span class="eg">${m.Eg300.toFixed(2)} eV</span></button>`;
    }).join('');
    $('materials').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mat]');
      if (!b) return;
      state.material = b.dataset.mat;
      state.rgTau = null;
      update();
    });
    radioKeys($('materials'), '[data-mat]');

    const card = $('mat-card');
    let hideTimer = 0;
    const show = (b) => {
      clearTimeout(hideTimer);
      card.innerHTML = materialCard(b.dataset.mat);
      card.hidden = false;
      const r = b.getBoundingClientRect();
      const w = card.offsetWidth;
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
      card.style.left = left + 'px';
      card.style.top = (r.bottom + 8) + 'px';
    };
    const hide = () => { hideTimer = setTimeout(() => { card.hidden = true; }, 80); };
    $('materials').addEventListener('pointerover', (e) => {
      const b = e.target.closest('[data-mat]');
      if (b && e.pointerType !== 'touch') show(b);
    });
    $('materials').addEventListener('pointerleave', hide);
    $('materials').addEventListener('focusin', (e) => { const b = e.target.closest('[data-mat]'); if (b) show(b); });
    $('materials').addEventListener('focusout', hide);
    window.addEventListener('scroll', () => { card.hidden = true; }, { passive: true });
  }

  function materialCard(key) {
    const m = MATS[key];
    const lightly = (s) => s.min + s.mu0;
    const off = P.eiOffset(m, 300);
    const rows = [
      ['E_g', m.Eg300.toFixed(m.Eg300 < 1 ? 2 : 3) + ' eV'],
      ['n_i', F.sciHTML(m.ni300, 2) + ' cm<sup>−3</sup>'],
      ['K_S', m.Ks.toFixed(1)],
      ['m_n^* / m_0', m.mn.toFixed(3)],
      ['m_p^* / m_0', m.mp.toFixed(2)],
      ['N_c', F.sciHTML(m.Nc300, 2) + ' cm<sup>−3</sup>'],
      ['N_v', F.sciHTML(m.Nv300, 2) + ' cm<sup>−3</sup>'],
      ['E_i − "midgap"', F.signed(off * 1000, 1) + ' meV'],
      ['μ_n `(undoped)`', Math.round(lightly(m.mob.n)) + ' cm²/V·s'],
      ['μ_p `(undoped)`', Math.round(lightly(m.mob.p)) + ' cm²/V·s'],
      ['τ `(assumed)`', F.sciHTML(m.tau, 0) + ' s']
    ];
    const src = (m.approx ? 'Typical literature values (not in Pierret\'s tables).' : 'Pierret\'s table values.') + ' N<sub>c</sub>, N<sub>v</sub> computed from the effective masses; mobilities from empirical fits.';
    return `<div class="mc-head"><span class="mc-sym">${m.label}</span><span class="mc-name">${m.name}</span><span class="mc-t">300 K</span></div>
      <dl class="mc-rows">${rows.map(([k, v]) => `<dt>${mh(k)}</dt><dd>${v}</dd>`).join('')}</dl>
      <p class="mc-src">${src}</p>`;
  }

  /* arrow-key navigation inside a radiogroup */
  function radioKeys(group, sel) {
    group.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const items = [...group.querySelectorAll(sel)];
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const next = items[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
      next.focus();
      next.click();
    });
  }

  function setRadio(group, attr, value) {
    group.querySelectorAll(`[data-${attr}]`).forEach((b) => {
      const on = b.dataset[attr] === value;
      b.setAttribute('aria-checked', on);
      b.tabIndex = on ? 0 : -1;
    });
  }

  const NL = SV.niceLog;
  const toIdx = (N) => NL.toIdx(N, 13);
  const fromIdx = (v) => NL.fromIdx(parseFloat(v), 13);
  function setRangeFill(input) {
    const p = (input.value - input.min) / (input.max - input.min) * 100;
    input.style.setProperty('--p', p + '%');
  }

  /* ---------- typed values ---------- */
  const setBias = (v) => {
    if (state.mode === 'pn') state.VA = v; else state.Vbulk = v;
    update();
  };
  const typed = {
    na: SV.sciInput($('na-in'), { min: 1e13, max: 1e19, onCommit: (v) => { state.NA = v; update(); } }),
    nd: SV.sciInput($('nd-in'), { min: 1e13, max: 1e19, onCommit: (v) => { state.ND = v; update(); } }),
    'bulk-n': SV.sciInput($('bulk-n-in'), { min: 1e13, max: 1e19, onCommit: (v) => { state.bulkN = v; update(); } }),
    tau: SV.sciInput($('rg-tau-in'), { min: 1e-10, max: 1e-3, onCommit: (v) => { state.rgTau = v; update(); } }),
    T: SV.numInput($('t-in'), { min: () => 200, max: () => 500, decimals: 0, onCommit: (v) => { state.T = Math.round(v); update(); } }),
    va: SV.numInput($('va-in'), { min: () => vslider.min, max: () => vslider.max, decimals: 2, onCommit: (v) => setBias(Math.round(v * 1000) / 1000) }),
    u: SV.numInput($('rg-u-in'), { min: () => -1, max: () => 1, decimals: 2, onCommit: (v) => { state.rgU = v; update(); } }),
    et: SV.numInput($('rg-et-in'), { min: () => -Infinity, max: () => Infinity, decimals: 2, onCommit: (v) => { state.rgET = v; update(); } })
  };

  /* ---------- slider ---------- */
  const vslider = new SV.VSlider($('vslider'), {
    min: -5, max: 1.4, value: 0,
    onChange: setBias
  });

  /* ---------- diagram ---------- */
  const diagram = new SV.Diagram($('diagram'));
  const rgView = new SV.RGView($('diagram'));
  rgView.onStep = (i) => {
    $('rg-steps').querySelectorAll('.rg-step').forEach((el, j) => el.classList.toggle('on', j === i));
  };

  /* ---------- update ---------- */
  let model = null;
  function update() {
    const pn = state.mode === 'pn';
    const rgMode = state.mode === 'rg';
    document.body.dataset.mode = state.mode;
    $('bias-ui').hidden = rgMode;
    $('rg-ui').hidden = !rgMode;
    $('rg-controls').hidden = !rgMode;
    $('rg-steps').hidden = !rgMode;
    for (const id of ['toggle-flows', 'toggle-quasi', 'toggle-field', 'toggle-diffs']) $(id).hidden = rgMode;
    if (rgMode) { updateRG(); return; }

    if (pn) {
      const r = P.vaRangePN(state);
      state.VA = Math.max(r.min, Math.min(r.max, state.VA));
      vslider.setRange(r.min, r.max, 0.4, [{ v: Math.round(r.Vbi * 100) / 100, html: mh('V_{bi}'), cls: 'vbi' }]);
      vslider.set(state.VA);
      model = P.junction(state);
    } else {
      const r = P.VA_RANGE_BULK;
      vslider.setRange(r.min, r.max, 0.5, []);
      vslider.set(state.Vbulk);
      model = P.bulk({ ...state, VA: state.Vbulk });
    }

    diagram.setModel(model, { ...state.show });

    // controls
    setRadio($('materials'), 'mat', state.material);
    setRadio($('mode'), 'mode', state.mode);
    setRadio($('bulk-type'), 'type', state.bulkType);
    $('doping-bulk').hidden = pn;
    $('doping-pn').hidden = !pn;
    $('bulk-n-field').hidden = state.bulkType === 'i';
    $('bulk-n-name').innerHTML = state.bulkType === 'p'
      ? '<i class="mi">N</i><sub>A</sub>' : '<i class="mi">N</i><sub>D</sub>';
    const bn = $('bulk-n');
    bn.style.setProperty('--fill', state.bulkType === 'p' ? 'var(--hole)' : 'var(--electron)');
    for (const [id, N] of [['na', state.NA], ['nd', state.ND], ['bulk-n', state.bulkN]]) {
      const el = $(id);
      if (document.activeElement !== el) el.value = toIdx(N);
      setRangeFill(el);
      typed[id].set(N);
    }
    $('temp').value = state.T;
    setRangeFill($('temp'));
    typed.T.set(state.T);
    document.querySelectorAll('[data-show]').forEach((c) => { c.checked = state.show[c.dataset.show]; });
    for (const id of ['toggle-quasi', 'toggle-flows']) {
      $(id).classList.toggle('disabled', !pn);
      $(id).querySelector('input').disabled = !pn;
    }
    $('iv').hidden = !pn;

    renderLegend();
    renderProps();
    renderReadouts();
    renderNotice();
    renderEquations();
    renderBias();
    renderCurrents();
    if (pn) drawIV();
    $('diagram').setAttribute('aria-label', describe());
    writeHash();
  }

  /* ---------- panels ---------- */
  function renderLegend() {
    const pn = model.mode === 'pn';
    const biased = pn && Math.abs(model.VA) > 1e-9;
    const items = [
      `<span class="item"><span class="sw band"></span><span>${mh('E_c, E_v')}</span></span>`,
      `<span class="item"><span class="sw ei"></span><span>${mh('E_i')}</span></span>`
    ];
    // keep the same legend entries at every bias (dimming the unused ones) so
    // the legend never rewraps and resizes the diagram as V_A crosses 0
    const quasi = biased && state.show.quasi;
    items.push(`<span class="item${quasi ? ' off' : ''}"><span class="sw ef"></span><span>${mh('E_F')}</span></span>`);
    if (pn && state.show.quasi) {
      items.push(`<span class="item${quasi ? '' : ' off'}"><span class="sw fn"></span><span>${mh('F_N')}</span></span>`);
      items.push(`<span class="item${quasi ? '' : ' off'}"><span class="sw fp"></span><span>${mh('F_P')}</span></span>`);
    }
    items.push('<span class="item"><span class="dot"></span>electron</span>');
    items.push('<span class="item"><span class="ring"></span>hole</span>');
    if (pn) {
      items.push('<span class="item"><span class="sw diff"></span><span class="t-diff">diffusion</span></span>');
      items.push('<span class="item"><span class="sw drift"></span><span class="t-drift">drift</span></span>');
      if (state.show.carriers) items.push('<span class="item"><span class="trap-sq"></span><span class="t-rg">R–G event</span></span>');
    } else {
      items.push(`<span class="item${model.V !== 0 ? '' : ' off'}"><span class="sw drift"></span><span class="t-drift">drift</span></span>`);
    }
    if (state.show.field) items.push(`<span class="item"><span style="color:var(--field)">${mh('ℰ')}</span><span>field</span></span>`);
    const note = pn ? 'Hover the diagram for values, or a carrier for its story. Energies are measured from the p contact.' : 'Hover the diagram for values, or a carrier for its story.';
    $('legend').innerHTML = items.join('') + `<span class="note">${note}</span>`;
  }

  function renderProps() {
    const m = model.mat, T = state.T;
    $('props-title').textContent = m.name + ' at ' + T + ' K';
    const rows = [
      ['E_g', F.eV(model.fr.Eg, 3)],
      ['n_i', F.sciHTML(model.ni, 2) + ' cm<sup>−3</sup>'],
      ['K_S', m.Ks.toFixed(1)],
      ['m_n^* / m_0', m.mn.toFixed(3)],
      ['m_p^* / m_0', m.mp.toFixed(2)],
      ['E_i − "midgap"', F.signed(model.fr.off * 1000, 1) + ' meV']
    ];
    if (model.mode === 'pn') {
      rows.push(['μ_n `(p side)`', model.muN.toFixed(0) + ' cm²/V·s']);
      rows.push(['μ_p `(n side)`', model.muP.toFixed(0) + ' cm²/V·s']);
      rows.push(['τ `(assumed)`', F.sciHTML(m.tau, 0) + ' s']);
    } else {
      rows.push(['μ_n', model.muN.toFixed(0) + ' cm²/V·s']);
      rows.push(['μ_p', model.muP.toFixed(0) + ' cm²/V·s']);
    }
    $('props').innerHTML = rows.map(([k, v]) => `<dt>${mh(k)}</dt><dd>${v}</dd>`).join('');
    $('props-note').textContent = m.approx
      ? `${m.label} is not tabulated in Pierret; these are typical literature values.`
      : `Values from Pierret's tables; mobilities from empirical fits.`;
  }

  function metric(label, value, unit, accent, labelUnit) {
    return `<div class="metric${accent ? ' accent' : ''}"><div class="metric-label">${mh(label)}${labelUnit ? `<span class="u">${labelUnit}</span>` : ''}</div>
      <div class="metric-value">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div></div>`;
  }

  const lowInjection = () => model.regime === 'reverse' || model.regime === 'forward' || model.regime === 'equilibrium';

  function renderReadouts() {
    const m = model;
    let html;
    if (m.mode === 'pn') {
      const W = F.length(m.W), xp = F.length(m.xp), xn = F.length(m.xn);
      const biased = Math.abs(m.VA) > 1e-9;
      html = [
        metric('qV_{bi}', m.Vbi.toFixed(3), 'eV', !biased),
        metric(lowInjection() ? 'q(V_{bi} − V_A)' : 'q(V_{bi} − V_j)', m.psi.toFixed(3), 'eV', biased),
        metric('W', W.v, W.u),
        metric('x_p', xp.v, xp.u),
        metric('x_n', xn.v, xn.u),
        metric('|ℰ|_{max}', F.sciHTML(m.Emax, 2), '', false, 'V/cm')
      ].join('');
    } else {
      html = [
        metric('n_0', F.sciHTML(m.n0, 2), '', false, 'cm<sup>−3</sup>'),
        metric('p_0', F.sciHTML(m.p0, 2), '', false, 'cm<sup>−3</sup>'),
        metric('E_F − E_i', F.signed(m.FminusI, 3), 'eV', true),
        metric('E_c − E_F', m.cMinusF.toFixed(3), 'eV'),
        metric('E_F − E_v', m.fMinusV.toFixed(3), 'eV'),
        metric('σ', F.sciHTML(m.sigma, 2), '', false, 'S/cm')
      ].join('');
    }
    $('readouts').innerHTML = html;
  }

  function renderNotice() {
    const m = model, msgs = [];
    if (m.mode === 'pn') {
      if (m.degenerateP || m.degenerateN) {
        msgs.push(`${mh(m.degenerateP ? 'N_A' : 'N_D')} is high enough that ${mh('E_F')} sits within 3${mh('kT')} of a band edge. The nondegenerate formulas used here start to lose accuracy.`);
      }
      if (!lowInjection()) {
        msgs.push(`Past low-level injection the page extends Pierret's ideal diode with the law of the junction (with quasi-neutrality) and a series resistance from the neutral regions. Treat these numbers as estimates; real diodes also have contact resistance and conductivity modulation.`);
      }
    } else if (m.degenerate) {
      msgs.push(`${mh('E_F')} is within 3${mh('kT')} of a band edge, so this doping is degenerate and the Boltzmann (nondegenerate) results shown are approximate.`);
    }
    $('notice').hidden = !msgs.length;
    $('notice').innerHTML = msgs.join(' ');
  }

  const frac = (a, b) => `<span class="frac"><span>${a}</span><span>${b}</span></span>`;
  const big = (c) => `<span class="big">${c}</span>`;

  function renderEquations() {
    const m = model;
    let rows;
    const kT = m.kT.toFixed(4);
    if (m.mode === 'pn') {
      const W = F.lengthStr(m.W);
      const ed = m.edge;
      rows = [
        {
          eq: mh('qV_{bi} = kT "ln"') + big('(') + frac(mh('N_A N_D'), mh('n_i^2')) + big(')'),
          val: `= ${kT} eV × ln(${F.sciHTML(m.NA)} × ${F.sciHTML(m.ND)} / (${F.sciHTML(m.ni, 2)})<sup>2</sup>) = <b>${F.eV(m.Vbi)}</b>`,
          ref: 'Ch. 5'
        },
        {
          eq: mh('qV_{bi} = E_{cp} − E_{cn} = (E_{ip} − E_{Fp}) + (E_{Fn} − E_{in})'),
          val: m.regime === 'equilibrium'
            ? `= ${F.eV(m.iMinusFp)} + ${F.eV(m.fMinusIn)}. The Fermi level is flat in equilibrium, so the bands must bend by this much.`
            : `In equilibrium: ${F.eV(m.Vbi)}. Under bias the Fermi level splits, so the bands bend by ${mh('q(V_{bi} − V_j)')} instead.`,
          ref: 'Ch. 5'
        },
        {
          eq: mh('W = ') + big('[') + frac(mh('2K_S ε_0'), mh('q')) + frac(mh('N_A + N_D'), mh('N_A N_D')) + mh('(V_{bi} − V_A)') + big(']') + mh('^{1/2}'),
          val: `with ${mh(lowInjection() ? 'V_{bi} − V_A' : 'V_{bi} − V_j')} = ${m.psi.toFixed(3)} V gives <b>${W}</b>`,
          ref: 'Ch. 5'
        },
        {
          eq: mh('x_n = ') + frac(mh('N_A'), mh('N_A + N_D')) + mh('W,  x_p = ') + frac(mh('N_D'), mh('N_A + N_D')) + mh('W'),
          val: `<b>${F.lengthStr(m.xn)}</b> and <b>${F.lengthStr(m.xp)}</b>; ${mh('N_A x_p = N_D x_n')} keeps the junction neutral.`,
          ref: 'Ch. 5'
        },
        {
          eq: mh('|ℰ(0)| = ') + frac(mh('qN_D x_n'), mh('K_S ε_0')) + mh(' = ') + frac(mh('qN_A x_p'), mh('K_S ε_0')),
          val: `= <b>${F.sciHTML(m.Emax, 2)} V/cm</b>, pointing from the n side to the p side.`,
          ref: 'Ch. 5'
        },
        {
          eq: mh('J = J_0') + big('(') + mh('e^{qV_A/kT} − 1') + big(')') + mh(',  J_0 = qn_i^2') + big('(') + frac(mh('D_N'), mh('L_N N_A')) + mh(' + ') + frac(mh('D_P'), mh('L_P N_D')) + big(')'),
          val: `${mh('J_0')} = ${F.sciHTML(m.J0, 2)} A/cm² (${mh('L_N')} = ${F.lengthStr(m.LN)}, ${mh('L_P')} = ${F.lengthStr(m.LP)}). Ideal: ${mh('J')} = ${m.Jideal === 0 ? '0' : F.sciHTML(m.Jideal, 2)} A/cm²${lowInjection() ? '' : `; with the effects below: <b>${F.sciHTML(m.J, 2)} A/cm²</b>`}`,
          ref: 'Ch. 6'
        },
        {
          eq: mh('n(−x_p) p(−x_p) = n_i^2 e^{qV_j/kT}'),
          val: `Law of the junction. Injected electrons at ${mh('−x_p')}: ${F.sciHTML(ed.npe, 2)} cm<sup>−3</sup> = ${fmtPct(m.injP)} of ${mh('N_A')}; holes at ${mh('x_n')}: ${fmtPct(m.injN)} of ${mh('N_D')}. Low-level injection needs both ≪ 100%.`,
          ref: 'Ch. 6'
        },
        {
          eq: mh('V_A = V_j + J r_s,  r_s = ρ_p ℓ_p + ρ_n ℓ_n'),
          val: `${mh('r_s')} = ${F.sciHTML(m.rs, 2)} Ω·cm² for neutral regions ${mh('ℓ = 3L')} long. Now ${mh('V_j')} = <b>${m.Vj.toFixed(3)} V</b> across the junction and <b>${m.seriesDrop.toFixed(3)} V</b> across the neutral regions.`,
          ref: 'Ch. 6'
        }
      ];
    } else {
      const Nd = m.ND, Na = m.NA;
      rows = [
        {
          eq: mh('n_0 = ') + frac(mh('N_D − N_A'), mh('2')) + mh(' + ') + big('[') + big('(') + frac(mh('N_D − N_A'), mh('2')) + big(')') + mh('^2 + n_i^2') + big(']') + mh('^{1/2}'),
          val: `with ${mh('N_D')} = ${F.sciHTML(Nd)}, ${mh('N_A')} = ${F.sciHTML(Na)} cm<sup>−3</sup>: ${mh('n_0')} = <b>${F.sciHTML(m.n0, 2)}</b>, ${mh('p_0 = n_i^2/n_0')} = <b>${F.sciHTML(m.p0, 2)}</b> cm<sup>−3</sup>`,
          ref: 'Ch. 2'
        },
        {
          eq: mh('E_F − E_i = kT "ln"') + big('(') + frac(mh('n_0'), mh('n_i')) + big(')'),
          val: `= ${kT} eV × ln(${F.sciHTML(m.n0, 2)} / ${F.sciHTML(m.ni, 2)}) = <b>${F.signed(m.FminusI, 3)} eV</b>`,
          ref: 'Ch. 2'
        },
        {
          eq: mh('E_i − ') + frac(mh('E_c + E_v'), mh('2')) + mh(' = ') + frac(mh('3'), mh('4')) + mh('kT "ln"') + big('(') + frac(mh('m_p^*'), mh('m_n^*')) + big(')'),
          val: `= <b>${F.signed(m.fr.off * 1000, 1)} meV</b>, which is why ${mh('E_i')} is not exactly at midgap.`,
          ref: 'Ch. 2'
        },
        {
          eq: mh('E_c − E_F = (E_c − E_i) − (E_F − E_i)'),
          val: `= ${m.fr.cMinusI.toFixed(3)} − ${F.signed(m.FminusI, 3).replace('+', '')} = <b>${F.eV(m.cMinusF)}</b>; ${mh('E_F − E_v')} = <b>${F.eV(m.fMinusV)}</b>`,
          ref: 'Ch. 2'
        },
        {
          eq: mh('J_{drift} = q(μ_n n_0 + μ_p p_0)ℰ,  ℰ = −V/L'),
          val: `${mh('L')} = 10 µm, ${mh('ℰ')} = ${F.sciHTML(m.field, 2)} V/cm, ${mh('J')} = <b>${F.sciHTML(m.J, 2)} A/cm²</b>. No diffusion current: the doping is uniform.`,
          ref: 'Ch. 3'
        }
      ];
    }
    $('equations').innerHTML = `<h2>How the numbers are computed</h2>
      <p class="eq-intro">Each line shows the textbook relation and the values it gives for the current settings.</p>` +
      rows.map((r) => `<div class="eq-row"><div class="eq">${r.eq}</div><div class="eq-val">${r.val}</div><div class="eq-ref">Pierret ${r.ref}</div></div>`).join('');
  }

  function fmtPct(r) {
    const pct = r * 100;
    if (pct >= 10) return pct.toFixed(0) + '%';
    if (pct >= 0.1) return pct.toFixed(1) + '%';
    return F.sciHTML(pct, 0) + '%';
  }

  function renderBias() {
    const pn = model.mode === 'pn';
    const v = pn ? state.VA : state.Vbulk;
    $('va-sym').innerHTML = mh(pn ? 'V_A' : 'V');
    typed.va.set(v);
    let text;
    if (pn) {
      const m = model;
      const vbi = `${mh('V_{bi}')} = ${m.Vbi.toFixed(2)} V`;
      switch (m.regime) {
        case 'equilibrium':
          text = `<strong>Equilibrium.</strong> Drift and diffusion cancel for each carrier, so ${mh('E_F')} is flat and no net current flows.`; break;
        case 'reverse':
          text = `<strong>Reverse bias.</strong> The barrier rises by ${mh('q|V_A|')} and the depletion region widens. Diffusion is cut off; only the small drift current remains.`; break;
        case 'forward':
          text = `<strong>Forward bias.</strong> The barrier drops by ${mh('qV_A')}, so diffusion over it grows as ${mh('e^{qV_A/kT}')} while drift stays the same.`; break;
        case 'high':
          text = `<strong>High-level injection.</strong> The barrier is almost gone (${F.eV(m.psi, 2)}). Injected carriers now rival the doping, so current grows more slowly, about as ${mh('e^{qV_A/2kT}')}.`; break;
        case 'series':
          text = `<strong>${v > m.Vbi ? 'Past' : 'Near'} ${vbi}.</strong> The junction can't take much more voltage: only ${mh('V_j')} = ${m.Vj.toFixed(2)} V sits across it and the barrier is nearly flat. The other ${m.seriesDrop.toFixed(2)} V drops across the neutral regions, so the bands tilt there and the diode behaves like a resistor.`; break;
      }
    } else {
      if (v !== 0) text = `<strong>Bands tilt by ${mh('qV')}.</strong> Electrons drift downhill toward the positive contact; holes drift the other way.`;
      else text = `<strong>No applied voltage.</strong> Flat bands, carriers only move randomly, and no net current flows.`;
    }
    $('bias-state').innerHTML = text;
  }

  function dirSVG(dir, color) {
    if (!dir) return `<svg class="cur-dir" viewBox="0 0 34 12" aria-hidden="true"><line x1="6" y1="6" x2="28" y2="6" stroke="${color}" stroke-width="1.6" stroke-dasharray="2 3" opacity="0.5"/></svg>`;
    const [x1, x2] = dir > 0 ? [3, 30] : [31, 4];
    const h = dir > 0 ? 'M30 6 L24 2 L24 10 Z' : 'M4 6 L10 2 L10 10 Z';
    return `<svg class="cur-dir" viewBox="0 0 34 12" aria-hidden="true"><line x1="${x1}" y1="6" x2="${x2 - 4 * dir}" y2="6" stroke="${color}" stroke-width="1.8"/><path d="${h}" fill="${color}"/></svg>`;
  }

  function curRow(c, max) {
    const color = c.sp === 'e' ? 'var(--electron)' : 'var(--hole)';
    const w = !c.J ? 0 : Math.max(2, 100 * (1 + Math.log10(Math.abs(c.J) / max) / 8));
    const barColor = c.kind === 'diff' ? 'var(--diff)' : 'var(--field)';
    return `<div class="cur-row">
      <span class="${c.sp === 'e' ? 'dot' : 'ring'}"></span>
      <span class="cur-name">${c.name}</span>${dirSVG(c.J ? c.dir : 0, color)}
      <span class="cur-flow">${c.flow}</span>
      <span class="cur-bar"><i style="width:${w}%;background:${barColor}"></i></span>
      <span class="cur-val">${!c.J ? '0' : F.sciHTML(Math.abs(c.J), 2)} A/cm²</span>
    </div>`;
  }

  function renderCurrents() {
    const m = model;
    if (m.mode === 'pn') {
      const c = m.comps;
      const max = Math.max(c.nDiff, c.nDrift, c.pDiff, c.pDrift);
      const diff = [
        { sp: 'e', kind: 'diff', name: 'Electrons', J: c.nDiff, dir: 1, flow: 'move n → p, over the barrier' },
        { sp: 'h', kind: 'diff', name: 'Holes', J: c.pDiff, dir: 1, flow: 'move p → n, over the barrier' }
      ];
      const drift = [
        { sp: 'e', kind: 'drift', name: 'Electrons', J: c.nDrift, dir: -1, flow: 'minority electrons swept p → n' },
        { sp: 'h', kind: 'drift', name: 'Holes', J: c.pDrift, dir: -1, flow: 'minority holes swept n → p' }
      ];
      const dirtext = m.J > 0 ? 'p → n (forward)' : m.J < 0 ? 'n → p (reverse saturation)' : 'none';
      $('currents').innerHTML = `<h2>Current across the junction</h2>
        <div class="mech mech-diff"><div class="mech-head"><span class="sw diff"></span>Diffusion<span class="mech-why">down the concentration gradient</span></div>${diff.map((r) => curRow(r, max)).join('')}</div>
        <div class="mech mech-drift"><div class="mech-head"><span class="sw drift"></span>Drift<span class="mech-why">pushed by ${mh('ℰ')}</span></div>${drift.map((r) => curRow(r, max)).join('')}</div>
        <div class="cur-net">
          <div class="eqline">${mh('J = J_{diff} − J_{drift}')}</div>
          <div class="value">${m.J === 0 ? '0' : F.sciHTML(m.J, 2)}<span class="unit">A/cm²</span></div>
          <div class="dirtext">Net current: ${dirtext}</div>
        </div>
        <p class="cur-note">Arrows show current direction; electrons move opposite to their current. Bars use a log scale over 8 decades.</p>`;
    } else {
      const dir = Math.sign(m.field);
      const max = Math.max(1e-300, Math.abs(m.Jn), Math.abs(m.Jp));
      const flowE = m.V === 0 ? 'random motion only' : 'move toward the + contact';
      const flowH = m.V === 0 ? 'random motion only' : 'move toward the − contact';
      const drift = [
        { sp: 'e', kind: 'drift', name: 'Electrons', J: m.Jn, dir, flow: flowE },
        { sp: 'h', kind: 'drift', name: 'Holes', J: m.Jp, dir, flow: flowH }
      ];
      $('currents').innerHTML = `<h2>Current in the bar</h2>
        <div class="mech mech-drift"><div class="mech-head"><span class="sw drift"></span>Drift<span class="mech-why">pushed by ${mh('ℰ')}</span></div>${drift.map((r) => curRow(r, max)).join('')}</div>
        <div class="mech mech-diff"><div class="mech-head"><span class="sw diff"></span>Diffusion<span class="mech-why">none: doping is uniform</span></div></div>
        <div class="cur-net">
          <div class="eqline">${mh('J = σℰ')}</div>
          <div class="value">${m.J === 0 ? '0' : F.sciHTML(Math.abs(m.J), 2)}<span class="unit">A/cm²</span></div>
          <div class="dirtext">${m.J === 0 ? 'No net current' : 'Current flows ' + (dir < 0 ? 'right to left' : 'left to right')}</div>
        </div>`;
    }
  }

  /* ---------- J-V curve ---------- */
  let ivCache = { key: '', pts: null };
  function drawIV() {
    const r = P.vaRangePN(state);
    const key = [state.material, state.NA, state.ND, state.T].join('|');
    const vmin = -0.4, vmax = r.max;
    if (ivCache.key !== key) ivCache = { key, pts: P.ivCurve(state, vmin, vmax, 220) };
    const pts = ivCache.pts;
    const cv = $('iv-canvas');
    const rect = cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(160, rect.width), H = Math.max(110, rect.height);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const L = 8, R = 8, T = 10, B = 20;
    const log = state.ivScale === 'log';
    const x0 = log ? 0 : vmin;
    const X = (v) => L + (v - x0) / (vmax - x0) * (W - L - R);
    const Jmax = pts[pts.length - 1].J;
    let Y, yMin, yMax;
    if (log) {
      const pos = pts.filter((p) => p.V > 0.02 && p.J > 0);
      yMax = Math.log10(Jmax) + 0.5;
      yMin = Math.max(Math.floor(Math.log10(pos[0].J)), yMax - 18);
      Y = (j) => T + (yMax - Math.log10(Math.max(j, 1e-300))) / (yMax - yMin) * (H - T - B);
    } else {
      yMax = Jmax * 1.08; yMin = -Jmax * 0.06;
      Y = (j) => T + (yMax - j) / (yMax - yMin) * (H - T - B);
    }
    g.save();
    g.beginPath(); g.rect(L, T - 2, W - L - R, H - T - B + 2); g.clip();
    // axes
    g.strokeStyle = 'rgba(160, 176, 230, 0.28)'; g.lineWidth = 1;
    if (!log) { g.beginPath(); g.moveTo(L, Y(0)); g.lineTo(W - R, Y(0)); g.stroke(); }
    g.beginPath(); g.moveTo(X(0), T); g.lineTo(X(0), H - B); g.stroke();
    // Vbi marker
    g.setLineDash([3, 4]); g.strokeStyle = 'rgba(255, 200, 87, 0.55)';
    g.beginPath(); g.moveTo(X(r.Vbi), T); g.lineTo(X(r.Vbi), H - B); g.stroke();
    g.setLineDash([]);
    // ideal diode (dashed)
    g.strokeStyle = 'rgba(232, 236, 248, 0.35)'; g.setLineDash([4, 4]); g.lineWidth = 1.2;
    g.beginPath();
    let started = false;
    for (const p of pts) {
      if (log && p.V <= 0.02) continue;
      const y = Y(p.Jideal);
      if (!started) { g.moveTo(X(p.V), y); started = true; } else g.lineTo(X(p.V), y);
      if (y < T - 40) break;
    }
    g.stroke(); g.setLineDash([]);
    // model curve
    g.strokeStyle = C.band; g.lineWidth = 2; g.shadowColor = C.bandGlow; g.shadowBlur = 8;
    g.beginPath(); started = false;
    for (const p of pts) {
      if (log && p.V <= 0.02) continue;
      const y = Y(p.J);
      if (!started) { g.moveTo(X(p.V), y); started = true; } else g.lineTo(X(p.V), y);
    }
    g.stroke();
    g.restore();
    // operating point
    const va = state.VA, J = model.J;
    if (!(log && va <= 0.02)) {
      const px = X(Math.max(x0, Math.min(vmax, va)));
      const py = Math.max(T, Math.min(H - B, Y(J)));
      g.beginPath(); g.arc(px, py, 4.5, 0, Math.PI * 2);
      g.fillStyle = C.ef; g.shadowColor = C.efGlow; g.shadowBlur = 10; g.fill(); g.shadowBlur = 0;
    }
    // labels
    g.font = `500 10.5px "Schibsted Grotesk", system-ui, sans-serif`;
    g.fillStyle = '#5b6480'; g.textBaseline = 'top';
    g.textAlign = 'center'; g.fillText('0', X(0), H - B + 5);
    g.fillStyle = 'rgba(255, 200, 87, 0.8)'; g.fillText('Vbi', X(r.Vbi), H - B + 5);
    g.fillStyle = '#5b6480'; g.textAlign = 'right'; g.fillText(vmax.toFixed(1) + ' V', W - R, H - B + 5);
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText(log ? `|J| up to ${F.sciParts(Jmax, 0).m}e${F.sciParts(Jmax, 0).e} A/cm²` : `J up to ${Jmax < 1000 ? Jmax.toFixed(Jmax < 10 ? 1 : 0) : Jmax.toExponential(0)} A/cm²`, L + 2, T - 6);
    $('iv-caption').innerHTML = state.VA > r.Vbi * 0.6
      ? 'Solid: this model. Dashed: ideal diode. Above the knee the series resistance straightens the curve.'
      : 'Solid: this model. Dashed: ideal diode. The dot is where you are.';
  }

  function describe() {
    const m = model;
    if (m.mode === 'pn') {
      return `Band diagram of a ${m.mat.name} pn junction with N_A ${m.NA.toExponential(1)} and N_D ${m.ND.toExponential(1)} per cubic centimeter, applied voltage ${m.VA.toFixed(2)} V. Built-in voltage ${m.Vbi.toFixed(3)} V, barrier ${m.psi.toFixed(3)} V, depletion width ${F.lengthStr(m.W)}.`;
    }
    return `Band diagram of ${m.mat.name}. Fermi level ${m.FminusI.toFixed(3)} eV from the intrinsic level.`;
  }


  /* ---------- R–G processes tab ---------- */
  const RGP = SV.RG_PROCESSES;
  const MECH_NAME = { srh: 'R–G center (SRH)', rad: 'Band-to-band (radiative)', aug: 'Auger' };

  function updateRG() {
    const mat = MATS[state.material];
    model = P.rg(state);
    rgView.setModel(model, state.rgProc, { animate: state.show.carriers });

    setRadio($('materials'), 'mat', state.material);
    setRadio($('mode'), 'mode', state.mode);
    setRadio($('bulk-type'), 'type', state.bulkType);
    setRadio($('rg-grid'), 'proc', state.rgProc);
    $('doping-bulk').hidden = false;
    $('doping-pn').hidden = true;
    $('bulk-n-field').hidden = state.bulkType === 'i';
    $('bulk-n-name').innerHTML = state.bulkType === 'p' ? '<i class="mi">N</i><sub>A</sub>' : '<i class="mi">N</i><sub>D</sub>';
    $('bulk-n').style.setProperty('--fill', state.bulkType === 'p' ? 'var(--hole)' : 'var(--electron)');
    const bn = $('bulk-n');
    if (document.activeElement !== bn) bn.value = toIdx(state.bulkN);
    setRangeFill(bn);
    typed['bulk-n'].set(state.bulkN);
    $('temp').value = state.T; setRangeFill($('temp')); typed.T.set(state.T);
    document.querySelectorAll('[data-show]').forEach((c) => { c.checked = state.show[c.dataset.show]; });

    // carrier controls
    const u = $('rg-u');
    if (document.activeElement !== u) u.value = state.rgU;
    setRangeFill(u);
    typed.u.set(state.rgU);
    $('rg-u-out').innerHTML = state.rgU > 0
      ? `${mh('Δn = Δp')} = ${F.sciHTML(model.delta, 1)}`
      : state.rgU < 0 ? `${mh('n, p')} × ${F.sciHTML(model.scale, 0)}` : `${mh('np = n_i^2')}`;
    const half = model.fr.Eg / 2;
    const et = $('rg-et');
    et.min = (-half).toFixed(2); et.max = half.toFixed(2);
    if (Math.abs(state.rgET) > half) state.rgET = Math.sign(state.rgET) * half;
    if (document.activeElement !== et) et.value = state.rgET;
    et.style.setProperty('--fill', 'var(--rgc)');
    setRangeFill(et);
    typed.et.set(state.rgET);
    const tau = state.rgTau || mat.tau;
    const tr = $('rg-tau');
    if (document.activeElement !== tr) tr.value = NL.toIdx(tau, -10);
    setRangeFill(tr);
    typed.tau.set(tau);

    renderLegendRG();
    renderPropsRG();
    renderReadoutsRG();
    renderNoticeRG();
    renderEquationsRG();
    renderStepsRG();
    renderRatesRG();
    $('diagram').setAttribute('aria-label', `${RGP[state.rgProc].title} in ${mat.name}. ${RGP[state.rgProc].note}`);
    writeHash();
  }

  function fmtTime(t) {
    for (const [u, name] of [[1e-3, 'ms'], [1e-6, 'µs'], [1e-9, 'ns'], [1e-12, 'ps']]) {
      const v = t / u;
      if (v >= 0.9995 || u === 1e-12) return (v >= 99.5 ? v.toFixed(0) : String(Number(v.toPrecision(2)))) + ' ' + name;
    }
  }

  /* typeset only the symbols inside a plain-English sentence */
  function symbols(txt) {
    return txt.replace(/hν ≈ E_g|hν ≥ E_g|E_T ≈ E_i|E_T|E_i|E_g|n_i²|np < n_i²|ℰ/g, (m0) => mh(m0.replace('²', '^2')));
  }

  function renderPropsRG() {
    renderProps();
    const m = MATS[state.material];
    const rows = [
      ['B', F.sciHTML(m.B, 1) + ' cm³/s'],
      ['C_n', F.sciHTML(m.Cn, 1) + ' cm⁶/s'],
      ['C_p', F.sciHTML(m.Cp, 1) + ' cm⁶/s'],
      ['`Band gap`', m.direct ? 'direct' : 'indirect']
    ];
    $('props').innerHTML += rows.map(([k, v]) => `<dt>${mh(k)}</dt><dd>${v}</dd>`).join('');
    $('props-note').textContent = (m.approx ? `${m.label} is not tabulated in Pierret; typical literature values.` : `Values from Pierret's tables.`) +
      ' B, C_n and C_p are typical literature values.';
  }

  function renderLegendRG() {
    const eq = model.ratio === 1;
    const items = [
      `<span class="item"><span class="sw band"></span><span>${mh('E_c, E_v')}</span></span>`,
      `<span class="item"><span class="sw ei"></span><span>${mh('E_i')}</span></span>`,
      `<span class="item"><span class="trap-sq"></span><span>R–G centers at ${mh('E_T')}</span></span>`,
      eq ? `<span class="item"><span class="sw ef"></span><span>${mh('E_F')}</span></span>`
         : `<span class="item"><span class="sw fn"></span><span>${mh('F_N')}</span></span><span class="item"><span class="sw fp"></span><span>${mh('F_P')}</span></span>`,
      '<span class="item"><span class="dot"></span>electron</span>',
      '<span class="item"><span class="ring"></span>hole</span>',
      '<span class="item"><span class="wave"></span>photon</span>',
      '<span class="item"><span class="zig"></span>phonon (lattice heat)</span>'
    ];
    $('legend').innerHTML = items.join('') + '<span class="note">Faint events in the background run at rates set by np / n<sub>i</sub><sup>2</sup>.</span>';
  }

  function renderStepsRG() {
    const P = RGP[state.rgProc];
    $('rg-steps').innerHTML = `<div class="rg-title"><strong>${P.title}</strong><span class="rg-note">${symbols(P.note)}</span></div>
      <ol class="rg-list">${P.steps.map(([, txt], i) => `<li class="rg-step${i === rgView.step ? ' on' : ''}">${symbols(txt)}</li>`).join('')}</ol>`;
    rgView.step = -1;
  }

  function signedSci(x) {
    if (x === 0) return '0';
    return (x < 0 ? '−' : '') + F.sciHTML(Math.abs(x), 2);
  }

  function renderReadoutsRG() {
    const m = model;
    const net = m.U > 0 ? 'net recombination' : m.U < 0 ? 'net generation' : 'balanced';
    const dom = m.dominant ? { srh: 'R–G center', rad: 'Band-to-band', aug: 'Auger' }[m.dominant] : 'None';
    $('readouts').innerHTML = [
      metric('n', F.sciHTML(m.n, 2), '', false, 'cm<sup>−3</sup>'),
      metric('p', F.sciHTML(m.p, 2), '', false, 'cm<sup>−3</sup>'),
      metric('np / n_i^2', F.sciHTML(m.ratio, 1), '', false),
      metric('U', signedSci(m.U), '', true, 'cm<sup>−3</sup>s<sup>−1</sup>').replace('</div></div>', `</div><div class="metric-sub">${net}</div></div>`),
      metric('τ_{eff}', m.tauEff ? fmtTime(m.tauEff).replace(' ', '<span class="unit">') + '</span>' : '—', ''),
      `<div class="metric"><div class="metric-label">Dominant</div><div class="metric-value txt">${dom}</div></div>`
    ].join('');
  }

  function renderNoticeRG() {
    const m = model, mat = MATS[state.material], msgs = [];
    if (state.rgU > 0 && m.injection > 0.1) msgs.push(`High-level injection: the excess carriers (${F.sciHTML(m.delta, 1)} cm<sup>−3</sup>) rival the doping, so the simple ${mh('Δn/τ')} form no longer holds and Auger and radiative terms grow fastest.`);
    if (!mat.direct && (state.rgProc === 'b2bR' || state.rgProc === 'b2bG')) msgs.push(`${mat.label} has an indirect gap: band-to-band transitions also need a phonon for momentum, which is why ${mh('B')} is tiny and R–G centers dominate.`);
    $('notice').hidden = !msgs.length;
    $('notice').innerHTML = msgs.join(' ');
  }

  function renderRatesRG() {
    const m = model;
    const rows = [['srh', m.Usrh], ['rad', m.Urad], ['aug', m.Uaug]];
    const max = Math.max(1e-300, ...rows.map((r) => Math.abs(r[1])));
    const cls = { srh: 'var(--rgc)', rad: '#fff1a8', aug: '#ffb35c' };
    const net = m.U > 0 ? 'Net recombination' : m.U < 0 ? 'Net generation' : 'Recombination and generation balance';
    let extra;
    if (state.rgU > 0) extra = `Excess carriers live ${mh('τ_{eff}')} = <b>${fmtTime(m.tauEff)}</b> on average.`;
    else if (state.rgU < 0) extra = `With carriers removed, R–G centers generate pairs. Fully depleted (${mh('n, p → 0')}): ${mh('G')} = ${F.sciHTML(m.Gdep, 2)} cm<sup>−3</sup>s<sup>−1</sup>.`;
    else extra = 'In equilibrium every mechanism runs both ways at the same rate, so nothing changes.';
    $('rg-rates').innerHTML = `<h2>Rates in this sample</h2>
      ${rows.map(([k, v]) => {
        const w = v === 0 ? 0 : Math.max(2, 100 * (1 + Math.log10(Math.abs(v) / max) / 10));
        return `<div class="rate-row${m.dominant === k ? ' dom' : ''}">
          <span class="rate-name">${MECH_NAME[k]}</span>
          <span class="rate-val">${signedSci(v)}</span>
          <span class="cur-bar"><i style="width:${w}%;background:${cls[k]}"></i></span>
        </div>`;
      }).join('')}
      <div class="cur-net">
        <div class="eqline">${mh('U = U_{SRH} + U_{rad} + U_{Auger}')}</div>
        <div class="value">${signedSci(m.U)}<span class="unit">cm<sup>−3</sup>s<sup>−1</sup></span></div>
        <div class="dirtext">${net}</div>
      </div>
      <p class="cur-note">${extra} Photogeneration needs light and impact ionization needs ${mh('ℰ')} ≳ 10<sup>5</sup> V/cm, so neither appears in this balance. Bars use a log scale over 10 decades.</p>`;
  }

  function renderEquationsRG() {
    const m = model;
    const kT = m.kT.toFixed(4);
    const nType = m.n0 >= m.p0;
    const rows = [
      {
        eq: mh('U_{SRH} = ') + frac(mh('np − n_i^2'), mh('τ_p(n + n_1) + τ_n(p + p_1)')),
        val: `= <b>${signedSci(m.Usrh)}</b> cm<sup>−3</sup>s<sup>−1</sup> with ${mh('τ_n = τ_p')} = ${fmtTime(m.tau)}. Positive means net recombination, negative net generation.`,
        ref: 'Ch. 3'
      },
      {
        eq: mh('n_1 = n_i e^{(E_T − E_i)/kT},  p_1 = n_i e^{(E_i − E_T)/kT}'),
        val: `${mh('n_1')} = ${F.sciHTML(m.n1, 2)}, ${mh('p_1')} = ${F.sciHTML(m.p1, 2)} cm<sup>−3</sup>. A level far from midgap makes one of these large and the center less effective.`,
        ref: 'Ch. 3'
      },
      {
        eq: nType ? mh('U ≈ Δp / τ_p') + ' <span class="mu eq-note">(n-type, low-level injection)</span>' : mh('U ≈ Δn / τ_n') + ' <span class="mu eq-note">(p-type, low-level injection)</span>',
        val: state.rgU > 0
          ? `${mh(nType ? 'Δp/τ_p' : 'Δn/τ_n')} = ${F.sciHTML(m.delta / m.tau, 2)} vs. full SRH ${F.sciHTML(m.Usrh, 2)} cm<sup>−3</sup>s<sup>−1</sup>. Recombination is limited by the minority carrier.`
          : 'Applies with excess carriers: drag the carrier slider toward “injected”.',
        ref: 'Ch. 3'
      },
      {
        eq: mh('G = −U = ') + frac(mh('n_i^2'), mh('τ_p n_1 + τ_n p_1')) + mh(' = ') + frac(mh('n_i'), mh('τ_n + τ_p')) + ' <span class="mu eq-note">(n, p → 0; second form for E<sub>T</sub> = E<sub>i</sub>)</span>',
        val: `= <b>${F.sciHTML(m.Gdep, 2)}</b> cm<sup>−3</sup>s<sup>−1</sup>. This is the generation inside a reverse-biased depletion region.`,
        ref: 'Ch. 6'
      },
      {
        eq: mh('U_{rad} = B(np − n_i^2)'),
        val: `${mh('B')} = ${F.sciHTML(m.mat.B, 1)} cm³/s → <b>${signedSci(m.Urad)}</b> cm<sup>−3</sup>s<sup>−1</sup>`,
        ref: 'Ch. 3'
      },
      {
        eq: mh('U_{Auger} = (C_n n + C_p p)(np − n_i^2)'),
        val: `${mh('C_n')} = ${F.sciHTML(m.mat.Cn, 1)}, ${mh('C_p')} = ${F.sciHTML(m.mat.Cp, 1)} cm⁶/s → <b>${signedSci(m.Uaug)}</b> cm<sup>−3</sup>s<sup>−1</sup>`,
        ref: 'Ch. 3'
      }
    ];
    $('equations').innerHTML = `<h2>How the numbers are computed</h2>
      <p class="eq-intro">${mh('kT')} = ${kT} eV. Each line shows the relation and its value for the current settings.</p>` +
      rows.map((r) => `<div class="eq-row"><div class="eq">${r.eq}</div><div class="eq-val">${r.val}</div><div class="eq-ref">Pierret ${r.ref}</div></div>`).join('');
  }

  /* ---------- diagram hover readout ---------- */
  const probe = $('probe');
  function showProbe(ev) {
    const cv = $('diagram');
    const r = cv.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    const geo = diagram.geo;
    if (state.mode === 'rg') { hideProbe(); return; }
    if (!geo || px < geo.plotL || px > geo.plotR || py < geo.bandTop || py > geo.bottom) { hideProbe(); return; }
    const part = diagram.particleAt(px, py);
    diagram.hoverParticle = part;
    if (part) {
      diagram.setHover(null);
      probe.innerHTML = carrierStory(part);
      probe.classList.add('story');
      placeProbe(ev);
      return;
    }
    probe.classList.remove('story');
    diagram.setHover(px);
    const inf = diagram.info(px);
    if (!inf) { hideProbe(); return; }
    // nearest level to the pointer
    let near = null, best = 14;
    for (const lv of inf.levels) {
      const d = Math.abs(geo.Y(lv.E) - py);
      if (d < best) { best = d; near = lv.key; }
    }
    const rows = inf.levels.map((lv) => `<div class="pr-row${lv.key === near ? ' near' : ''}">
        <span class="pr-sw" style="background:${lv.color}"></span><span class="pr-name">${mh(lv.name)}</span>
        <span class="pr-val">${F.signed(lv.E, 3)} eV</span>
        ${lv.key === near ? `<span class="pr-desc">${lv.desc}</span>` : ''}
      </div>`).join('');
    const xLine = inf.compressed || model.mode === 'bulk'
      ? (model.mode === 'bulk' ? `${mh('x')} = ${(inf.x * 1e4).toFixed(2)} µm` : '')
      : `${mh('x')} = ${(inf.x * 1e4).toFixed(3)} µm`;
    const field = Math.abs(inf.field) > 0 ? `${F.sciHTML(Math.abs(inf.field), 2)} V/cm ${inf.field < 0 ? '← (toward p)' : '→'}` : '0';
    probe.innerHTML = `<div class="pr-region">${inf.region}</div>
      ${xLine ? `<div class="pr-x">${xLine}</div>` : ''}
      <div class="pr-rows">${rows}</div>
      <div class="pr-carriers"><span>${mh('n')} = ${F.sciHTML(inf.n, 2)}</span><span>${mh('p')} = ${F.sciHTML(inf.p, 2)}</span><span class="u">cm<sup>−3</sup></span></div>
      <div class="pr-field">${mh('ℰ')} = ${field}</div>`;
    placeProbe(ev);
  }
  function placeProbe(ev) {
    probe.hidden = false;
    const fr = $('figure').getBoundingClientRect();
    const w = probe.offsetWidth, h = probe.offsetHeight;
    let left = ev.clientX - fr.left + 18;
    if (left + w > fr.width - 8) left = ev.clientX - fr.left - w - 18;
    let top = ev.clientY - fr.top - h / 2;
    top = Math.max(8, Math.min(fr.height - h - 8, top));
    probe.style.left = left + 'px';
    probe.style.top = top + 'px';
  }
  function hideProbe() {
    probe.hidden = true;
    diagram.setHover(null);
    diagram.hoverParticle = null;
  }

  /* what a hovered carrier is doing, and what happens to it next */
  function carrierStory(p) {
    const m = model;
    const e = p.sp === 'e';
    const one = e ? 'electron' : 'hole', many = e ? 'electrons' : 'holes', Name = e ? 'Electron' : 'Hole';
    const tag = (k) => ({ diff: '<span class="tag t-diff">Diffusion</span>', drift: '<span class="tag t-drift">Drift</span>',
      rand: '<span class="tag t-rand">Random thermal motion</span>', rg: '<span class="tag t-rg">R–G</span>' }[k]);
    if (m.mode === 'bulk') {
      const maj = e ? m.n0 >= m.p0 : m.p0 > m.n0;
      const conc = e ? m.n0 : m.p0;
      const drifting = m.V !== 0;
      return `${tag(drifting ? 'drift' : 'rand')}<div class="st-title">${maj ? 'Majority' : 'Minority'} ${one}</div>
        <p>${mh(e ? 'n_0' : 'p_0')} = ${F.sciHTML(conc, 2)} cm<sup>−3</sup>. ${drifting
          ? `The tilted bands mean a field ${mh('ℰ')} = ${F.sciHTML(Math.abs(m.field), 2)} V/cm. ${e ? 'Electrons roll downhill toward the + contact' : 'Holes float up the bands toward the − contact'}, on top of their random motion.`
          : 'With no field and uniform doping it only moves randomly: no drift, no diffusion, no net current.'}</p>`;
    }
    const other = (s) => (s === 'n' ? 'p' : 'n');
    const home = e ? 'n' : 'p';
    const life = e ? `${mh('τ_n')} ≈ ${fmtTime(m.tau)}, ${mh('L_N')} ≈ ${F.lengthStr(m.LN)}` : `${mh('τ_p')} ≈ ${fmtTime(m.tau)}, ${mh('L_P')} ≈ ${F.lengthStr(m.LP)}`;
    const barrier = F.eV(m.psi, 2);
    const foot = '<p class="st-foot">The R–G processes tab shows recombination and generation step by step.</p>';
    if (p.kind === 'bg') {
      const maj = p.side === home;
      const conc = e ? (p.side === 'n' ? m.nn0 : m.np0) : (p.side === 'p' ? m.pp0 : m.pn0);
      if (maj) {
        return `${tag('rand')}<div class="st-title">Majority ${one} on the ${p.side} side</div>
          <p>About ${F.sciHTML(conc, 1)} cm<sup>−3</sup> of these. It moves randomly; only the few with enough energy diffuse over the ${barrier} barrier.</p>`;
      }
      return `${tag('rand')}<div class="st-title">Minority ${one} on the ${p.side} side</div>
        <p>Only about ${F.sciHTML(conc, 1)} cm<sup>−3</sup>. If it reaches the depletion edge, ${mh('ℰ')} sweeps it across (drift). Otherwise it recombines with a majority carrier through an R–G center (${life}).</p>${foot}`;
    }
    if (p.kind === 'try') {
      if (p.state === 'go') {
        return `${tag('diff')}<div class="st-title">${Name} diffusing toward the ${other(home)} side</div>
          <p>${Name}s are crowded on the ${home} side and scarce on the ${other(home)} side, so they spread toward it. To cross, this one needs at least ${barrier} of extra energy. Most don't have it and turn back.</p>`;
      }
      if (p.state === 'back') {
        return `${tag('diff')}<div class="st-title">Turned back at the barrier</div>
          <p>Not enough energy to clear the ${barrier} barrier, so it rejoins the majority ${many} on the ${home} side. Forward bias lowers the barrier so more get through.</p>`;
      }
      return `${tag('diff')}<div class="st-title">Injected: over the barrier</div>
        <p>Now a minority carrier on the ${other(home)} side. It keeps diffusing until it recombines with a majority carrier through an R–G center (trap-assisted, SRH): ${life}. Watch for the green flash as it recombines.</p>${foot}`;
    }
    // drift
    const J = e ? m.comps.nDrift : m.comps.pDrift;
    return `${tag('drift')}${tag('rg')}<div class="st-title">Minority ${one} swept across by ${mh('ℰ')}</div>
      <p>Created by thermal generation at an R–G center near the depletion edge (the green pop). The field pushes it ${e ? 'down the hill' : 'up the bands'} to the ${home} side. These carriers make the drift current, ${F.sciHTML(J, 2)} A/cm².</p>${foot}`;
  }
  $('diagram').addEventListener('pointermove', showProbe);
  $('diagram').addEventListener('pointerdown', showProbe);
  $('diagram').addEventListener('pointerleave', hideProbe);

  /* ---------- events ---------- */
  $('mode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    state.mode = b.dataset.mode;
    update();
  });
  radioKeys($('mode'), '[data-mode]');

  $('bulk-type').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    state.bulkType = b.dataset.type;
    update();
  });
  radioKeys($('bulk-type'), '[data-type]');

  $('na').addEventListener('input', (e) => { state.NA = fromIdx(e.target.value); update(); });
  $('nd').addEventListener('input', (e) => { state.ND = fromIdx(e.target.value); update(); });
  $('bulk-n').addEventListener('input', (e) => { state.bulkN = fromIdx(e.target.value); update(); });
  $('temp').addEventListener('input', (e) => { state.T = parseFloat(e.target.value); update(); });

  document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const p = b.dataset.preset;
    if (p === 'sym') { state.NA = 1e16; state.ND = 1e16; }
    if (p === 'p+n') { state.NA = 1e18; state.ND = 1e15; }
    if (p === 'n+p') { state.NA = 1e15; state.ND = 1e18; }
    update();
  }));

  document.querySelectorAll('[data-show]').forEach((c) => c.addEventListener('change', () => {
    state.show[c.dataset.show] = c.checked;
    update();
  }));

  $('va-zero').addEventListener('click', () => {
    if (state.mode === 'pn') state.VA = 0; else state.Vbulk = 0;
    update();
  });

  $('rg-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-proc]');
    if (!b) return;
    state.rgProc = b.dataset.proc;
    update();
  });
  radioKeys($('rg-grid'), '[data-proc]');
  $('rg-u').addEventListener('input', (e) => {
    let v = parseFloat(e.target.value);
    if (Math.abs(v) < 0.03) v = 0;
    state.rgU = v; update();
  });
  $('rg-et').addEventListener('input', (e) => { let v = parseFloat(e.target.value); if (Math.abs(v) < 0.012) v = 0; state.rgET = v; update(); });
  $('rg-tau').addEventListener('input', (e) => { state.rgTau = NL.fromIdx(e.target.value, -10); update(); });
  document.querySelectorAll('[data-rgu]').forEach((b) => b.addEventListener('click', () => { state.rgU = parseFloat(b.dataset.rgu); update(); }));

  $('iv-scale').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scale]');
    if (!b) return;
    state.ivScale = b.dataset.scale;
    setRadio($('iv-scale'), 'scale', state.ivScale);
    drawIV();
  });
  setRadio($('iv-scale'), 'scale', state.ivScale);

  /* ---------- boot ---------- */
  readHash();
  buildMaterials();

  new ResizeObserver(() => { diagram.resize(); if (state.mode === 'pn') drawIV(); }).observe($('diagram'));
  diagram.resize();
  update();

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { diagram.dirty = true; if (state.mode === 'pn') drawIV(); });
  }

  let last = performance.now();
  function loop(now) {
    const dt = (now - last) / 1000;
    last = now;
    if (state.mode === 'rg') rgView.frame(dt); else diagram.frame(dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // test/screenshot hook
  window.SV.app = { state, update, diagram, rgView, showProbe };
})();
