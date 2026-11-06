// End-to-end tests against the real Worker, run by `wrangler dev` with a fresh
// local D1 database in a temp directory. Nothing touches Cloudflare.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startServer } from './support.mjs';

let server;
let BASE;

before(async () => {
  server = await startServer();
  BASE = server.base;
});

after(async () => {
  await server?.stop();
});

// ---- helpers ---------------------------------------------------------------

const tag = () => Math.random().toString(36).slice(2, 10);
const longAgo = () => String(Date.now() - 10_000);

async function home(query = '') {
  const res = await fetch(`${BASE}/${query}`);
  return { res, text: await res.text() };
}

function form(fields) {
  return new URLSearchParams({ website: '', ts: longAgo(), ...fields }).toString();
}

async function post(fields, { headers = {}, body, contentType = 'application/x-www-form-urlencoded' } = {}) {
  return fetch(`${BASE}/`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': contentType, ...headers },
    body: body ?? form(fields),
  });
}

const entries = (text) => (text.match(/<article class="entry">/g) ?? []).length;
const total = (text) => Number(/Messages \((\d+)\)/.exec(text)[1]);

// ---- routing ---------------------------------------------------------------

describe('routing', () => {
  it('serves the message page at / with a strict CSP and no caching', async () => {
    const { res, text } = await home();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'same-origin');
    const csp = res.headers.get('content-security-policy');
    const nonce = /nonce-([A-Za-z0-9+/=]+)/.exec(csp)[1];
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /form-action 'self'/);
    assert.match(csp, /connect-src 'self'(;|$)/);
    assert.ok(!csp.includes('unsafe-inline'));
    for (const t of [...text.matchAll(/<(script|style)\b[^>]*>/g)]) assert.ok(t[0].includes(`nonce="${nonce}"`), t[0]);
    assert.ok(text.includes('name="website"') && text.includes('name="ts"'));
  });

  it('uses a different CSP nonce on every response', async () => {
    const a = (await home()).res.headers.get('content-security-policy');
    const b = (await home()).res.headers.get('content-security-policy');
    assert.notEqual(a, b);
  });

  it('keeps the guide at /guide, and /guide.html redirects there', async () => {
    const res = await fetch(`${BASE}/guide`);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes('Handling a baby, calmly and safely'));
    const old = await fetch(`${BASE}/guide.html`, { redirect: 'manual' });
    assert.ok([301, 302, 307, 308].includes(old.status));
    assert.equal(new URL(old.headers.get('location'), BASE).pathname, '/guide');
  });

  it('answers unknown paths with the custom 404 page and a real 404 status', async () => {
    for (const path of ['/nope', '/a/b/c', '/api/messages', '/index.html', '/%00']) {
      const res = await fetch(`${BASE}${path}`);
      assert.equal(res.status, 404, path);
      assert.ok((await res.text()).includes('We couldn’t find that page'), path);
    }
  });

  it('supports HEAD and rejects other methods with 405 and an Allow header', async () => {
    const head = await fetch(`${BASE}/`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(`${BASE}/`, { method });
      assert.equal(res.status, 405, method);
      assert.equal(res.headers.get('allow'), 'GET, HEAD, POST');
    }
  });
});

// ---- posting and reading ---------------------------------------------------

