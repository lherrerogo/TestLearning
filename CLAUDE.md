# TestLearning: working agreements

Claude Code loads this file automatically. Keep it short and current.

## What this is

- A static baby-handling guide in `public/` (`guide.html`, `404.html`, `_redirects`), served by an assets-only Cloudflare Worker. Config is in `wrangler.jsonc` (Worker name `testlearning`, no script).
- Deploys through Cloudflare Workers Builds, connected to this GitHub repo. The deploy command is the default `npx wrangler deploy`, with no build command. **Every push to `main` deploys to production.**

## Rules

- **Everything lives in code.** Config, redirects, version pins and docs go in this repo. Don't rely on dashboard-only or local-only settings. If a dashboard step is unavoidable, document it in `README.md` and say so.
- **Commit and push finished work to `main` without asking again.** Never force-push or rewrite history that has been pushed.
- **A push is a deploy, so check first.** Run `npm run deploy:dry-run` before pushing. For changes to routing, redirects or the 404 page, also run `npm run dev` and request the affected URLs (`/`, `/guide`, a bogus path).
- **Wrangler is pinned exactly** (`package.json`, currently 4.158.0, needs Node >=22). Upgrade it deliberately and commit `package.json` and `package-lock.json` together.
- **The Worker name in `wrangler.jsonc` must match the Worker name in the Cloudflare dashboard**, or the Git-connected build fails.
- **Don't claim a deploy succeeded unless you saw it.** While the repo is public, the build result is readable without credentials: request `https://api.github.com/repos/lherrerogo/TestLearning/commits/<full-40-char-sha>/check-runs` (a short SHA returns 404) and look for `Workers Builds: testlearning` with `conclusion: success`. It can take a minute to appear after a push. Claude still has no Cloudflare account access, so no build logs and no live URL. Ask for the `workers.dev` URL if production needs testing.

## Content caution

`public/guide.html` gives health and safety guidance (safe sleep, fever thresholds, feeding). It was written from general knowledge and has not been reviewed by a clinician. Don't change numbers, thresholds or safety advice without a source, and say so when you do.
