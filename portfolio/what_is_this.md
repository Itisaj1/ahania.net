---
title: what is this?
---

*if you clicked "what is this?" on the photos page, this is the long answer. its a write-up of how the color wheel gallery works, why i built it the way i did, and a few roads i didn't take.*

the photography page on this site is not a normal gallery. instead of scrubbing through a filmstrip, you drag a puck around a color wheel and the photos rearrange themselves toward whatever you picked. warm vs cool, muted vs loud — browsing by *feel*, without me having to tag every image by hand. if you've ever used a color wheel in something like davinci resolve, the control should feel a little familiar. i wanted that same instinct applied to my own photos.

a few constraints sat behind all of this. the wheel had to work with a mouse, with a finger, and with a keyboard. sorting needed to feel alive while you drag without melting a phone. the color math needed to track how colors *look*, not just how rgb channels average out. and crucially, i was not about to decode and cluster every photo in the visitor's browser on page load — this site is still a static netlify deploy off a github repo, same as when i started it. no app server, no "just spin up a worker."

## how it actually works

there are three layers, and they all speak the same json shape.

### indexing at build time

every time the site deploys, a python script (`scripts/build-color-index.py`) walks the `portfolio images/` folder. for each photo it hashes the file (sha-256, truncated), opens it with pillow, converts to rgba, and downsamples so the long edge is about 64px. near-transparent pixels get ignored. whatever's left gets converted into oklab, then a small deterministic k-means (k=5) runs in that space. out the other side comes a weighted 5-color palette plus a dominant color, written into `portfolio images/color-index.json`.

an entry looks like this:

```json
{
  "id": "Volcan Chillan.JPG",
  "src": "portfolio%20images/Volcan Chillan.JPG",
  "hash": "…",
  "dominant": { "hex": "#…", "oklch": [L, C, h] },
  "palette": [
    { "hex": "#…", "oklch": [L, C, h], "weight": 0.45 }
  ]
}
```

the palette weights sum to 1. the committed json is treated as a cache: if the hash hasn't changed, that photo is skipped; if its new or edited, it gets reprocessed; if a file is gone, its entry disappears. netlify installs pillow from `requirements.txt` and runs this as part of `generate-site-data.py`, so adding a photo and pushing is enough. no separate indexing ritual.

### the wheel itself

`color-wheel.js` and `color-wheel.css` draw the wheel with css — not a canvas library, not webgl. the thin outer ring is a full-hue `conic-gradient` masked into a rim. the interior stays mostly white with a faint hue wash toward the edge, because a neon pie chart would have looked ridiculous on this site. crosshairs meet the inner edge of the ring. each photo shows up as a semi-transparent dot at its *dominant* oklch position: angle is hue, distance from center is chroma. the puck starts in the middle; when you grab it, it grows and fills with the selected color. that puck *is* the swatch — there's no separate color chip.

pointer events drive the puck. angle and distance from center become hue and chroma. the usable radius stops inside the hue ring so you can't drag into the rim chrome. arrow keys nudge hue and chroma; home resets to neutral. the wheel exposes aria slider semantics and fires a `colorwheel:change` event with `{ hue, chroma }`. lightness for the swatch is fixed at L=0.7 — i deliberately left a lightness slider out.

### scoring and the grid

`photos.js` listens to that selection and scores every photo:

score = sum over palette colors of (weight × proximity to the selection)

proximity falls off as a gaussian over distance in the oklab *a/b* plane. lightness is ignored on purpose, so the only axes that matter are the ones on the wheel. when the puck sits near the center (near-zero chroma), distance is measured from the origin in a/b space, which naturally floats muted / low-chroma images to the top instead of reshuffling the grid at random.

the grid does not thrash on every `pointermove`. hex and hsl update immediately; reordering waits ~380ms after you stop moving, then animates with a flip transition (~0.55s). if you've got `prefers-reduced-motion` on, the animation is skipped.

click a tile and you get a detail view: the full image, the story text from `stories.json` (keyed by the exact filename), escape or return to close. focus stays trapped while it's open and goes back where it was when you leave. the grid images lazy-load.

## why this way

oklab / oklch instead of rgb or hsl, because rgb clusters by channel values, not by how colors look. hsl is fine for a lot of ui pickers, but it still warps perceptual distance — especially around blues and highly saturated colors. oklab was designed so euclidean distance tracks perceived difference more closely, which matters when you're asking "how close is this photo to the color i just picked."

indexing at build time instead of on page load, because decoding and clustering even a downsampled photo is fine *once per deploy*. doing it for every image in every visitor's tab would mean jank, battery drain, and a hard dependency on whatever cpu they happen to have. a static json file also means the wheel can paint its dots after one fetch.

the content-hash cache exists because netlify build environments don't keep disk between deploys, but the repo does. committing `color-index.json` means most builds only touch new or edited files. deploys stay fast, and the index is still correct when something changes.

vanilla js and css, because the rest of ahania.net is plain html. pulling in react, a charting library, or a color-science package would have been heavier than the problem. css conic gradients were enough for the wheel chrome; a few dozen lines of oklab math were enough for scoring.

debounced flip instead of continuous resorting, because animating ~35 dom nodes on every pointer event feels noisy and fights the drag. keep the swatch live, let the grid catch up a beat later — responsive without being frantic.

fixed lightness, because a third axis (a ribbed lightness slider like resolve) would have edged this closer to a full color grader, and also complicated the layout and the mental model. for browsing photos, hue and chroma already carry most of the "warm / cool / vivid / muted" intent.

## other routes i could've taken

client-side palette extraction (color thief, canvas sampling, etc.) was the obvious alternative. i didn't go that way — cold start cost, inconsistent mobile performance, and a harder time keeping results deterministic across browsers.

hsv / hsl distance would have been simpler to implement. worse perceptual behavior. once oklab was on the table, there wasn't much reason to stay there.

a serverless function per request could have avoided committing the index. it also would have added cold starts, a backend surface, and complexity this static site does not need.

canvas or webgl for the wheel would have been more flexible for exotic rendering. overkill when css gradients already hit the look i wanted, and harder to keep accessible — the current wheel is a real focusable slider, which matters.

continuous `requestAnimationFrame` sorting while dragging sounds snappier on paper. in practice the grid animation turned into noise. debounce + flip was the better trade.

manual tags or folders ("blues", "portraits") would have meant zero math and total editorial burden, with no smooth "in between" on the wheel. a third-party gallery or cms would have shipped a conventional grid faster, and never gotten a custom color-space filter wired into the deploy pipeline i already had.

## how i built it

i started with the wheel alone — a tiny standalone preview page, sample dots in the shared json shape, no real photos yet. that made it possible to iterate on ring thickness, the interior wash, puck behavior, and touch dragging without fighting the old filmstrip gallery.

next came the indexer. i wrote the oklab conversions from björn ottosson's published matrices, downsampled with pillow, and made k-means deterministic (centroids seeded from evenly spaced sorted pixels, stable sort on weight). then i hooked the script into the existing netlify build and checked that a second run reported everything cached.

with a real `color-index.json` in place, i ripped out the old slide-panel gallery. the homepage image and the photos nav link both go to `/photos/` now. layout settled on the wheel and readout on the left, four-column grid on the right. stories already lived in `stories.json`; the detail view just reads them by filename.

finally i sanded the interaction: grow-the-puck-on-grab as the swatch, delayed reorder, slower flip, edge-to-edge layout, and the "what is this?" link that brought you here.

the end result is still a static site. the interesting part isn't a framework — its pushing the expensive color work into deploy time and leaving the browser responsible for geometry, scoring, and motion.
