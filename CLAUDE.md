# TestLearning: working agreements

Claude Code loads this file automatically. Keep it short and current.

## What this is

- A Cloudflare Worker (`src/`) with static assets (`public/`) and a D1 database.
  - `/` is a public message board: visitors enter a name and a message, and all messages are listed newest first.
  - `/guide` is a static baby-care guide (`public/guide.html`). `public/404.html` is the 404 page.
- Config is in `wrangler.jsonc` (Worker name `testlearning`, D1 binding `DB`, assets binding `ASSETS`).
- Deploys through Cloudflare Workers Builds, connected to this GitHub repo. The deploy command is the default `npx wrangler deploy`, with no build command. **Every push to `main` deploys to production.**

## Rules

- **Everything lives in code.** Config, schema, version pins and docs go in this repo. Don't rely on dashboard-only or local-only settings. If a dashboard step is unavoidable, document it in `README.md` and say so.
- **Commit and push finished work to `main` without asking again.** Never force-push or rewrite history that has been pushed.
- **A push is a deploy, so check first.** Before pushing run `npm test`, `npm run test:e2e` and `npm run deploy:dry-run`. For UI changes, also look at the page in a real browser at phone width, in light and dark.
- **Wrangler is pinned exactly** (`package.json`, currently 4.158.0, needs Node >=22). Upgrade it deliberately and commit `package.json` and `package-lock.json` together.
- **The Worker name in `wrangler.jsonc` must match the Worker name in the Cloudflare dashboard**, or the Git-connected build fails.
- **Don't claim a deploy succeeded unless you saw it.** While the repo is public, the build result is readable without credentials: request `https://api.github.com/repos/lherrerogo/TestLearning/commits/<full-40-char-sha>/check-runs` (a short SHA returns 404) and look for `Workers Builds: testlearning` with `conclusion: success`. It can take a minute or two to appear after a push. A green build does not prove the live site works. Claude has no Cloudflare account access, so no build logs and no live URL: ask for the `workers.dev` URL if production needs testing.

## Safety rules for the message board

These protect a public page that anyone can write to. Don't weaken them without saying so.

- **User text is never put into HTML except through the `html` template in `src/html.js`**, which escapes every interpolated value. `raw()` is only for the page's own static CSS and JS. Never pass request-derived data to it.
- **Keep the CSP strict** (`htmlHeaders` in `src/index.js`): nonce-only inline style and script, no `unsafe-inline`, no inline `style=""` attributes or `on...=` handlers in `src/page.js`.
- **Keep `Referrer-Policy: same-origin`.** With `no-referrer`, browsers send `Origin: null` on same-origin form posts and the cross-site check would reject real visitors.
- **Limits live in `src/validate.js`** (name 40, message 500, body 16 KiB). The `CHECK` constraints in `src/db.js` are a looser backstop. All SQL uses bound parameters.
- **The bot trap** is a hidden `website` field plus a render timestamp with a 3 second minimum. A tripped trap must store nothing and keep the person's text.
- **`not_found_handling` must stay `"none"`.** With `"404-page"` Cloudflare answers unknown paths itself and the Worker never sees `/`. Do not add a `public/_redirects` rule for `/`, and do not add `public/index.html`: either would shadow the Worker.
- **The schema is created in code** (`src/db.js`, `CREATE TABLE IF NOT EXISTS`) because the default deploy command never runs migrations. To change an existing table, add an idempotent step there. There is intentionally no `database_id` in `wrangler.jsonc`: the first deploy creates `testlearning-messages` and later deploys reuse it. If the build token lacks D1 permission, see the README section on failed builds.
- **No invisible or bidi-override characters in source.** Write them as `\uXXXX` escapes. Claude's file-writing tool has been seen turning some such escapes (U+200B, U+202E, U+2028, U+2029, U+FEFF) into literal characters, which broke a regex. `npm test` includes a hygiene test that catches this; run it after writing any file that contains such escapes.

## Content caution

`public/guide.html` gives health and safety guidance (safe sleep, fever thresholds, feeding). It was written from general knowledge and has not been reviewed by a clinician. Don't change numbers, thresholds or safety advice without a source, and say so when you do.

Messages on the board are public and unmoderated. There is no admin page; the README explains how to delete a message.
