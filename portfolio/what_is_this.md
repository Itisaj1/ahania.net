---
title: what is this?
---

the photography page on this site is not a normal gallery. instead of scrolling a filmstrip, you pick a color on a wheel and the photos reorder themselves toward whatever you selected. this write-up covers how that works, why it was built this way, and what else could have been done.

## the problem

i wanted a way to browse photos by *feel* — warm vs cool, muted vs saturated — without tagging every image by hand. a color wheel is a familiar control (especially if you have ever graded footage), and mapping photos onto it gives you both a map and a filter in one place.

the requirements that shaped the design:

- the wheel has to work with mouse and touch, and stay usable from the keyboard
- sorting has to feel live while you drag, without melting a phone
- color math should match human perception better than raw RGB
- indexing hundreds of pixels per photo cannot happen in the visitor's browser on every page load
- the rest of the site stays a static Netlify deploy — no app server

## technical approach

the system is three layers that share one data contract.

### 1. build-time color index

on every deploy, a Python script (`scripts/build-color-index.py`) walks `portfolio images/`. for each photo it:

1. hashes the file contents (sha-256 prefix) so unchanged images can be skipped
2. opens the image with Pillow, converts to RGBA, and downsamples so the long edge is about 64px
3. ignores near-transparent pixels
4. converts remaining pixels into OKLab
5. runs a small, deterministic k-means (k=5) in OKLab
6. writes a weighted 5-color palette plus a dominant color into `portfolio images/color-index.json`

each entry looks like:

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

weights sum to 1. the committed JSON is treated as a cache: same hash → reuse the old entry; new or changed files get reprocessed; deleted files disappear from the index. Netlify installs Pillow from `requirements.txt` and runs this as part of `generate-site-data.py`, so adding a photo and pushing is enough — no manual indexing step.

### 2. the color wheel (frontend)

`color-wheel.js` / `color-wheel.css` draw a Resolve-inspired wheel with CSS, not a canvas library:

- a thin outer ring is a full-hue `conic-gradient`, masked into a rim
- the interior is mostly white with a faint hue wash toward the edge, so the control does not look like a neon pie chart
- crosshairs meet the inner edge of the ring
- photos are plotted as semi-transparent dots at their *dominant* OKLCH position (angle = hue, radius = chroma)
- a draggable puck starts at center; while you grab it, it grows and fills with the selected color (that puck *is* the swatch)

pointer events drive the puck. angle and distance from center become hue and chroma. the usable radius stops inside the hue ring so you cannot drag into the rim chrome. arrow keys nudge hue/chroma; Home resets to neutral. the wheel exposes ARIA slider semantics and emits a `colorwheel:change` event with `{ hue, chroma }` (lightness is fixed at L=0.7 for the swatch — there is no lightness slider).

### 3. live sorting + detail view

`photos.js` listens to that selection and scores every photo:

> score = Σ (palette_weight × proximity(selected, palette_color))

proximity falls off as a Gaussian over distance in the OKLab *a/b* plane — lightness is intentionally ignored so the wheel's two axes (hue, chroma) stay the only controls. when the puck sits near the center (near-zero chroma), distance is measured from the origin in a/b space, which naturally ranks muted / low-chroma images first instead of shuffling the grid at random.

the grid does not thrash on every pointermove. the HEX/HSL readout updates immediately; reordering is debounced (~380ms after the last move) and animated with a FLIP transition (~0.55s), skipped under `prefers-reduced-motion`.

clicking a tile opens a detail view: full image, story text from `stories.json` (keyed by exact filename), Escape or Return to close, focus trapped while open and restored afterward. grid images lazy-load.

## why this approach

**OKLab / OKLCH instead of RGB or HSL.** RGB clusters by channel values, not by how colors look. HSL is a bit better for UI pickers but still warps perceptual distance (especially around blues and highly saturated colors). OKLab was designed so Euclidean distance tracks perceived difference more closely, which matters when you are scoring "how close is this photo to the color i picked."

**Index at build time, not on page load.** decoding and clustering even a downsampled photo is fine once per deploy; doing it for ~35 images in every visitor's tab would add jank, battery cost, and a hard dependency on client CPU. a static JSON file also means the wheel can paint dots immediately after one fetch.

**Content-hash cache.** Netlify build environments do not keep disk between deploys, but the repo *does*. committing `color-index.json` means most builds only re-touch new or edited files, which keeps deploys fast while still guaranteeing a correct index when something changes.

**Vanilla JS + CSS on a static site.** the rest of ahania.net is plain HTML. pulling in React, a canvas charting library, or a color-science package would have been heavier than the problem. CSS conic gradients are enough for the wheel chrome; a few dozen lines of OKLab math are enough for scoring.

**Debounced FLIP instead of continuous resort.** resorting and animating 35 DOM nodes on every pointer event feels busy and fights the drag. updating the swatch live while delaying the grid keeps the interaction responsive and the motion readable.

**Fixed lightness.** a third axis (a lightness slider) would have made the control closer to a full color grader, but it also complicates the mental model and the layout. for browsing photos, hue + chroma carry most of the "warm/cool/vivid/muted" intent.

## alternatives i considered

**Client-side palette extraction.** libraries like Color Thief or custom canvas sampling could run in the browser. rejected for cold-start cost and inconsistent mobile performance. also harder to keep deterministic across browsers.

**HSV / HSL distance.** simpler to implement, worse perceptual behavior. rejected once OKLab was on the table.

**Serverless function per request.** would avoid committing the index, but adds cold starts, a backend surface, and complexity this static site does not need.

**Canvas or WebGL wheel.** more flexible for exotic rendering; overkill when CSS gradients already match the visual target, and harder to keep accessible (the current wheel is a real focusable slider).

**Continuous rAF sorting while dragging.** snappier in theory; in practice the grid animation becomes noise. debounce + FLIP was the better trade.

**Manual tags / folders ("blues", "portraits").** zero math, total editorial burden, and no smooth "in between" selection on the wheel.

**Third-party gallery / CMS.** faster to ship a conventional grid; would not get a custom color-space filter wired into the existing deploy pipeline.

## how it was built

i started with the wheel alone: a small standalone preview page, sample dots in the shared JSON shape, and no real photos. that made it possible to iterate on ring thickness, interior wash, puck behavior, and touch dragging without fighting the old filmstrip gallery.

next came the indexer. i wrote the OKLab conversions from Björn Ottosson's published matrices, downsampled with Pillow, and tuned k-means to be deterministic (centroids seeded from evenly spaced sorted pixels, stable sort on weight). then i hooked the script into the existing Netlify build command and verified that a second run reported everything cached.

with real `color-index.json` in place, i replaced the old slide-panel gallery. homepage and portfolio links now go to `/photos/`. the page layout settled on wheel + readout on the left and a four-column grid on the right. stories already lived in `stories.json`; the detail view just reads them by filename.

finally i sanded the interaction: grow-the-puck-on-grab as the swatch, delayed reorder, slower FLIP, edge-to-edge layout, and a "What is this?" link to this page for anyone who wants the nerdy version.

the end result is still a static site. the clever part is not a framework — it is pushing the expensive color work into deploy time and keeping the browser responsible only for geometry, scoring, and motion.
