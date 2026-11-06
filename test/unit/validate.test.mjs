import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LIMITS, checkTiming, cleanMessage, cleanName, countChars, parsePage, validateSubmission } from '../../src/validate.js';

describe('cleanName', () => {
  it('trims and collapses whitespace, including newlines', () => {
    assert.equal(cleanName('  Ada \n  Lovelace\t'), 'Ada Lovelace');
  });
  it('strips control, zero-width and bidi-override characters', () => {
    assert.equal(cleanName('A\u0000d\u202Ea\u200B\uFEFF'), 'Ada');
    assert.equal(cleanName('x\u{E0041}y'), 'xy');
  });
  it('keeps emoji joiners so family emoji survive', () => {
    const family = '👨‍👩‍👧';
    assert.equal(cleanName(family), family);
  });
  it('handles null and undefined', () => {
    assert.equal(cleanName(null), '');
    assert.equal(cleanName(undefined), '');
  });
});

describe('cleanMessage', () => {
  it('keeps single and double line breaks but squeezes longer runs', () => {
    assert.equal(cleanMessage('a\n\n\n\n\nb'), 'a\n\nb');
    assert.equal(cleanMessage('a\nb'), 'a\nb');
  });
  it('normalizes CRLF, CR and unicode line separators to LF', () => {
    assert.equal(cleanMessage('a\r\nb\rc\u2028d'), 'a\nb\nc\nd');
  });
  it('collapses runs of spaces and tabs and trims around newlines', () => {
    assert.equal(cleanMessage('a \t  b \n   c'), 'a b\nc');
  });
  it('strips control and bidi characters', () => {
    assert.equal(cleanMessage('hi\u0007 there\u202E'), 'hi there');
  });
  it('does not alter markup; that is the renderer\'s job', () => {
    assert.equal(cleanMessage('<script>alert(1)</script>'), '<script>alert(1)</script>');
  });
});

describe('countChars', () => {
  it('counts code points, not UTF-16 units', () => {
    assert.equal(countChars('😀'), 1);
    assert.equal('😀'.length, 2);
  });
});

describe('validateSubmission', () => {
  it('accepts a normal submission', () => {
    const r = validateSubmission({ name: 'Ada', message: 'Welcome, little one!' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.values, { name: 'Ada', message: 'Welcome, little one!' });
  });
  it('rejects empty and whitespace-only fields', () => {
    const r = validateSubmission({ name: '   ', message: '\n\n ' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.name);
    assert.ok(r.errors.message);
  });
  it('enforces the name limit exactly', () => {
    assert.equal(validateSubmission({ name: 'a'.repeat(LIMITS.nameMax), message: 'x' }).ok, true);
    const r = validateSubmission({ name: 'a'.repeat(LIMITS.nameMax + 1), message: 'x' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.name);
  });
  it('enforces the message limit exactly', () => {
    assert.equal(validateSubmission({ name: 'a', message: 'x'.repeat(LIMITS.messageMax) }).ok, true);
    const r = validateSubmission({ name: 'a', message: 'x'.repeat(LIMITS.messageMax + 1) });
    assert.equal(r.ok, false);
    assert.ok(r.errors.message);
  });
  it('measures length in characters, so emoji are not double counted', () => {
    assert.equal(validateSubmission({ name: 'a', message: '😀'.repeat(LIMITS.messageMax) }).ok, true);
  });
  it('measures length after cleaning, so padding cannot be used to exceed it', () => {
    const padded = 'x'.repeat(LIMITS.messageMax) + '\u200B'.repeat(100);
    assert.equal(validateSubmission({ name: 'a', message: padded }).ok, true);
  });
  it('treats missing fields as empty', () => {
    assert.equal(validateSubmission({}).ok, false);
  });
});

describe('checkTiming', () => {
  const now = 1_800_000_000_000;
  it('accepts a form that was rendered long enough ago', () => {
    assert.equal(checkTiming(String(now - 10_000), now), 'ok');
    assert.equal(checkTiming(String(now - LIMITS.minFillMs), now), 'ok');
  });
  it('flags an instant submission', () => {
    assert.equal(checkTiming(String(now - 500), now), 'too_fast');
    assert.equal(checkTiming(String(now), now), 'too_fast');
  });
  it('accepts a very old page that was left open', () => {
    assert.equal(checkTiming(String(now - 3 * 24 * 3600 * 1000), now), 'ok');
  });
  it('rejects missing, malformed and far-future timestamps', () => {
    for (const bad of [undefined, null, '', 'abc', '12', '1.5e12', '-1800000000000', String(now + 3_600_000)]) {
      assert.equal(checkTiming(bad, now), 'invalid', `value: ${bad}`);
    }
  });
});

describe('parsePage', () => {
  it('accepts positive integers and defaults everything else to 1', () => {
    assert.equal(parsePage('3'), 3);
    for (const bad of [null, undefined, '', '0', '-2', '1.5', 'abc', '1e3', '9999999', ' 2']) {
      assert.equal(parsePage(bad), 1, `value: ${bad}`);
    }
  });
});
