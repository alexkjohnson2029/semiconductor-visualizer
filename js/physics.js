/*
 * Physics engine. Notation follows Pierret, "Semiconductor Device Fundamentals":
 *   Ch. 2  carrier modeling (n, p, Fermi level, Ei position)
 *   Ch. 3  carrier action (drift, diffusion, mobility)
 *   Ch. 5  pn junction electrostatics (depletion approximation, step junction)
 *   Ch. 6  pn junction diode I-V (ideal diode equation, quasi-Fermi levels)
 *
 * Units: energies in eV, potentials in V, concentrations in cm^-3,
 * lengths in cm internally (converted to um for display), fields in V/cm,
 * current densities in A/cm^2.
 *
 * Energy reference: in pn mode the p-side Fermi level (F_P far from the
 * junction) is 0 eV. In bulk mode the Fermi level at the left contact is 0 eV.
 */
window.SV = window.SV || {};

SV.CONST = {
  k: 8.617333262e-5,      // eV/K
  q: 1.602176634e-19,     // C
  eps0: 8.8541878128e-14  // F/cm
};

SV.physics = (function () {
  const { k, q, eps0 } = SV.CONST;

  function Eg(mat, T) {
    const v = mat.varshni;
    const shift = (t) => v.a * t * t / (t + v.b);
    return mat.Eg300 - shift(T) + shift(300);
  }

  function ni(mat, T) {
    const kT = k * T, kT0 = k * 300;
    return mat.ni300 * Math.pow(T / 300, 1.5) *
      Math.exp(-Eg(mat, T) / (2 * kT) + mat.Eg300 / (2 * kT0));
  }

  /* Ei - midgap = (3/4) kT ln(mp_eff / mn_eff)  (Pierret Ch. 2) */
  function eiOffset(mat, T) {
    return 0.75 * k * T * Math.log(mat.mp / mat.mn);
  }

  function Nc(mat, T) { return mat.Nc300 * Math.pow(T / 300, 1.5); }
  function Nv(mat, T) { return mat.Nv300 * Math.pow(T / 300, 1.5); }

  function mobility(spec, N) {
    return spec.min + spec.mu0 / (1 + Math.pow(Math.max(N, 1) / spec.Nref, spec.alpha));
  }

  /* Equilibrium carrier concentrations with full ionization
   * n0 = (ND-NA)/2 + sqrt(((ND-NA)/2)^2 + ni^2),  p0 = ni^2 / n0  */
  function carriers(ND, NA, n_i) {
    const h = (ND - NA) / 2;
    let n0;
    if (h >= 0) {
      n0 = h + Math.sqrt(h * h + n_i * n_i);
    } else {
      // numerically stable form for p-type: n0 = ni^2 / p0
      const p0 = -h + Math.sqrt(h * h + n_i * n_i);
      n0 = n_i * n_i / p0;
    }
    return { n0, p0: n_i * n_i / n0 };
  }

  function bandFrame(mat, T) {
    const eg = Eg(mat, T);
    const off = eiOffset(mat, T);
    return {
      Eg: eg,
      off,
      cMinusI: eg / 2 - off,   // Ec - Ei
      iMinusV: eg / 2 + off    // Ei - Ev
    };
  }

  /* ---------- Single (uniformly doped) semiconductor ---------- */
  function bulk(state) {
    const mat = SV.MATERIALS[state.material];
    const T = state.T;
    const kT = k * T;
    const n_i = ni(mat, T);
    const ND = state.bulkType === 'n' ? state.bulkN : 0;
    const NA = state.bulkType === 'p' ? state.bulkN : 0;
    const { n0, p0 } = carriers(ND, NA, n_i);
    const fr = bandFrame(mat, T);
    const FminusI = kT * Math.log(n0 / n_i);       // EF - Ei
    const cMinusF = fr.cMinusI - FminusI;           // Ec - EF
    const fMinusV = fr.iMinusV + FminusI;           // EF - Ev
    const muN = mobility(mat.mob.n, ND + NA);
    const muP = mobility(mat.mob.p, ND + NA);
    const L = 10e-4;                                // sample length: 10 um
    const V = state.VA;                             // voltage on right contact
    const field = -V / L;                           // V/cm, + means +x direction
    const sigma = q * (muN * n0 + muP * p0);        // S/cm
    const Jn = q * muN * n0 * field;                // A/cm^2 (sign = direction)
    const Jp = q * muP * p0 * field;
    const degenerate = cMinusF < 3 * kT || fMinusV < 3 * kT;

    // Energy profiles: left contact at 0 V, right contact at V.
    // Electron energy = -q * potential, so bands drop by V eV left -> right.
    const EiAt0 = -FminusI;  // EF(left) = 0
    const xs = [0, L];
    const prof = (x) => -V * (x / L);
    return {
      mode: 'bulk', mat, T, kT, ni: n_i, ND, NA, n0, p0, fr,
      FminusI, cMinusF, fMinusV, muN, muP, sigma, Jn, Jp, J: Jn + Jp,
      field, L, V, degenerate,
      xMin: 0, xMax: L,
      Ei: (x) => EiAt0 + prof(x),
      Ec: (x) => EiAt0 + prof(x) + fr.cMinusI,
      Ev: (x) => EiAt0 + prof(x) - fr.iMinusV,
      EF: (x) => prof(x),
      fieldAt: () => field,
      xs
    };
  }

  /* Depletion width for a given applied voltage (step junction) */
  function depletionWidth(Ks, NA, ND, Vj) {
    return Math.sqrt(2 * Ks * eps0 / q * (NA + ND) / (NA * ND) * Math.max(Vj, 0));
  }

  /* ---------- pn step junction ----------
   *
   * Low-level injection reproduces Pierret's ideal diode exactly. To show what
   * happens as V_A approaches and exceeds V_bi, three standard extensions are used:
   *
   *  1. Law of the junction with quasi-neutrality at the depletion edges:
   *       n(-xp) p(-xp) = ni^2 exp(qVj/kT),  p(-xp) = NA + n(-xp)
   *     so injected carriers can rival the doping (high-level injection).
   *  2. The junction barrier is q*psi = kT ln[p(-xp) / p(xn)], which equals
   *     q(Vbi - Vj) at low injection and only approaches zero as Vj grows.
   *  3. A series resistance r_s = rho_p l_p + rho_n l_n from quasi-neutral
   *     regions l = 3 diffusion lengths long:  V_A = Vj + J r_s.
   *     Whatever the junction cannot take drops across the neutral regions.
   */
  function device(state) {
    const mat = SV.MATERIALS[state.material];
    const T = state.T;
    const Vt = k * T;
    const n_i = ni(mat, T), ni2 = n_i * n_i;
    const NA = state.NA, ND = state.ND;

    const pSide = carriers(0, NA, n_i);
    const nSide = carriers(ND, 0, n_i);
    const pp0 = pSide.p0, np0 = pSide.n0;
    const nn0 = nSide.n0, pn0 = nSide.p0;
    const Vbi = Vt * Math.log(pp0 * nn0 / ni2);

    const muN = mobility(mat.mob.n, NA);      // minority electrons on the p side
    const muP = mobility(mat.mob.p, ND);      // minority holes on the n side
    const muPmaj = mobility(mat.mob.p, NA);   // majority holes on the p side
    const muNmaj = mobility(mat.mob.n, ND);   // majority electrons on the n side
    const DN = Vt * muN, DP = Vt * muP;
    const tau = mat.tau;
    const LN = Math.sqrt(DN * tau), LP = Math.sqrt(DP * tau);
    const lp = 3 * LN, ln = 3 * LP;           // neutral-region lengths to the contacts
    const rhoP = 1 / (q * muPmaj * pp0), rhoN = 1 / (q * muNmaj * nn0);
    const rs = rhoP * lp + rhoN * ln;         // ohm cm^2

    function edge(Vj) {
      const X = ni2 * Math.exp(Vj / Vt);
      const npe = 2 * X / (NA + Math.sqrt(NA * NA + 4 * X));
      const pne = 2 * X / (ND + Math.sqrt(ND * ND + 4 * X));
      return { npe, ppe: NA + npe, pne, nne: ND + pne };
    }
    const J0n = q * DN * np0 / LN;
    const J0p = q * DP * pn0 / LP;
    function currents(Vj) {
      const e = edge(Vj);
      const nDiff = q * DN * e.npe / LN, pDiff = q * DP * e.pne / LP;
      return { e, nDiff, nDrift: J0n, pDiff, pDrift: J0p,
        J: (nDiff - J0n) + (pDiff - J0p) };
    }
    function solve(VA) {
      let lo = Math.min(VA, 0) - 1, hi = Math.max(VA, 0) + 1;
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        if (mid + rs * currents(mid).J - VA > 0) hi = mid; else lo = mid;
      }
      const Vj = (lo + hi) / 2;
      return { Vj, ...currents(Vj) };
    }
    return { mat, T, Vt, n_i, ni2, NA, ND, pp0, np0, nn0, pn0, Vbi,
      muN, muP, muPmaj, muNmaj, DN, DP, tau, LN, LP, lp, ln, rhoP, rhoN, rs,
      J0n, J0p, J0: J0n + J0p, edge, currents, solve };
  }

  function junction(state) {
    const dev = device(state);
    const { mat, T, Vt, n_i, NA, ND, Vbi, LN, LP, lp, ln } = dev;
    const kT = k * T;
    const fr = bandFrame(mat, T);
    const Ks = mat.Ks;
    const VA = state.VA;

    const sol = dev.solve(VA);
    const Vj = sol.Vj, J = sol.J, ed = sol.e;
    const psi = Vt * Math.log(ed.ppe / ed.pne);       // junction barrier (V)
    const W = depletionWidth(Ks, NA, ND, psi);
    const xn = W * NA / (NA + ND);
    const xp = W * ND / (NA + ND);
    const Emax = q * ND * xn / (Ks * eps0);
    const dropP = J * dev.rhoP * lp;                   // IR drop across the p neutral region
    const dropN = J * dev.rhoN * ln;

    // Fixed horizontal window (sized for the widest reverse-bias depletion region)
    // with a compressed zone at each end standing for the rest of the neutral
    // region out to the ohmic contact (3 diffusion lengths).
    const Wmax = depletionWidth(Ks, NA, ND, Vbi - SV.physics.VA_MIN_PN);
    const xnMax = Wmax * NA / (NA + ND), xpMax = Wmax * ND / (NA + ND);
    const pad = 0.56 * Wmax;
    const xMin = -(xpMax + pad), xMax = xnMax + pad;
    const cz = 0.1 * (xMax - xMin);
    const pIn = xMin + cz, nIn = xMax - cz;

    // depletion-region potential, 0 at -xp rising to psi at xn
    function Vdep(x) {
      if (x <= -xp) return 0;
      if (x <= 0) return q * NA / (2 * Ks * eps0) * (x + xp) * (x + xp);
      if (x < xn) return psi - q * ND / (2 * Ks * eps0) * (xn - x) * (xn - x);
      return psi;
    }
    function field(x) {
      if (x <= -xp || x >= xn) return 0;
      if (x <= 0) return -q * NA / (Ks * eps0) * (x + xp);
      return -q * ND / (Ks * eps0) * (xn - x);
    }
    function rho(x) {
      if (x <= -xp || x >= xn) return 0;
      return x <= 0 ? -q * NA : q * ND;
    }

    // distance from the depletion edge, with the compressed zones mapped onto l_p, l_n
    function dP(x) {
      if (x >= pIn) return -xp - x;
      const wv = Math.max(0, -xp - pIn), s = (x - xMin) / cz;
      return wv + (1 - s) * (lp - wv);
    }
    function dN(x) {
      if (x <= nIn) return x - xn;
      const wv = Math.max(0, nIn - xn), s = (xMax - x) / cz;
      return wv + (1 - s) * (ln - wv);
    }
    const shP = Math.sinh(lp / LN), shN = Math.sinh(ln / LP);
    const nP = (x) => dev.np0 + (ed.npe - dev.np0) * Math.sinh((lp - dP(x)) / LN) / shP;
    const pN = (x) => dev.pn0 + (ed.pne - dev.pn0) * Math.sinh((ln - dN(x)) / LP) / shN;

    // majority quasi-Fermi levels carry the IR drop (reference: F_P = 0 at the p contact)
    const FPmaj = (x) => (x <= pIn ? dropP * (x - xMin) / cz : dropP);
    const FNmaj = (x) => dropP + Vj + (x >= nIn ? dropN * (x - nIn) / cz : 0);
    const EiEdgeP = dropP + Vt * Math.log(ed.ppe / n_i);

    function Ei(x) {
      if (x <= -xp) return FPmaj(x) + Vt * Math.log((NA + nP(x)) / n_i);
      if (x < xn) return EiEdgeP - Vdep(x);
      return FNmaj(x) - Vt * Math.log((ND + pN(x)) / n_i);
    }
    function FP(x) {
      if (x <= xn) return x <= -xp ? FPmaj(x) : dropP;
      return Ei(x) - Vt * Math.log(pN(x) / n_i);
    }
    function FN(x) {
      if (x >= -xp) return x >= xn ? FNmaj(x) : dropP + Vj;
      return Ei(x) + Vt * Math.log(nP(x) / n_i);
    }
    const Ec = (x) => Ei(x) + fr.cMinusI;
    const Ev = (x) => Ei(x) - fr.iMinusV;
    const nAt = (x) => n_i * Math.exp((FN(x) - Ei(x)) / Vt);
    const pAt = (x) => n_i * Math.exp((Ei(x) - FP(x)) / Vt);

    const seriesDrop = dropP + dropN;
    const injP = ed.npe / NA, injN = ed.pne / ND;      // injection level at each edge
    const highInjection = VA > 0 && Math.max(injP, injN) > 0.1;
    let regime = 'equilibrium';
    if (VA < 0) regime = 'reverse';
    else if (VA > 0) regime = seriesDrop > 0.05 ? 'series' : highInjection ? 'high' : 'forward';

    const Jideal = dev.J0 * (Math.exp(VA / Vt) - 1);

    return {
      mode: 'pn', mat, T, kT, Vt, ni: n_i, NA, ND, fr, dev,
      pp0: dev.pp0, np0: dev.np0, nn0: dev.nn0, pn0: dev.pn0,
      Vbi, VA, Vj, psi, Vbar: psi, W, xn, xp, Emax, Ks,
      Vdep, field, rho, Ei, Ec, Ev, FN, FP, nAt, pAt,
      EF: (x) => (x < 0 ? FP(x) : FN(x)),
      muN: dev.muN, muP: dev.muP, DN: dev.DN, DP: dev.DP, LN, LP, lp, ln, tau: dev.tau,
      rhoP: dev.rhoP, rhoN: dev.rhoN, rs: dev.rs,
      J0n: dev.J0n, J0p: dev.J0p, J0: dev.J0, J, Jideal,
      comps: { nDiff: sol.nDiff, nDrift: sol.nDrift, pDiff: sol.pDiff, pDrift: sol.pDrift },
      edge: ed, injP, injN, dropP, dropN, seriesDrop,
      fieldIRp: J * dev.rhoP, fieldIRn: J * dev.rhoN,
      xMin, xMax, Wmax, cz, pIn, nIn,
      iMinusFp: Ei(pIn) - FP(pIn),
      fMinusIn: FN(nIn) - Ei(nIn),
      degenerateP: Ev(xMin) > FP(xMin) - 3 * kT,
      degenerateN: Ec(xMax) < FN(xMax) + 3 * kT,
      highInjection, regime
    };
  }


  /* ---------- recombination and generation (Pierret Ch. 3) ----------
   * Uniformly doped sample whose carriers are pushed off equilibrium.
   * state.rgU in [-1, 1]: negative removes carriers (n and p scaled down, np < ni^2),
   * positive injects equal excess Δn = Δp (np > ni^2), 0 is equilibrium.
   * Net rate U > 0 means net recombination, U < 0 net generation.
   */
  function rg(state) {
    const mat = SV.MATERIALS[state.material];
    const T = state.T, kT = k * T;
    const n_i = ni(mat, T), ni2 = n_i * n_i;
    const ND = state.bulkType === 'n' ? state.bulkN : 0;
    const NA = state.bulkType === 'p' ? state.bulkN : 0;
    const { n0, p0 } = carriers(ND, NA, n_i);
    const fr = bandFrame(mat, T);
    const u = state.rgU;
    let n, p, delta, ratio, scale = 1;
    if (u > 0) {
      delta = Math.pow(10, 6 + 12 * u);              // 1e6 .. 1e18 cm^-3
      n = n0 + delta; p = p0 + delta;
      ratio = (n * p) / ni2;
    } else if (u < 0) {
      scale = Math.pow(10, 8 * u);                    // down to 1e-8 of equilibrium
      n = n0 * scale; p = p0 * scale;
      delta = -Math.min(n0, p0) * (1 - scale);
      ratio = scale * scale;
    } else {
      n = n0; p = p0; delta = 0; ratio = 1;
    }
    const excess = u > 0 ? (n0 * delta + p0 * delta + delta * delta) : (ratio - 1) * ni2;  // np - ni^2
    const tau = state.rgTau || mat.tau;
    const tn = tau, tp = tau;
    const ET = state.rgET;                            // E_T - E_i (eV)
    const n1 = n_i * Math.exp(ET / kT), p1 = n_i * Math.exp(-ET / kT);
    const Usrh = excess / (tp * (n + n1) + tn * (p + p1));
    const Urad = mat.B * excess;
    const Uaug = (mat.Cn * n + mat.Cp * p) * excess;
    const U = Usrh + Urad + Uaug;
    const parts = [['srh', Usrh], ['rad', Urad], ['aug', Uaug]];
    const dominant = excess === 0 ? null : parts.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a))[0];
    const minority = n0 < p0 ? 'n' : 'p';
    const majority0 = Math.max(n0, p0);
    const tauEff = u > 0 ? delta / U : null;
    const Gdep = ni2 / (tp * n1 + tn * p1);           // n, p -> 0 (reverse-biased depletion region)
    return {
      mode: 'rg', mat, T, kT, ni: n_i, ND, NA, n0, p0, n, p, delta, ratio, scale, excess, fr,
      muN: mobility(mat.mob.n, ND + NA), muP: mobility(mat.mob.p, ND + NA),
      tau, tn, tp, ET, n1, p1, Usrh, Urad, Uaug, U, dominant, tauEff, Gdep, minority,
      injection: u > 0 ? delta / majority0 : 0,
      Ei: 0, Ec: fr.cMinusI, Ev: -fr.iMinusV,
      EF: kT * Math.log(n0 / n_i),
      FN: kT * Math.log(n / n_i), FP: -kT * Math.log(p / n_i)
    };
  }

  /* J-V curve for the current doping, material and temperature */
  function ivCurve(state, vmin, vmax, n) {
    const dev = device(state);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const V = vmin + (vmax - vmin) * i / n;
      const s = dev.solve(V);
      pts.push({ V, J: s.J, Jideal: dev.J0 * (Math.exp(V / dev.Vt) - 1) });
    }
    return pts;
  }

  /* Slider range: deep reverse bias up to well past V_bi */
  function vaRangePN(state) {
    const mat = SV.MATERIALS[state.material];
    const n_i = ni(mat, state.T);
    const pp0 = carriers(0, state.NA, n_i).p0;
    const nn0 = carriers(state.ND, 0, n_i).n0;
    const Vbi = k * state.T * Math.log(pp0 * nn0 / (n_i * n_i));
    const max = Math.ceil((Vbi + 0.6) * 10) / 10;
    return { min: SV.physics.VA_MIN_PN, max, Vbi };
  }

  return {
    Eg, ni, eiOffset, Nc, Nv, mobility, carriers, bandFrame,
    bulk, junction, device, ivCurve, vaRangePN, depletionWidth, rg,
    VA_MIN_PN: -5,
    VA_RANGE_BULK: { min: -2, max: 2 }
  };
})();
