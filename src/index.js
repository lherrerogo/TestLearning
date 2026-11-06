// Worker entry point.
//
// Static files in ./public (the guide, the 404 page) are served by Cloudflare's
// asset layer before this code runs. Only requests that match no asset arrive
// here: `/` (the message form and list) and unknown paths (answered with 404.html).

import { addMessage, listMessages } from './db.js';
import { renderHome } from './page.js';
import { LIMITS, checkTiming, parsePage, validateSubmission } from './validate.js';

const ALLOWED_METHODS = 'GET, HEAD, POST';
const TRAP_MESSAGE = 'That was too quick, or something looked off. Please wait a few seconds and send it again.';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/') return notFound(request, env);

    try {
      if (request.method === 'GET' || request.method === 'HEAD') {
        const page = parsePage(url.searchParams.get('page'));
        return await homePage(env, { page, posted: url.searchParams.get('posted') === '1', partial: wantsPartial(request) });
      }
      if (request.method === 'POST') return await submit(request, url, env);
      return plain(405, 'Method Not Allowed', { Allow: ALLOWED_METHODS });
    } catch (err) {
      if (err instanceof HttpError) return plain(err.status, err.message);
      console.error('request failed', err);
      return serverError();
    }
  },
};

async function homePage(env, { page, posted = false, values, errors, status = 200, partial = false }) {
  const list = await listMessages(env.DB, page, LIMITS.pageSize);
  const nonce = makeNonce();
  const body = renderHome({ nonce, ...list, ts: Date.now(), values, errors, posted, partial });
  return new Response(body, { status, headers: htmlHeaders(nonce) });
}

async function submit(request, url, env) {
  if (!isSameOrigin(request, url)) throw new HttpError(403, 'Forbidden');

  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') throw new HttpError(415, 'Unsupported Media Type');

  const form = new URLSearchParams(await readLimitedText(request, LIMITS.bodyMaxBytes));
  const { ok, values, errors } = validateSubmission({ name: form.get('name'), message: form.get('message') });

  // Bot trap. `website` is hidden from people; `ts` is when the form was
  // rendered. Both failures get the same vague, retryable message, and nothing
  // is stored, so a person whose password manager filled the hidden field
  // loses nothing but a retry.
  const honeypotFilled = (form.get('website') ?? '').trim() !== '';
  const timing = checkTiming(form.get('ts'), Date.now());
  if (honeypotFilled || timing !== 'ok') {
    console.log('bot trap', honeypotFilled ? 'honeypot' : timing);
    return homePage(env, { page: 1, values, errors: { form: TRAP_MESSAGE }, status: 400, partial: wantsPartial(request) });
  }

  if (!ok) return homePage(env, { page: 1, values, errors, status: 422, partial: wantsPartial(request) });

  await addMessage(env.DB, values);
  return new Response(null, { status: 303, headers: { Location: '/?posted=1#messages', 'Cache-Control': 'no-store' } });
}

// The page script sends X-Partial: 1 and gets back only the <main> markup. fetch() keeps
// custom headers when it follows the redirect after a successful post.
function wantsPartial(request) {
  return request.headers.get('X-Partial') === '1';
}

// Cross-site form posts are refused. Browsers send Sec-Fetch-Site (which page
// scripts cannot forge); older clients fall back to the Origin header. A client
// that sends neither (curl, scripts) is allowed: there are no cookies or logins
// to ride on, and the other checks still apply.
// The page sends `Referrer-Policy: same-origin`, not `no-referrer`, because with
// `no-referrer` browsers send `Origin: null` on same-origin form posts.
function isSameOrigin(request, url) {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site !== null) return site === 'same-origin' || site === 'none';
  const origin = request.headers.get('Origin');
  return origin === null || origin === url.origin;
}

async function readLimitedText(request, maxBytes) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, 'Payload Too Large');
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'Payload Too Large');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError(400, 'Bad Request');
  }
}

function makeNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

function htmlHeaders(nonce) {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': [
      "default-src 'none'",
      `style-src 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
      // The page script posts the form with fetch() to this same origin.
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  };
}

// Serve the static 404 page with a real 404 status.
async function notFound(request, env) {
  const asset = await env.ASSETS.fetch(new Request(new URL('/404', request.url)));
  if (!asset.ok) return plain(404, 'Not Found');
  return new Response(asset.body, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  });
}

function plain(status, text, extra = {}) {
  return new Response(text, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}

function serverError() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>Something went wrong</title>' +
      '<p>Something went wrong on our side. Please <a href="/">try again</a>.</p>',
    {
      status: 500,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'",
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}
