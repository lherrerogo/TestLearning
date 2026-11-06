# TestLearning

Two things on one Cloudflare Worker:

- **A message board for the baby** at `/`. Visitors enter a name and a kind message; every message is shown below the form, newest first, 20 per page. A live character counter sits under the message box, and a new message appears at the top of the list, with a friendly thank-you, without reloading the page. Messages are stored in Cloudflare D1.
- **A practical baby care guide** at `/guide`: a single self-contained page covering picking up, holding, soothing, feeding, diapering, safe sleep, bathing and when to call a doctor.

Every push to `main` deploys automatically through Cloudflare Workers Builds.

## What's in here

| Path | Purpose |
| --- | --- |
| `src/index.js` | The Worker: routing, request checks, bot trap, security headers. |
| `src/validate.js` | Length limits, input cleaning, the timing check. |
| `src/html.js` | Auto-escaping HTML template. All user content goes through it. |
| `src/page.js` | The message page (form, messages, pagination, its own CSS and JS). |
| `src/db.js` | D1 schema and queries. |
| `public/guide.html` | The guide. Self-contained: no external scripts, fonts or images. |
| `public/404.html` | Served, with a real 404 status, for any URL that doesn't exist. |
| `docs/how-we-built-this.pdf` | A plain-words explanation of how this was built and how to build something similar. Not published on the site. |
| `test/unit/` | Fast unit tests (escaping, cleaning, limits, page markup, hidden-character check). |
| `test/e2e/` | End-to-end tests against the real Worker on a local D1: over HTTP, and in a real Chrome. |
| `wrangler.jsonc` | Worker config: entry point, static assets from `./public`, the D1 binding. |
| `package.json`, `package-lock.json` | Pin Wrangler to an exact version. |
| `.node-version` | Node 22 (Wrangler 4 requires Node 22 or newer). |

Everything under `public/` is published to the internet. Don't put anything private there.

## How URLs behave

| Request | Result |
| --- | --- |
| `GET /` | Message form and messages (`?page=2` for older ones) |
| `POST /` | Add a message; redirects to `/?posted=1#messages` |
| `/guide` | The guide (`/guide.html` redirects here) |
| anything else | `public/404.html` with status 404 |

Static files in `public/` are served by Cloudflare directly. Only requests that match no file run the Worker, so the guide costs no Worker invocations.

## How messages are kept safe

- **Length limits.** Name up to 40 characters, message up to 500, counted as Unicode characters (an emoji is one). Enforced in the browser (`maxlength`), again on the server after cleaning, and loosely in the database (`CHECK`). The request body is capped at 16 KiB, declared or streamed.
- **Input cleaning.** Control characters, zero-width spaces and bidirectional-override characters are removed. Whitespace is tidied. Messages keep their line breaks.
- **No HTML injection.** Messages are stored as typed and escaped when the page is built, using a template (`src/html.js`) that escapes every interpolated value by default. Messages are shown as plain text and are never turned into links or markup. A Content-Security-Policy adds a second layer: only the page's own inline style and scripts, tagged with a fresh nonce per response, may run, and the page may only talk to its own origin (`connect-src 'self'`).
- **No SQL injection.** All queries use bound parameters.
- **Bot trap.** The form has a hidden `website` field that people never see and bots tend to fill, and a timestamp of when the page was rendered. A post is rejected if the hidden field is filled, or if the form was submitted less than 3 seconds after it was rendered, or if the timestamp is missing or invalid. Nothing is stored and the person's text is kept, so a false alarm costs one retry.
- **Cross-site posts are refused** (`Sec-Fetch-Site` / `Origin` checks).
- **Double submits** (the same name and message within a minute) are stored once.

This is deliberately simple. It stops casual bots and mistakes, not a determined attacker. There is no rate limiting per visitor and no login. If spam becomes a problem, add a Cloudflare rate-limiting rule or Turnstile.

## How the page behaves in the browser

The form is an ordinary HTML form that works with no JavaScript: it posts, redirects, and shows the list with a thank-you banner. When JavaScript is available, a small script upgrades it:

- **Live counter.** `N / 500` under the message box, counted in characters (an emoji is one). It turns darker near the limit and red over it. With the script active the browser's own `maxlength` is removed from the message box, because it counts UTF-16 units and would cut emoji messages short; an over-long message is stopped with an error before anything is sent.
- **Posting without a reload.** The script sends the same form post with `fetch`, then swaps in the server-rendered message list, so the new message is on top and the count and page links are right. It adds a thank-you naming the sender, clears the message box (the name is kept), highlights the new message and scrolls it into view. If you were on page 2 it shows page 1, where the new message lives.
- **Local times.** Every message shows its date and time in the visitor's own timezone and language (a message posted at 14:05 UTC reads "6 Nov 2026, 14:05" in the UK, "06.11.2026, 15:05" in Germany, "Nov 6, 2026, 6:05 AM" on the US west coast and "2026/11/06 23:05" in Japan). The server can't know either, so the browser formats each `<time datetime="...">` itself, including messages that arrive without a reload. Hovering a time (or long-pressing on a phone) shows the long form with the timezone name. Without JavaScript the server's text is shown instead, always labelled UTC: "6 Nov 2026, 14:05 UTC".
- **Errors in place.** Validation errors and the bot-trap message appear next to the form, with your text kept.
- **How it stays safe.** The script sends `X-Partial: 1` and the server answers with only the `<main>` markup, so no second copy of the page's inline style or script has to be parsed (the browser's CSP rejects that). Message text only reaches the page as server-rendered, escaped nodes or through `textContent`; a unit test fails if the script ever uses `innerHTML` or similar.

