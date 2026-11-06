// Server-rendered home page: the message form and the list of messages.
// All dynamic values go through the auto-escaping `html` template (see html.js).
// The CSP only allows the inline <style> and <script> carrying this response's
// nonce, so avoid style="" attributes and inline event handlers here.

import { html, raw } from './html.js';
import { LIMITS } from './validate.js';

const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

const STYLES = `
  :root {
    --bg: #fbf8f4; --surface: #ffffff; --surface-2: #f4eee6; --ink: #2a2622; --muted: #675e55;
    --border: #e6ddd1; --accent: #2a7261; --accent-ink: #ffffff; --accent-soft: #e2f0ec;
    --red: #b3261e; --red-soft: #fdecea; --green: #1f6b3a; --green-soft: #e4f3e8;
    --shadow: 0 1px 2px rgba(60, 40, 20, .06), 0 6px 20px rgba(60, 40, 20, .05);
    --radius: 18px;
    --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --font-head: ui-rounded, "SF Pro Rounded", "Nunito", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #151311; --surface: #1f1c19; --surface-2: #2a2622; --ink: #f1ece6; --muted: #b5aba0;
      --border: #38332e; --accent: #74c7b3; --accent-ink: #0d211c; --accent-soft: #1d3832;
      --red: #ff9a90; --red-soft: #3b1f1d; --green: #8fd6a2; --green-soft: #1c3324;
      --shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 6px 20px rgba(0, 0, 0, .25);
      color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --bg: #151311; --surface: #1f1c19; --surface-2: #2a2622; --ink: #f1ece6; --muted: #b5aba0;
    --border: #38332e; --accent: #74c7b3; --accent-ink: #0d211c; --accent-soft: #1d3832;
    --red: #ff9a90; --red-soft: #3b1f1d; --green: #8fd6a2; --green-soft: #1c3324;
    --shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 6px 20px rgba(0, 0, 0, .25);
    color-scheme: dark;
  }

  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.6 var(--font); overflow-wrap: break-word; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 0 16px; }
  a { color: var(--accent); text-underline-offset: 2px; }
  :focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; border-radius: 6px; }
  .skip { position: absolute; left: 12px; top: -60px; z-index: 30; background: var(--accent); color: var(--accent-ink);
    padding: 10px 14px; border-radius: 10px; font-weight: 600; text-decoration: none; }
  .skip:focus { top: 12px; }

  .hero { padding: 22px 0 8px; }
  .hero-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .eyebrow { margin: 0; font-size: .8rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
  .theme-btn { appearance: none; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; font: inherit;
    font-size: .85rem; font-weight: 600; color: var(--ink); background: var(--surface); border: 1px solid var(--border);
    border-radius: 999px; padding: 7px 13px 7px 11px; min-height: 40px; }
  .theme-btn svg { width: 18px; height: 18px; flex: none; }
  h1, h2 { font-family: var(--font-head); line-height: 1.2; margin: 0; }
  h1 { font-size: clamp(1.9rem, 7.5vw, 2.7rem); margin: 14px 0 10px; letter-spacing: -.01em; }
  h2 { font-size: 1.35rem; margin-bottom: 12px; }
  .sub { margin: 0 0 10px; color: var(--muted); font-size: 1.05rem; max-width: 56ch; }
  .guide-link { display: inline-block; font-weight: 600; margin-bottom: 6px; }

  main { padding: 14px 0 8px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    box-shadow: var(--shadow); padding: 20px 16px; margin-bottom: 28px; }
  .banner { border-radius: 14px; padding: 12px 14px; margin: 0 0 16px; border: 1.5px solid; font-weight: 600; }
  .banner.ok { background: var(--green-soft); border-color: var(--green); color: var(--green); }
  .banner.bad { background: var(--red-soft); border-color: var(--red); color: var(--red); }

  .field { margin-bottom: 16px; }
  label { display: block; font-weight: 600; margin-bottom: 6px; }
  input[type="text"], textarea { width: 100%; font: inherit; color: var(--ink); background: var(--bg);
    border: 1.5px solid var(--border); border-radius: 12px; padding: 11px 12px; min-height: 46px; }
  textarea { resize: vertical; min-height: 130px; }
  input[type="text"]:focus, textarea:focus { outline: 3px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
  input[aria-invalid="true"], textarea[aria-invalid="true"] { border-color: var(--red); }
  .hint { display: flex; justify-content: flex-end; color: var(--muted); font-size: .85rem; margin-top: 4px; min-height: 1.2em; }
  .err { color: var(--red); font-size: .92rem; font-weight: 600; margin: 6px 0 0; }
  .hp { position: absolute; left: -10000px; top: auto; width: 1px; height: 1px; overflow: hidden; }
  .send { appearance: none; cursor: pointer; font: inherit; font-weight: 700; background: var(--accent);
    color: var(--accent-ink); border: 0; border-radius: 999px; padding: 12px 26px; min-height: 48px; }
  .send:hover { filter: brightness(1.07); }
  .fine { color: var(--muted); font-size: .88rem; margin: 14px 0 0; }

  .entry { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow);
    padding: 16px 16px 14px; margin-bottom: 12px; }
  .entry .text { margin: 0 0 10px; white-space: pre-wrap; overflow-wrap: anywhere; overflow: hidden; }
  .entry .by { margin: 0; color: var(--muted); font-size: .9rem; overflow-wrap: anywhere; }
  .entry .by strong { color: var(--ink); }
  .empty { background: var(--accent-soft); border-radius: 14px; padding: 16px; margin: 0; }
  .pager { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 18px 0 4px; font-weight: 600; }
  .pager .where { color: var(--muted); font-weight: 400; font-size: .9rem; }
  footer { padding: 6px 0 48px; color: var(--muted); font-size: .9rem; }

  @media (min-width: 640px) {
    body { font-size: 18px; }
    .wrap { padding: 0 24px; }
    .card { padding: 26px 26px 22px; }
  }
`;

