# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary:** undergraduate students in a semiconductor devices / microelectronics course
  (Pierret, *Semiconductor Device Fundamentals* level), using the site alongside lectures,
  reading and homework. Their job: build an intuition for how doping, temperature and applied
  voltage change the energy bands, and check that intuition against real numbers.
- **Also:** LinkedIn and portfolio visitors who arrive from the creator's profile.

## Product Purpose

Fermi's Sandbox turns the band diagrams from a devices textbook into something you can change
and watch respond. Pick a material, set the doping, form a pn junction, bias it, and see the
bands, Fermi levels, field, depletion region and drift/diffusion currents update. Success is a
student who can predict what the diagram will do before moving the slider, and who can trace
every number on screen back to an equation.

## Positioning

- Every number on the page comes from the full equations (Pierret notation and parameters);
  the animation exaggerates carrier spread and rates only so the behavior is visible, and says so.
- Equations are shown next to the values they produce (for example qV_bi, x_p, x_n, W).
- Not a device simulator: ideal models only (nondegenerate statistics, complete ionization,
  step junction with the depletion approximation, ideal diode equation).

## Operating Context

- Mostly a laptop, next to course notes or a problem set. Phones must work but can be simpler.
- Three structures: single material, pn junction, and R-G (recombination-generation) processes.
- State is kept in the URL hash so a view can be shared or bookmarked.

## Capabilities and Constraints

- Static site: plain HTML, CSS and JavaScript, no build step, published with GitHub Pages
  from `main`. Fonts are bundled locally.
- Materials: Si, Ge, GaAs (and others in `js/materials.js`).
- An npn/pnp transistor tab was built and then removed; it is archived in `archive/npn-pnp/`
  and is not loaded by the page.

## Brand Commitments

- Name: **Fermi's Sandbox**. Tag: "Semiconductor energy bands".
- Dark screen with the band diagram glowing in the middle; steady, low-motion visuals.
- Every slider has a typed number box beside it.
- About section written in the first person by the creator, Alexander Kim Johnson (AJ),
  with a LinkedIn link.
- Voice: plain and direct, like a TA explaining a diagram. No marketing copy.

## Evidence on Hand

- Physics references: R. F. Pierret, *Semiconductor Device Fundamentals*, Ch. 2, 3, 5, 6.
- No testimonials, course adoptions or usage numbers exist. Do not invent them.

## Product Principles

1. The physics is right first. Anything simplified for the animation is labelled as such.
2. Show the equation with the number, so students can check their own work.
3. Calm on screen: motion explains a process and never decorates.
4. Every control can be set exactly, by slider or by typing.

## Accessibility & Inclusion

No formal standard set. Keyboard access, readable contrast on the dark theme, and respecting
reduced-motion preferences are expected.
