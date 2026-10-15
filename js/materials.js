/*
 * Material parameters at 300 K.
 *
 * Si, Ge and GaAs values (Eg, ni, Ks, density-of-states effective masses)
 * follow the tables in R. F. Pierret, "Semiconductor Device Fundamentals"
 * (Ch. 2 and Appendix). The Si mobility fit is the empirical fit Pierret
 * quotes in Ch. 3:  mu = mu_min + mu_0 / (1 + (N / N_ref)^alpha).
 *
 * InP, GaN and 4H-SiC are not tabulated in Pierret; their values come from
 * common literature sources (Sze & Ng; Levinshtein et al.; Sotoodeh et al.;
 * Roschke & Schwierz) and are marked approximate in the interface.
 *
 * Varshni coefficients (Eg(T) = Eg0 - a T^2 / (T + b)) are only used to
 * shift the band gap away from 300 K; the 300 K value is always pinned to Eg300.
 * tau is an assumed minority-carrier lifetime used for the ideal-diode current.
 *
 * Recombination coefficients (B radiative, Cn/Cp Auger) are typical literature
 * values; Pierret discusses the mechanisms in Ch. 3 but does not tabulate these.
 */
window.SV = window.SV || {};

SV.MATERIALS = {
  Si: {
    key: 'Si', name: 'Silicon', approx: false,
    direct: false, B: 1.1e-14, Cn: 2.8e-31, Cp: 9.9e-32,
    Eg300: 1.12, ni300: 1.0e10, Ks: 11.8,
    mn: 1.18, mp: 0.81,
    varshni: { Eg0: 1.170, a: 4.73e-4, b: 636 },
    mob: {
      n: { min: 92,   mu0: 1268,  Nref: 1.3e17,  alpha: 0.91 },
      p: { min: 54.3, mu0: 406.9, Nref: 2.35e17, alpha: 0.88 }
    },
    tau: 1e-6
  },
  Ge: {
    key: 'Ge', name: 'Germanium', approx: false,
    direct: false, B: 6.4e-14, Cn: 1e-30, Cp: 1e-30,
    Eg300: 0.66, ni300: 2.0e13, Ks: 16.0,
    mn: 0.55, mp: 0.36,
    varshni: { Eg0: 0.7437, a: 4.774e-4, b: 235 },
    mob: {
      n: { min: 850, mu0: 3050, Nref: 2.6e17, alpha: 0.56 },
      p: { min: 300, mu0: 1600, Nref: 1.0e17, alpha: 0.60 }
    },
    tau: 1e-6
  },
  GaAs: {
    key: 'GaAs', name: 'Gallium arsenide', approx: false,
    direct: true, B: 7.2e-10, Cn: 1.8e-31, Cp: 4.2e-30,
    Eg300: 1.42, ni300: 2.25e6, Ks: 12.9,
    mn: 0.066, mp: 0.52,
    varshni: { Eg0: 1.519, a: 5.405e-4, b: 204 },
    mob: {
      n: { min: 500, mu0: 8900,  Nref: 6.0e16,  alpha: 0.394 },
      p: { min: 20,  mu0: 471.5, Nref: 1.48e17, alpha: 0.38 }
    },
    tau: 1e-8
  },
  InP: {
    key: 'InP', name: 'Indium phosphide', approx: true,
    direct: true, B: 1.2e-10, Cn: 9e-31, Cp: 9e-31,
    Eg300: 1.344, ni300: null, Ks: 12.5,
    mn: 0.08, mp: 0.60,
    varshni: { Eg0: 1.421, a: 4.9e-4, b: 327 },
    mob: {
      n: { min: 400, mu0: 4800, Nref: 3.0e17,  alpha: 0.47 },
      p: { min: 10,  mu0: 160,  Nref: 4.87e17, alpha: 0.62 }
    },
    tau: 1e-8
  },
  GaN: {
    key: 'GaN', name: 'Gallium nitride', approx: true,
    direct: true, B: 1.1e-8, Cn: 1e-31, Cp: 1e-31,
    Eg300: 3.39, ni300: null, Ks: 8.9,
    mn: 0.20, mp: 1.0,
    varshni: { Eg0: 3.47, a: 7.7e-4, b: 600 },
    mob: {
      n: { min: 55, mu0: 945, Nref: 2.0e17, alpha: 1.0 },
      p: { min: 5,  mu0: 25,  Nref: 3.0e17, alpha: 0.8 }
    },
    tau: 1e-9
  },
  SiC: {
    key: 'SiC', label: '4H‑SiC', name: '4H silicon carbide', approx: true,
    direct: false, B: 1.5e-12, Cn: 5e-31, Cp: 2e-31,
    Eg300: 3.26, ni300: null, Ks: 9.7,
    mn: 0.77, mp: 1.0,
    varshni: { Eg0: 3.265, a: 6.5e-4, b: 1300 },
    mob: {
      n: { min: 40, mu0: 910, Nref: 1.94e17, alpha: 0.61 },
      p: { min: 16, mu0: 109, Nref: 1.76e19, alpha: 0.34 }
    },
    tau: 1e-7
  }
};

SV.MATERIAL_ORDER = ['Si', 'Ge', 'GaAs', 'InP', 'GaN', 'SiC'];

/* Fill in ni at 300 K for materials Pierret does not tabulate:
 * ni = sqrt(Nc Nv) exp(-Eg / 2kT), with Nc,v = 2.509e19 (m_eff / m0)^1.5 cm^-3 at 300 K. */
(function () {
  const kT = 8.617333e-5 * 300;
  for (const key of SV.MATERIAL_ORDER) {
    const m = SV.MATERIALS[key];
    m.Nc300 = 2.509e19 * Math.pow(m.mn, 1.5);
    m.Nv300 = 2.509e19 * Math.pow(m.mp, 1.5);
    if (m.ni300 == null) {
      m.ni300 = Math.sqrt(m.Nc300 * m.Nv300) * Math.exp(-m.Eg300 / (2 * kT));
    }
    if (!m.label) m.label = m.key;
  }
})();
