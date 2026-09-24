# ahania.net

Static personal site. Netlify runs `pip install -r requirements.txt && python3 scripts/generate-site-data.py` on each deploy.

## Photos + color wheel

1. Drop images into `portfolio images/` (optional story text in `stories.json`).
2. Push the branch — the build regenerates `manifest.json` and `color-index.json`.
3. Preview `/color-wheel/` to see dots on the wheel (no manual steps).
4. Locally: `pip install -r requirements.txt && python3 scripts/generate-site-data.py`.
5. Unchanged images are skipped via content hash; broken images fail the build.