// Applied before first paint to honor a theme saved by the toggle (shared with /guide).
const THEME_EARLY = `
  (function () {
    try {
      var t = localStorage.getItem('guide-theme');
      if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    } catch (e) {}
  })();
`;

const SCRIPT = `
  (function () {
    var root = document.documentElement;
    var btn = document.getElementById('theme-btn');
    var label = document.getElementById('theme-label');
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    function isDark() { var t = root.getAttribute('data-theme'); return t ? t === 'dark' : mq.matches; }
    function sync() {
      var dark = isDark();
      btn.setAttribute('aria-pressed', String(dark));
      label.textContent = dark ? 'Light mode' : 'Dark mode';
    }
    btn.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('guide-theme', next); } catch (e) {}
      sync();
    });
    if (mq.addEventListener) mq.addEventListener('change', sync);
    sync();

    var text = document.getElementById('message');
    var count = document.getElementById('count');
    if (text && count) {
      var max = Number(text.getAttribute('data-max'));
      var update = function () { count.textContent = Array.from(text.value).length + ' / ' + max; };
      text.addEventListener('input', update);
      update();
    }
  })();
`;

function fieldError(id, text) {
  return text ? html`<p class="err" id="${id}">${text}</p>` : '';
}

function entry(m) {
  const iso = new Date(m.created_at).toISOString();
  return html`<article class="entry">
    <p class="text">${m.message}</p>
    <p class="by">— <strong>${m.name}</strong> · <time datetime="${iso}">${dateFormat.format(m.created_at)}</time></p>
  </article>`;
}

function pageHref(p) {
  return p <= 1 ? '/#messages' : `/?page=${p}#messages`;
}

function pager(page, pages) {
  if (pages <= 1) return '';
  return html`<nav class="pager" aria-label="More messages">
    ${page > 1 ? html`<a href="${pageHref(page - 1)}">← Newer</a>` : html`<span></span>`}
    <span class="where">Page ${page} of ${pages}</span>
    ${page < pages ? html`<a href="${pageHref(page + 1)}">Older →</a>` : html`<span></span>`}
  </nav>`;
}

