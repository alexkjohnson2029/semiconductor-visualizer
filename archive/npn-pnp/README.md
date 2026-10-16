# npn / pnp tab (archived)

An npn/pnp bipolar transistor tab added in commit d5db088 and pulled from the site
because it didn't work well and was too heavy. These are copies of the files as they
were in that commit. Nothing here is loaded by the page.

- `bjt.js`: the transistor band diagram and carrier view
- `physics.js`: `bjt()`, `bjtRange()` and `bjtOutput()` (ideal transistor, Pierret Ch. 10-11)
- `app.js`, `index.html`, `style.css`: the tab's controls, state, readouts and styles

To bring it back, start from that commit:

    git show d5db088 --stat
    git checkout d5db088 -- js/bjt.js js/physics.js js/app.js index.html css/style.css

then re-apply any later changes to those files by hand.
