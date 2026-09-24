# ahania.net

Static personal site. Netlify runs `python3 -m pip install -r requirements.txt && python3 scripts/generate-site-data.py` on each deploy.

## Photos + color wheel

1. Drop images into `portfolio images/` (optional story text in `stories.json`).
2. Push — the build regenerates `manifest.json` and `color-index.json`.
3. Open `/photos/` — dots on the wheel, grid sorted by color match.
4. Locally: `pip install -r requirements.txt && python3 scripts/generate-site-data.py`.
5. Unchanged images are skipped via content hash; broken images fail the build.

Pantone labels on `/photos/` are approximate matches against
[Margaret2/pantone-colors](https://github.com/Margaret2/pantone-colors)
(2310 fashion color hexes). Upstream lists no SPDX license; Pantone® is a
trademark of Pantone LLC.