/**
 * @param {object} opts
 * @param {string} opts.nonce       CSP nonce for this response
 * @param {Array}  opts.messages    rows for the current page, newest first
 * @param {number} opts.total       total number of messages
 * @param {number} opts.page        current page (1-based)
 * @param {number} opts.pages       total pages
 * @param {number} opts.ts          render time in ms, echoed back by the form
 * @param {{name?: string, message?: string}} [opts.values]  form values to keep
 * @param {{name?: string, message?: string, form?: string}} [opts.errors]
 * @param {boolean} [opts.posted]   show the thank-you banner
 */
export function renderHome({ nonce, messages, total, page, pages, ts, values = {}, errors = {}, posted = false }) {
  const doc = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Messages for the baby</title>
<meta name="description" content="Leave a kind message for the baby and read what everyone has written.">
<meta name="color-scheme" content="light dark">
<script nonce="${nonce}">${raw(THEME_EARLY)}</script>
<style nonce="${nonce}">${raw(STYLES)}</style>
</head>
<body>
<a class="skip" href="#write">Skip to the form</a>

<header class="hero">
  <div class="wrap">
    <div class="hero-top">
      <p class="eyebrow">A little guestbook</p>
      <button type="button" class="theme-btn" id="theme-btn" aria-pressed="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
        <span id="theme-label">Dark mode</span>
      </button>
    </div>
    <h1>Messages for the baby</h1>
    <p class="sub">Leave a kind word, a wish or a bit of advice. Newest messages are at the top.</p>
    <a class="guide-link" href="/guide">New to baby care? Read the guide →</a>
  </div>
</header>

<main class="wrap" id="main">
  ${posted ? html`<p class="banner ok" role="status">Thank you! Your message has been added.</p>` : ''}

  <section class="card" id="write" aria-labelledby="write-h">
    <h2 id="write-h">Write a message</h2>
    ${errors.form ? html`<p class="banner bad" role="alert">${errors.form}</p>` : ''}
    <form method="post" action="/">
      <div class="field">
        <label for="name">Your name</label>
        <input id="name" name="name" type="text" maxlength="${LIMITS.nameMax}" required autocomplete="name"
          value="${values.name ?? ''}"${errors.name ? html` aria-invalid="true" aria-describedby="name-err"` : ''}>
        ${fieldError('name-err', errors.name)}
      </div>
      <div class="field">
        <label for="message">Your message</label>
        <textarea id="message" name="message" rows="5" maxlength="${LIMITS.messageMax}" data-max="${LIMITS.messageMax}" required${errors.message ? html` aria-invalid="true" aria-describedby="message-err"` : ''}>${values.message ?? ''}</textarea>
        <div class="hint"><span id="count"></span></div>
        ${fieldError('message-err', errors.message)}
      </div>
      <div class="hp" aria-hidden="true">
        <label>Leave this field empty <input type="text" name="website" tabindex="-1" autocomplete="off" value=""></label>
      </div>
      <input type="hidden" name="ts" value="${ts}">
      <button type="submit" class="send">Send message</button>
    </form>
    <p class="fine">Messages are public and can be read by anyone. Please don’t share phone numbers, addresses or other private details.</p>
  </section>

  <section id="messages" aria-labelledby="messages-h">
    <h2 id="messages-h">Messages (${total})</h2>
    ${messages.length === 0
      ? html`<p class="empty">No messages yet. Be the first to write one!</p>`
      : messages.map(entry)}
    ${pager(page, pages)}
  </section>
</main>

<footer>
  <div class="wrap"><a href="/guide">Practical baby care guide</a></div>
</footer>

<script nonce="${nonce}">${raw(SCRIPT)}</script>
</body>
</html>
`;
  return doc.toString();
}