## The database

Messages live in a D1 database named `testlearning-messages`, bound to the Worker as `DB`.

- **It is created for you.** `wrangler.jsonc` has a `database_name` but no `database_id` on purpose. The first `wrangler deploy` creates the database; later deploys reuse the one bound to the Worker.
- **The table is created in code.** `src/db.js` runs `CREATE TABLE IF NOT EXISTS` the first time it is needed. There is no migration step to run, because the Git-connected build only runs `wrangler deploy`. If you ever change the table, add an idempotent statement to `src/db.js`; `IF NOT EXISTS` will not alter an existing table.
- **Optional:** after the first deploy you can copy the database's ID from the dashboard (Storage & Databases → D1) into `wrangler.jsonc` as `database_id` to pin it. It is not required.

### Removing a message

There is no admin page. To delete a message, use the D1 console in the Cloudflare dashboard, or from this folder after `npx wrangler login`:

```sh
npx wrangler d1 execute testlearning-messages --remote --command "SELECT id, name, message FROM messages ORDER BY id DESC LIMIT 20"
npx wrangler d1 execute testlearning-messages --remote --command "DELETE FROM messages WHERE id = 12"
```

## Run it locally

Requires Node 22 or newer. Local runs use a local D1 database in `.wrangler/state` (git-ignored); delete that folder to start fresh. Nothing touches your Cloudflare account.

```sh
npm ci            # installs the pinned Wrangler
npm run dev       # http://localhost:8787
```

## Tests and checks

```sh
npm test                 # unit tests (fast)
npm run test:e2e         # starts the real Worker locally; drives it over HTTP and in real Chrome
npm run deploy:dry-run   # bundles the Worker and validates the config, no login needed
```

The browser tests (`test/e2e/browser.test.mjs`) need a local Chrome or Chromium and are skipped with a message if none is found; set `CHROME_PATH` to point at one. Run all three commands before pushing, because a push to `main` is a live deploy. A source-hygiene test fails if invisible or bidirectional-override characters end up in the code; write them as `\uXXXX` escapes.

## Connect the repo to Cloudflare (deploy on every push)

This uses Cloudflare Workers Builds. The repo is `lherrerogo/TestLearning`. Menu labels in the dashboard change from time to time, so follow the intent if a name differs slightly.

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), go to **Workers & Pages** → **Create application** → **Import a repository**.
2. Authorize the Cloudflare GitHub app and give it access to `lherrerogo/TestLearning`.
3. Set the project name to **`testlearning`**. It must match `name` in `wrangler.jsonc`, otherwise the build fails with a name mismatch.
4. Set the production branch to **`main`**.
5. Build settings:
   - **Build command**: leave empty. There is nothing to build.
   - **Deploy command**: `npx wrangler deploy` (the default).
   - **Root directory**: `/` (the default).
6. Save and deploy.

From then on, each push to `main` runs `npx wrangler deploy`. Cloudflare installs dependencies from `package-lock.json`, so the pinned Wrangler version is the one that runs. The site goes live at `https://testlearning.<your-account-subdomain>.workers.dev`. Add your own domain under the Worker's **Settings** → **Domains & Routes**.

If the Worker `testlearning` already exists in your account, connect the repo from its **Settings** → **Builds** instead.

Optional: enable builds for non-production branches. They run `npx wrangler versions upload`, which creates a preview URL without touching production.

### If the build fails after adding the database

The first deploy of this version asks Cloudflare to create the D1 database, which needs permission on the build's API token. If the build log says it is "skipping automatic provisioning" because of permissions, or the deploy fails on the `DB` binding, either give the build token permission to edit D1 databases (Worker → **Settings** → **Builds**), or create the database once yourself and pin it:

```sh
npx wrangler login
npx wrangler d1 create testlearning-messages   # prints a database_id
```

Then add `"database_id": "<that id>"` next to `database_name` in `wrangler.jsonc` and push. A failed build leaves the previous version running.

Other common causes of a failed build: a name mismatch (step 3) or a Node version older than 22.

## Updating Wrangler

Wrangler is pinned exactly, so builds don't change unless you change them:

```sh
npm install --save-exact --save-dev wrangler@<version>
npm run test:all && npm run deploy:dry-run   # confirm it still works
git add package.json package-lock.json && git commit
```

## Editing the site

Change the files in `src/` or `public/`, preview with `npm run dev`, run the checks above, then commit and push to `main`.