describe('posting messages', () => {
  it('stores a valid message, redirects with 303, and shows it with a thank-you', async () => {
    const t = tag();
    const res = await post({ name: `Ada ${t}`, message: `Welcome little one ${t}` });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/?posted=1#messages');
    const { text } = await home('?posted=1');
    assert.ok(text.includes(`Ada ${t}`));
    assert.ok(text.includes(`Welcome little one ${t}`));
    assert.ok(text.includes('<p class="banner ok">Thank you!'));
    assert.ok(!(await home()).text.includes('class="banner ok"'));
  });

  it('shows each message with date and time, labelled UTC, in a <time> element', async () => {
    const t = tag();
    const before = Date.now();
    await post({ name: 'Timey', message: `time-${t}` });
    const { text } = await home();
    const entry = text.split('<article class="entry">').find((chunk) => chunk.includes(`time-${t}`));
    const m = /<time datetime="([^"]+)">(\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC)<\/time>/.exec(entry);
    assert.ok(m, 'expected a <time> with date, time and UTC label');
    const posted = Date.parse(m[1]);
    assert.ok(posted >= before - 1000 && posted <= Date.now() + 1000, 'the datetime should be when it was posted');
  });

  it('lists the newest message first', async () => {
    const t = tag();
    await post({ name: 'First', message: `first-${t}` });
    await post({ name: 'Second', message: `second-${t}` });
    await post({ name: 'Third', message: `third-${t}` });
    const { text } = await home();
    const at = (s) => text.indexOf(s);
    assert.ok(at(`third-${t}`) !== -1 && at(`third-${t}`) < at(`second-${t}`) && at(`second-${t}`) < at(`first-${t}`));
  });

  it('keeps line breaks and unicode, including emoji', async () => {
    const t = tag();
    await post({ name: 'Zoë 🌟', message: `line one ${t}\n\nline two 👶🏽` });
    const { text } = await home();
    assert.ok(text.includes('Zoë 🌟'));
    assert.ok(text.includes(`line one ${t}\n\nline two 👶🏽`));
  });

  it('stores a double submit only once', async () => {
    const t = tag();
    assert.equal((await post({ name: 'Dup', message: `double-${t}` })).status, 303);
    assert.equal((await post({ name: 'Dup', message: `double-${t}` })).status, 303);
    const { text } = await home();
    assert.equal(text.split(`double-${t}`).length - 1, 1);
  });

  it('works with the real page timestamp once the minimum fill time has passed', async () => {
    const { text } = await home();
    const ts = /name="ts" value="(\d+)"/.exec(text)[1];
    await new Promise((r) => setTimeout(r, 3300));
    const t = tag();
    const res = await post({ name: 'Slow human', message: `real-flow-${t}`, ts });
    assert.equal(res.status, 303);
    assert.ok((await home()).text.includes(`real-flow-${t}`));
  });
});

// ---- partial responses for the page script ------------------------------------

