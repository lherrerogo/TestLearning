# TestLearning

A single-page, dependency-free guide to handling a baby: picking up, holding, soothing, feeding, diapering, safe sleep, bathing and when to call a doctor. It is hosted on Cloudflare as an assets-only Worker, and every push to `main` deploys automatically.

## What's in here

| Path | Purpose |
| --- | --- |
| `public/guide.html` | The guide. Self-contained: no external scripts, fonts or images. |
| `public/404.html` | Served, with a real 404 status, for any URL that doesn't exist. |
| `public/_redirects` | Sends `/` to `/guide`. Not served as a file. |
| `wrangler.jsonc` | Worker config: serves `./public` as static assets. No Worker script. |
| `package.json`, `package-lock.json` | Pin Wrangler to an exact version. |
| `.node-version` | Node 22 (Wrangler 4 requires Node 22 or newer). |

Everything under `public/` is published to the internet. Don't put anything private there.

## How URLs behave

| Request | Result |
| --- | --- |
| `/` | 302 redirect to `/guide` |
| `/guide` | The guide (200) |
| `/guide.html` | Redirects to `/guide` |
| anything else | `public/404.html` with status 404 |

## Run it locally

Requires Node 22 or newer.

```sh
npm ci            # installs the pinned Wrangler
npm run dev       # http://localhost:8787
```

Check the config without deploying anything (no Cloudflare login needed):

```sh
npm run deploy:dry-run
```

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

If a build fails, open the Worker's **Deployments** (or **Builds**) tab and read the build log. The usual causes are a name mismatch (step 3) or a Node version older than 22.

## Updating Wrangler

Wrangler is pinned exactly, so builds don't change unless you change them:

```sh
npm install --save-exact --save-dev wrangler@<version>
npm run deploy:dry-run      # confirm it still validates
git add package.json package-lock.json && git commit
```

## Editing the site

Change the files in `public/`, preview with `npm run dev`, then commit and push to `main`.
