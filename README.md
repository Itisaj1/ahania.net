# ahania.net

Static personal site. Netlify runs `python3 -m pip install -r requirements.txt && python3 scripts/generate-site-data.py` on each deploy.

## Photos + color wheel

1. Drop images into `portfolio images/` (optional story text in `stories.json`).
2. Push — the build regenerates `manifest.json` and `color-index.json`.
3. Open `/photos/` — dots on the wheel, grid sorted by color match.
4. Locally: `pip install -r requirements.txt && python3 scripts/generate-site-data.py`.
5. Unchanged images are skipped via content hash; broken images fail the build.

## Writing posts

Posts are edited in the browser at [ahania.net/admin/](https://ahania.net/admin/). The editor talks to GitHub directly. Nothing about the sign-in is stored on the server.

### Make a token

1. Open GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token.
2. Limit it to this repository only.
3. Under Repository permissions, set Contents to Read and write. Leave the rest at no access.
4. Set an expiry. A token that never expires is a permanent key to the repo.
5. Generate the token and copy it once. GitHub will not show it again.

### Sign in

Open [ahania.net/admin/](https://ahania.net/admin/) and paste the token. It stays in this browser's local storage and is sent only as the GitHub `Authorization` header. Sign out clears it.

### Draft, publish, unpublish

- **Save draft** writes `blog/_drafts/<slug>.md`. The live post is left alone. The commit message ends with `[skip netlify]`, so Netlify does not rebuild the site.
- **Publish** writes `blog/<slug>.md` and deletes the draft, in one commit. That commit does rebuild the site. The page is live once the build finishes, usually about a minute.
- **Unpublish** moves the current text back to `blog/_drafts/<slug>.md` and deletes the live file. The site rebuilds, and the public page comes down.

A new post starts as a draft. Images uploaded from the editor are stored at `blog/images/<slug>-<yyyymmddhhmmss>.<ext>` and are committed on their own, also with `[skip netlify]`. They go live with the next publish, which is the rebuild that actually runs.