describe('partial responses (X-Partial: 1)', () => {
  it('returns only <main> for GET, with no inline style or script', async () => {
    const res = await fetch(`${BASE}/`, { headers: { 'X-Partial': '1' } });
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.ok(text.startsWith('<main'));
    for (const piece of ['<!doctype', '<head', '<style', '<script']) assert.ok(!text.toLowerCase().includes(piece), piece);
    assert.ok(text.includes('id="list"') && text.includes('id="message-form"'));
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  it('still returns the full page without the header', async () => {
    const text = (await home()).text;
    assert.ok(text.startsWith('<!doctype html>'));
    assert.ok(text.includes('<style nonce='));
  });

  it('answers a failed post with a partial that carries the error, status 422', async () => {
    const res = await post({ name: 'x', message: '   ' }, { headers: { 'X-Partial': '1' } });
    const text = await res.text();
    assert.equal(res.status, 422);
    assert.ok(text.startsWith('<main'));
    assert.match(text, /<p class="err" id="message-err">Please write a message\.<\/p>/);
    assert.ok(!text.includes('<style'));
  });

  it('answers a tripped bot trap with a partial and status 400', async () => {
    const res = await post({ name: 'x', message: 'y', website: 'spam' }, { headers: { 'X-Partial': '1' } });
    const text = await res.text();
    assert.equal(res.status, 400);
    assert.ok(text.startsWith('<main'));
    assert.ok(text.includes('too quick, or something looked off'));
  });

  it('keeps the header across the redirect after a good post, so the list comes back as a partial', async () => {
    const t = tag();
    const res = await fetch(`${BASE}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Partial': '1' },
      body: form({ name: 'Partial', message: `partial-${t}` }),
    });
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.ok(res.redirected);
    assert.equal(new URL(res.url).searchParams.get('posted'), '1');
    assert.ok(text.startsWith('<main'));
    assert.ok(text.includes(`partial-${t}`));
    assert.ok(!text.includes('<script'));
  });
});

// ---- HTML and SQL injection --------------------------------------------------

describe('injection', () => {
  it('escapes HTML in names and messages', async () => {
    const t = tag();
    const name = `"><img src=x onerror=alert(1)> ${t}`;
    const message = `<script>alert("xss")</script> <b onmouseover=alert(1)>hi</b> & 'q' ${t}`;
    assert.equal((await post({ name, message })).status, 303);
    const { res, text } = await home();
    assert.ok(!text.includes('<script>alert'));
    assert.ok(!text.includes('<img src=x'));
    assert.ok(!text.includes('<b onmouseover'));
    assert.ok(text.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'));
    assert.ok(text.includes('&amp; &#39;q&#39;'));
    const nonce = /nonce-([A-Za-z0-9+/=]+)/.exec(res.headers.get('content-security-policy'))[1];
    for (const m of text.matchAll(/<script\b[^>]*>/g)) assert.ok(m[0].includes(nonce), m[0]);
  });

  it('escapes echoed values when validation fails', async () => {
    const res = await post({ name: '"><script>x</script>', message: '</textarea><script>y</script>'.padEnd(600, 'z') });
    assert.equal(res.status, 422);
    const text = await res.text();
    assert.ok(!text.includes('<script>x'));
    assert.ok(!text.includes('</textarea><script>'));
    assert.ok(text.includes('&lt;/textarea&gt;&lt;script&gt;y'));
  });

  it('stores SQL-looking input literally and keeps working', async () => {
    const t = tag();
    const name = `Bobby'); DROP TABLE x;-- ${t}`;
    assert.equal((await post({ name, message: `Bobby ${t}' OR '1'='1` })).status, 303);
    const { res, text } = await home();
    assert.equal(res.status, 200);
    assert.ok(text.includes(`Bobby&#39;); DROP TABLE x;-- ${t}`));
    assert.ok(total(text) > 0);
  });

  it('strips invisible and bidi-override characters', async () => {
    const t = tag();
    await post({ name: `Eve\u202E${t}`, message: `hi\u0007\u200B there ${t}` });
    const { text } = await home();
    assert.ok(text.includes(`Eve${t}`));
    assert.ok(text.includes(`hi there ${t}`));
    assert.ok(!/[\u0007\u200B\u202E]/.test(text));
  });
});

// ---- limits ------------------------------------------------------------------

describe('length limits', () => {
  it('accepts exactly 40 characters of name and 500 of message', async () => {
    const t = tag();
    const res = await post({ name: 'n'.repeat(40), message: `${'m'.repeat(490)}${t.padEnd(10, '0')}` });
    assert.equal(res.status, 303);
  });

  it('counts emoji as one character each', async () => {
    assert.equal((await post({ name: 'Emoji', message: '😀'.repeat(500) })).status, 303);
  });

  it('rejects a 41-character name with 422, an error, and the input kept', async () => {
    const t = tag();
    const res = await post({ name: 'n'.repeat(41), message: `keep-me-${t}` });
    assert.equal(res.status, 422);
    const text = await res.text();
    assert.ok(text.includes('at most 40 characters'));
    assert.ok(text.includes(`keep-me-${t}`));
    assert.ok(!(await home()).text.includes(`keep-me-${t}`));
  });

  it('rejects a 501-character message and does not store it', async () => {
    const t = tag();
    const res = await post({ name: `Long ${t}`, message: 'm'.repeat(501) });
    assert.equal(res.status, 422);
    assert.ok((await res.text()).includes('at most 500 characters'));
    assert.ok(!(await home()).text.includes(`Long ${t}`));
  });

  it('rejects empty and whitespace-only fields', async () => {
    for (const fields of [{ name: '', message: 'x' }, { name: 'x', message: '' }, { name: '   ', message: '\n \t ' }, {}]) {
      assert.equal((await post(fields)).status, 422, JSON.stringify(fields));
    }
  });

  it('rejects oversized bodies, declared or streamed, and non-form content types', async () => {
    assert.equal((await post({}, { body: `name=a&message=${'x'.repeat(20_000)}` })).status, 413);
    const chunks = [new TextEncoder().encode('name=a&message='), new TextEncoder().encode('x'.repeat(20_000))];
    const stream = new ReadableStream({
      start(controller) {
        chunks.forEach((c) => controller.enqueue(c));
        controller.close();
      },
    });
    const streamed = await fetch(`${BASE}/`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: stream,
      duplex: 'half',
    });
    assert.equal(streamed.status, 413);
    assert.equal((await post({}, { contentType: 'application/json', body: '{"name":"a","message":"b"}' })).status, 415);
    assert.equal((await post({}, { contentType: 'text/plain', body: 'name=a' })).status, 415);
  });

  it('rejects invalid UTF-8', async () => {
    assert.equal((await post({}, { body: 'name=a&message=%FF%FE' })).status, 400);
  });
});

// ---- bot trap and request origin ------------------------------------------------

describe('bot trap', () => {
  it('rejects a filled honeypot, stores nothing, and keeps the person\'s text', async () => {
    const t = tag();
    const res = await post({ name: `Bot ${t}`, message: `buy now ${t}`, website: 'http://spam.example' });
    assert.equal(res.status, 400);
    const text = await res.text();
    assert.ok(text.includes('too quick, or something looked off'));
    assert.ok(text.includes(`buy now ${t}`));
    assert.ok(!text.includes('spam.example'));
    assert.ok(!(await home()).text.includes(`buy now ${t}`));
  });

  it('rejects a form submitted the instant it was rendered', async () => {
    const t = tag();
    const res = await post({ name: 'Fast', message: `instant-${t}`, ts: String(Date.now()) });
    assert.equal(res.status, 400);
    assert.ok(!(await home()).text.includes(`instant-${t}`));
  });

  it('rejects a missing, malformed or future timestamp', async () => {
    for (const ts of ['', 'abc', String(Date.now() + 3_600_000)]) {
      assert.equal((await post({ name: 'X', message: 'Y', ts })).status, 400, ts);
    }
    assert.equal((await post({}, { body: 'name=X&message=Y&website=' })).status, 400);
  });
});

describe('cross-site posts', () => {
  it('refuses foreign Origin and cross-site Sec-Fetch-Site, accepts same-origin', async () => {
    const t = tag();
    const fields = { name: 'Origin', message: `origin-${t}` };
    assert.equal((await post(fields, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await post(fields, { headers: { Origin: 'null' } })).status, 403);
    assert.equal((await post(fields, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await post(fields, { headers: { 'Sec-Fetch-Site': 'same-site' } })).status, 403);
    assert.ok(!(await home()).text.includes(`origin-${t}`));
    assert.equal((await post(fields, { headers: { Origin: BASE } })).status, 303);
    assert.equal((await post({ name: 'Origin2', message: `origin2-${t}` }, { headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 303);
  });
});

// ---- pagination --------------------------------------------------------------

describe('pagination', () => {
  it('pages through all messages, 20 per page, newest first', async () => {
    const t = tag();
    for (let i = 1; i <= 23; i++) {
      assert.equal((await post({ name: `P${i}`, message: `page-${t}-${String(i).padStart(2, '0')}` })).status, 303);
    }
    const first = await home();
    const n = total(first.text);
    const pages = Math.ceil(n / 20);
    assert.ok(pages >= 2);
    assert.equal(entries(first.text), 20);
    assert.ok(first.text.includes(`page-${t}-23`));
    assert.ok(first.text.includes(`Page 1 of ${pages}`));
    assert.ok(first.text.includes('href="/?page=2#messages"'));

    const second = await home('?page=2');
    assert.equal(entries(second.text), Math.min(20, n - 20));
    assert.ok(second.text.includes('href="/#messages"'));

    let seen = 0;
    for (let p = 1; p <= pages; p++) seen += entries((await home(`?page=${p}`)).text);
    assert.equal(seen, n);
  });

  it('clamps out-of-range pages and ignores junk page values', async () => {
    const last = await home('?page=99999');
    assert.equal(last.res.status, 200);
    assert.ok(entries(last.text) >= 1);
    for (const junk of ['?page=abc', '?page=-1', '?page=0', '?page=1.5', "?page=1'OR'1'='1"]) {
      const r = await home(junk);
      assert.equal(r.res.status, 200, junk);
      assert.ok(r.text.includes('Page 1 of'), junk);
    }
  });
});
