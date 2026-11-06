// Real-browser tests of the message page's client script: live counter, posting
// without a reload, the confirmation, and errors shown in place.
//
// Needs a local Chrome or Chromium (set CHROME_PATH if it is not found); the whole
// file is skipped otherwise. The Worker runs locally on a throwaway D1 database.
//
// "No reload" is proved with a marker set on `window` before posting: it only
// survives if the same page instance is still there afterwards.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { findChrome, launchChrome } from './chrome.mjs';
import { sleep, startServer } from './support.mjs';

const chromePath = findChrome();

describe('in a real browser', { skip: chromePath ? false : 'Chrome not found (set CHROME_PATH to run these)' }, () => {
  let server;
  let chrome;

  before(async () => {
    server = await startServer();
    chrome = await launchChrome(chromePath);
  });

  after(async () => {
    await chrome?.close();
    await server?.stop();
  });

  // ---- helpers --------------------------------------------------------------

  const tag = () => Math.random().toString(36).slice(2, 10);
  const q = (value) => JSON.stringify(value);

  async function open(path = '/') {
    await chrome.goto(server.base + path);
    await chrome.evaluate(`window.__marker = 'same page'`);
  }

  // Type into the form the way input events would arrive.
  function fill(name, message) {
    return chrome.evaluate(`(() => {
      const n = document.getElementById('name');
      const m = document.getElementById('message');
      if (${q(name)} !== null) { n.value = ${q(name)}; n.dispatchEvent(new Event('input', { bubbles: true })); }
      if (${q(message)} !== null) { m.value = ${q(message)}; m.dispatchEvent(new Event('input', { bubbles: true })); }
    })()`);
  }

  // Pretend the page was opened a while ago, so the bot trap's timer is satisfied.
  const makeOld = () => chrome.evaluate(`document.querySelector('[name=ts]').value = String(Date.now() - 10000)`);
  const send = () => chrome.evaluate(`document.getElementById('send').click()`);

  const entries = () =>
    chrome.evaluate(`[...document.querySelectorAll('#list .entry')].map((e) => ({
      text: e.querySelector('.text').textContent,
      by: e.querySelector('.by strong').textContent,
      fresh: e.classList.contains('fresh'),
    }))`);
  const heading = () => chrome.evaluate(`document.getElementById('messages-h').textContent`);
  const count = () => chrome.evaluate(`({ text: document.getElementById('count').textContent, cls: document.getElementById('count').className })`);
  const marker = () => chrome.evaluate(`window.__marker`);
  const visibleText = (id) => chrome.evaluate(`(() => { const e = document.getElementById(${q(id)}); return e && !e.hidden ? e.textContent.trim() : ''; })()`);

  async function seed(n, prefix) {
    for (let i = 1; i <= n; i++) {
      const body = new URLSearchParams({ name: `Seed ${i}`, message: `${prefix}-${String(i).padStart(2, '0')}`, website: '', ts: String(Date.now() - 10_000) });
      const res = await fetch(`${server.base}/`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      assert.equal(res.status, 303);
    }
  }

  const stored = async (needle) => (await (await fetch(`${server.base}/`)).text()).includes(needle);

  // ---- live counter ---------------------------------------------------------

  it('counts characters live and warns near and over the limit', async () => {
    await open();
    assert.deepEqual(await count(), { text: '0 / 500', cls: '' });
    await fill(null, 'hello');
    assert.deepEqual(await count(), { text: '5 / 500', cls: '' });
    await fill(null, 'x'.repeat(449));
    assert.deepEqual(await count(), { text: '449 / 500', cls: '' });
    await fill(null, 'x'.repeat(450));
    assert.deepEqual(await count(), { text: '450 / 500', cls: 'near' });
    await fill(null, 'x'.repeat(500));
    assert.deepEqual(await count(), { text: '500 / 500', cls: 'near' });
    await fill(null, 'x'.repeat(501));
    assert.deepEqual(await count(), { text: '501 / 500', cls: 'over' });
  });

  it('counts an emoji as one character and does not stop typing early', async () => {
    await open();
    await fill(null, '😀'.repeat(300));
    assert.deepEqual(await count(), { text: '300 / 500', cls: '' });
    assert.equal(await chrome.evaluate(`document.getElementById('message').value.length`), 600);
    assert.equal(await chrome.evaluate(`document.getElementById('message').hasAttribute('maxlength')`), false);
    assert.equal(await chrome.evaluate(`document.getElementById('name').hasAttribute('maxlength')`), true);
  });

  // ---- posting without a reload -----------------------------------------------

  it('posts without reloading, puts the message on top, and confirms', async () => {
    const t = tag();
    await open();
    const before = Number(/\((\d+)\)/.exec(await heading())[1]);
    await fill(`Ada ${t}`, `Welcome little one ${t}`);
    await makeOld();
    await send();
    await chrome.waitFor(`document.querySelector('#list .entry .text')?.textContent === ${q(`Welcome little one ${t}`)}`);

    assert.equal(await marker(), 'same page', 'the page must not have reloaded');
    assert.equal(await chrome.evaluate('location.search'), '');
    const list = await entries();
    assert.equal(list[0].text, `Welcome little one ${t}`);
    assert.equal(list[0].by, `Ada ${t}`);
    assert.equal(list[0].fresh, true);
    assert.equal(Number(/\((\d+)\)/.exec(await heading())[1]), before + 1);

    const status = await visibleText('status');
    assert.ok(status.includes(`Thank you, Ada ${t}!`), status);
    assert.ok(status.includes('top of the list'), status);
    assert.equal(await chrome.evaluate(`document.querySelector('#status').getAttribute('role')`), 'status');

    assert.equal(await chrome.evaluate(`document.getElementById('message').value`), '');
    assert.deepEqual(await count(), { text: '0 / 500', cls: '' });
    assert.equal(await chrome.evaluate(`document.getElementById('name').value`), `Ada ${t}`);
    assert.equal(await chrome.evaluate(`document.getElementById('send').textContent`), 'Send message');
    assert.equal(await chrome.evaluate(`document.getElementById('send').hasAttribute('aria-busy')`), false);
  });

  it('keeps newest first across several posts on the same page', async () => {
    const t = tag();
    await open();
    for (const word of ['first', 'second', 'third']) {
      await fill('Poster', `${word}-${t}`);
      await makeOld();
      await send();
      await chrome.waitFor(`document.querySelector('#list .entry .text')?.textContent === ${q(`${word}-${t}`)}`);
    }
    const texts = (await entries()).map((e) => e.text);
    assert.deepEqual(texts.slice(0, 3), [`third-${t}`, `second-${t}`, `first-${t}`]);
    assert.equal(await marker(), 'same page');
  });

  it('clears the confirmation when the visitor starts a new message', async () => {
    const t = tag();
    await open();
    await fill('Clara', `clear-${t}`);
    await makeOld();
    await send();
    await chrome.waitFor(`document.querySelector('#status .banner')`);
    await fill(null, 'another');
    assert.equal(await visibleText('status'), '');
  });

  it('stores a double click only once', async () => {
    const t = tag();
    await open();
    await fill('Eager', `double-${t}`);
    await makeOld();
    await chrome.evaluate(`(() => { const b = document.getElementById('send'); b.click(); b.click(); b.click(); })()`);
    await chrome.waitFor(`document.querySelector('#list .entry .text')?.textContent === ${q(`double-${t}`)}`);
    await sleep(300);
    const matches = (await entries()).filter((e) => e.text === `double-${t}`);
    assert.equal(matches.length, 1);
    assert.equal(((await (await fetch(`${server.base}/`)).text()).split(`double-${t}`).length - 1), 1);
  });

  it('shows hostile text as plain text and runs nothing', async () => {
    const t = tag();
    const evil = `<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script> & "q" ${t}`;
    await open();
    await fill(`<b>Eve</b> ${t}`, evil);
    await makeOld();
    await send();
    await chrome.waitFor(`document.querySelector('#list .entry .text')?.textContent === ${q(evil)}`);
    assert.equal(await chrome.evaluate(`window.__pwned === undefined`), true);
    assert.equal(await chrome.evaluate(`document.querySelectorAll('#list img, #list script, #list b').length`), 0);
    assert.equal(await chrome.evaluate(`document.querySelector('#list .entry .by strong').textContent`), `<b>Eve</b> ${t}`);
    assert.ok((await visibleText('status')).includes(`<b>Eve</b> ${t}`), 'the confirmation shows the name as text');
    assert.equal(await chrome.evaluate(`document.querySelectorAll('#status b').length`), 0);
  });

  it('shows the fresh list as page 1 when posting from an older page', async () => {
    const t = tag();
    await seed(22, `old-${t}`);
    await open('/?page=2');
    assert.ok((await chrome.evaluate(`document.querySelector('.pager .where')?.textContent`)).includes('Page 2 of'));
    await fill('Late', `from-page-two-${t}`);
    await makeOld();
    await send();
    await chrome.waitFor(`document.querySelector('#list .entry .text')?.textContent === ${q(`from-page-two-${t}`)}`);
    assert.equal(await marker(), 'same page');
    assert.equal(await chrome.evaluate('location.search'), '', 'the address should now be page 1');
    assert.ok((await chrome.evaluate(`document.querySelector('.pager .where')?.textContent`)).includes('Page 1 of'));
    assert.equal((await entries()).length, 20);
  });

  // ---- errors shown in place --------------------------------------------------

  it('shows a validation error in place, keeps the text, and clears it on typing', async () => {
    await open();
    const before = await heading();
    await fill('Whitespace', '   ');
    await makeOld();
    await send();
    await chrome.waitFor(`!document.getElementById('message-err').hidden`);
    assert.equal(await marker(), 'same page');
    assert.equal(await visibleText('message-err'), 'Please write a message.');
    assert.equal(await chrome.evaluate(`document.getElementById('message').getAttribute('aria-invalid')`), 'true');
    assert.equal(await chrome.evaluate(`document.activeElement.id`), 'message');
    assert.equal(await heading(), before);
    await fill(null, 'now typing');
    assert.equal(await visibleText('message-err'), '');
    assert.equal(await chrome.evaluate(`document.getElementById('message').hasAttribute('aria-invalid')`), false);
  });

  it('blocks an over-long message in the browser without sending it', async () => {
    const t = tag();
    await open();
    await fill('Wordy', `${t}${'x'.repeat(500)}`);
    await makeOld();
    await send();
    await chrome.waitFor(`!document.getElementById('message-err').hidden`);
    assert.equal(await visibleText('message-err'), `Your message can be at most 500 characters (it is ${500 + t.length}).`);
    assert.equal(await stored(t), false);
    assert.equal(await marker(), 'same page');
  });

  it('shows the bot-trap message in place when sent too quickly, then succeeds after waiting', async () => {
    const t = tag();
    await open();
    await fill('Quick', `quick-${t}`);
    await send();
    await chrome.waitFor(`!document.getElementById('form-error').hidden`);
    assert.ok((await visibleText('form-error')).includes('too quick'));
    assert.equal(await chrome.evaluate(`document.getElementById('message').value`), `quick-${t}`);
    assert.equal(await stored(`quick-${t}`), false);
    assert.equal(await marker(), 'same page');

    await sleep(3300);
    await send();
    await chrome.waitFor(`document.querySelector('#list .entry .text')?.textContent === ${q(`quick-${t}`)}`);
    assert.equal(await visibleText('form-error'), '');
  });

  // ---- local time -------------------------------------------------------------

  it('shows each message time in the visitor\'s own timezone and language, also after posting', async () => {
    const t = tag();
    await seed(1, `tz-${t}`);
    // What the page itself says the first <time> should read, for a given language and zone.
    const expected = (locale, zone) => chrome.evaluate(`(() => {
      const el = document.querySelector('#list time');
      return new Intl.DateTimeFormat(${q(locale)}, { dateStyle: 'medium', timeStyle: 'short', timeZone: ${q(zone)} }).format(new Date(el.getAttribute('datetime')));
    })()`);
    const shown = () => chrome.evaluate(`document.querySelector('#list time').textContent`);
    try {
      await chrome.send('Emulation.setLocaleOverride', { locale: 'de-DE' });

      await chrome.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Tokyo' });
      await open();
      const tokyo = await shown();
      assert.equal(tokyo, await expected('de-DE', 'Asia/Tokyo'));
      assert.ok(!tokyo.includes('UTC'), tokyo);
      assert.ok((await chrome.evaluate(`document.querySelector('#list time').title`)).length > tokyo.length, 'the tooltip carries the long form');

      await chrome.send('Emulation.setTimezoneOverride', { timezoneId: 'America/Los_Angeles' });
      await open();
      const la = await shown();
      assert.equal(la, await expected('de-DE', 'America/Los_Angeles'));
      assert.notEqual(la, tokyo, 'the same instant reads differently in another timezone');

      // A message posted without a reload is localized too.
      await fill('Zeit', `tz-new-${t}`);
      await makeOld();
      await send();
      await chrome.waitFor(`document.querySelector('#list .entry .text')?.textContent === ${q(`tz-new-${t}`)}`);
      assert.equal(await marker(), 'same page');
      assert.equal(await shown(), await expected('de-DE', 'America/Los_Angeles'));
      assert.ok(!(await shown()).includes('UTC'));
      assert.equal(await chrome.evaluate(`[...document.querySelectorAll('#list time')].every((el) => !el.textContent.includes('UTC'))`), true);
    } finally {
      await chrome.send('Emulation.setTimezoneOverride', { timezoneId: '' });
      await chrome.send('Emulation.setLocaleOverride', {});
    }
  });

  it('shows labelled UTC times when scripts are disabled in the browser', async () => {
    await seed(1, `nojs-${tag()}`);
    await chrome.send('Emulation.setScriptExecutionDisabled', { value: true });
    try {
      await chrome.goto(`${server.base}/`);
      // The page's script did not run: the counter stays empty and the time is the server's UTC text.
      assert.equal(await chrome.evaluate(`document.getElementById('count').textContent`), '');
      assert.match(await chrome.evaluate(`document.querySelector('#list time').textContent`), /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC$/);
    } finally {
      await chrome.send('Emulation.setScriptExecutionDisabled', { value: false });
    }
  });

  // ---- last: nothing went wrong behind the scenes ----------------------------

  it('produced no CSP violations, console errors or script exceptions', () => {
    assert.deepEqual(chrome.problems(), []);
  });
});
