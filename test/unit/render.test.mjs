import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeHtml, html, raw } from '../../src/html.js';
import { CLIENT_SCRIPT, renderHome } from '../../src/page.js';

const NONCE = 'TESTNONCE123';
const base = { nonce: NONCE, messages: [], total: 0, page: 1, pages: 1, ts: 1_800_000_000_000 };

describe('escapeHtml', () => {
  it('escapes the five dangerous characters', () => {
    assert.equal(escapeHtml(`<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
});

describe('html template', () => {
  it('escapes interpolated strings and numbers', () => {
    assert.equal(html`<p>${'<b>'}</p>`.toString(), '<p>&lt;b&gt;</p>');
    assert.equal(html`<p>${5}</p>`.toString(), '<p>5</p>');
  });
  it('does not double-escape nested templates and joins arrays', () => {
    const inner = html`<i>${'a&b'}</i>`;
    assert.equal(html`<p>${inner}</p>`.toString(), '<p><i>a&amp;b</i></p>');
    assert.equal(html`${['<', html`<b>`]}`.toString(), '&lt;<b>');
  });
  it('drops null, undefined and false', () => {
    assert.equal(html`<p>${null}${undefined}${false}</p>`.toString(), '<p></p>');
  });
  it('escapes a value that merely looks like a safe template', () => {
    assert.equal(html`${{ value: '<b>', toString: () => '<b>' }}`.toString(), '&lt;b&gt;');
  });
  it('raw() is the only way to bypass escaping', () => {
    assert.equal(html`${raw('<b>')}`.toString(), '<b>');
  });
});

describe('renderHome: HTML injection', () => {
  const evil = {
    id: 1,
    name: '"><img src=x onerror=alert(1)>',
    message: '<script>alert("xss")</script>\n<b onmouseover=alert(1)>x</b> & \'quotes\'',
    created_at: Date.UTC(2026, 10, 6, 12, 0, 0),
  };
  const out = renderHome({ ...base, messages: [evil], total: 1 });

  it('never emits user-supplied tags or attributes', () => {
    assert.ok(!out.includes('<script>alert'));
    assert.ok(!out.includes('<img src=x'));
    assert.ok(!out.includes('<b onmouseover'));
    assert.ok(out.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'));
    assert.ok(out.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(out.includes('&amp; &#39;quotes&#39;'));
  });
  it('only emits <script> and <style> tags that carry the nonce', () => {
    const scripts = out.match(/<script\b[^>]*>/g) ?? [];
    const styles = out.match(/<style\b[^>]*>/g) ?? [];
    assert.equal(scripts.length, 2);
    assert.equal(styles.length, 1);
    for (const tag of [...scripts, ...styles]) assert.ok(tag.includes(`nonce="${NONCE}"`), tag);
  });
  it('keeps the page\'s own JavaScript and CSS intact (quotes not entity-encoded)', () => {
    assert.ok(out.includes("localStorage.getItem('guide-theme')"));
    assert.ok(out.includes('--font: system-ui'));
    assert.ok(!out.includes('&#39;guide-theme&#39;'));
  });
  it('escapes values echoed back into the form, including attribute breakouts', () => {
    const page = renderHome({
      ...base,
      values: { name: '"><script>x</script>', message: '</textarea><script>y</script>' },
      errors: { form: '<i>form</i>', name: '<u>n</u>', message: '<u>m</u>' },
    });
    assert.ok(!/<script>[xy]</.test(page));
    assert.ok(!page.includes('</textarea><script>'));
    assert.ok(!page.includes('<i>form</i>'));
    assert.ok(!page.includes('<u>'));
    assert.ok(page.includes('value="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"'));
  });
});

describe('renderHome: structure', () => {
  it('has the honeypot, the timestamp and length limits on the form', () => {
    const out = renderHome(base);
    assert.ok(out.includes('name="website"'));
    assert.ok(out.includes('tabindex="-1"'));
    assert.ok(out.includes('name="ts" value="1800000000000"'));
    assert.ok(out.includes('maxlength="40"'));
    assert.ok(out.includes('maxlength="500"'));
  });
  it('contains no inline style attributes or event handlers that the CSP would block', () => {
    const out = renderHome({ ...base, messages: [{ id: 1, name: 'A', message: 'B', created_at: 0 }], total: 1 });
    assert.ok(!/\sstyle=/.test(out));
    assert.ok(!/\son[a-z]+=/i.test(out));
  });
  it('shows an empty state, the thank-you banner and pagination only when relevant', () => {
    assert.ok(renderHome(base).includes('No messages yet'));
    assert.ok(!renderHome(base).includes('class="banner ok"'));
    assert.ok(renderHome({ ...base, posted: true }).includes('<p class="banner ok">Thank you!'));
    assert.ok(!renderHome(base).includes('class="pager"'));
    const paged = renderHome({ ...base, page: 2, pages: 3, total: 50 });
    assert.ok(paged.includes('Page 2 of 3'));
    assert.ok(paged.includes('href="/#messages"'));
    assert.ok(paged.includes('href="/?page=3#messages"'));
  });
  it('links to the guide', () => {
    assert.ok(renderHome(base).includes('href="/guide"'));
  });
});

describe('renderHome: pieces the client script relies on', () => {
  const out = renderHome(base);

  it('always renders the error placeholders, hidden when there is no error', () => {
    assert.match(out, /<p class="banner bad" id="form-error" role="alert" hidden><\/p>/);
    assert.match(out, /<p class="err" id="name-err" hidden><\/p>/);
    assert.match(out, /<p class="err" id="message-err" hidden><\/p>/);
  });

  it('shows server-side errors un-hidden, escaped, and marks the field invalid', () => {
    const page = renderHome({ ...base, errors: { form: 'F <b>', name: 'N <b>', message: 'M <b>' } });
    assert.match(page, /<p class="banner bad" id="form-error" role="alert">F &lt;b&gt;<\/p>/);
    assert.match(page, /<p class="err" id="name-err">N &lt;b&gt;<\/p>/);
    assert.match(page, /<p class="err" id="message-err">M &lt;b&gt;<\/p>/);
    assert.equal((page.match(/<(?:input|textarea)\b[^>]*aria-invalid="true"/g) ?? []).length, 2);
    assert.equal((out.match(/<(?:input|textarea)\b[^>]*aria-invalid="true"/g) ?? []).length, 0);
  });

  it('has a persistent status live region outside the list that gets swapped', () => {
    const status = out.indexOf('id="status"');
    const list = out.indexOf('id="list"');
    assert.ok(status !== -1 && list !== -1 && status < list);
    assert.match(out, /<div id="status" role="status"><\/div>/);
    assert.ok(out.indexOf('id="messages-h"') > list);
  });

  it('wires the form, counter and button by id, and describes fields by their error and counter', () => {
    for (const id of ['message-form', 'name', 'message', 'count', 'send', 'theme-btn', 'theme-label']) {
      assert.ok(out.includes(`id="${id}"`), id);
    }
    assert.ok(out.includes('aria-describedby="name-err"'));
    assert.ok(out.includes('aria-describedby="message-err count"'));
  });

  it('keeps maxlength in the markup for visitors without JavaScript', () => {
    assert.ok(out.includes('maxlength="500"') && out.includes('maxlength="40"'));
  });
});

describe('client script', () => {
  it('never builds HTML from strings or evaluates code', () => {
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'setTimeout("', "setTimeout('"]) {
      assert.ok(!CLIENT_SCRIPT.includes(sink), `client script must not use ${sink}`);
    }
  });

  it('puts visitor text on the page only through textContent or server-rendered nodes', () => {
    assert.ok(CLIENT_SCRIPT.includes('p.textContent = message'));
    assert.ok(CLIENT_SCRIPT.includes('document.importNode'));
  });

  it('is syntactically valid JavaScript', () => {
    assert.doesNotThrow(() => new Function(CLIENT_SCRIPT));
  });
});

describe('renderHome: partial (for the client script)', () => {
  const full = renderHome(base);
  const partial = renderHome({ ...base, partial: true });

  it('returns only <main>: no document wrapper, head, style, script or footer', () => {
    assert.ok(partial.startsWith('<main'));
    assert.ok(partial.trimEnd().endsWith('</main>'));
    for (const piece of ['<!doctype', '<html', '<head', '<style', '<script', '<footer', 'nonce=']) {
      assert.ok(!partial.toLowerCase().includes(piece), `partial must not contain ${piece}`);
    }
  });

  it('still carries everything the client script reads or updates', () => {
    for (const id of ['message-form', 'form-error', 'name-err', 'message-err', 'status', 'list', 'messages-h']) {
      assert.ok(partial.includes(`id="${id}"`), id);
    }
  });

  it('is the same markup as inside the full page', () => {
    assert.ok(full.includes(partial));
  });

  it('shows errors and escapes values just like the full page', () => {
    const page = renderHome({ ...base, partial: true, errors: { message: 'M <b>' }, values: { message: '</textarea><i>' } });
    assert.match(page, /<p class="err" id="message-err">M &lt;b&gt;<\/p>/);
    assert.ok(!page.includes('</textarea><i>'));
  });
});
