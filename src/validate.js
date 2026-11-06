// Limits, input cleaning and the bot-trap timing check. Pure functions, no I/O.

export const LIMITS = Object.freeze({
  nameMax: 40,
  messageMax: 500,
  bodyMaxBytes: 16 * 1024,
  // A person needs longer than this to write a message; a bot posting the form
  // the instant it loads does not.
  minFillMs: 3000,
  pageSize: 20,
});

// Characters that are never stored: C0/C1 controls (except tab, LF, CR, which
// are handled separately), zero-width space, BOM, bidirectional overrides that
// can spoof how text is displayed, and invisible "tag" characters.
// Zero-width joiner/non-joiner are kept because emoji and some scripts need them.
const STRIP = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u202A-\u202E\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;

export function cleanName(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(STRIP, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanMessage(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .replace(STRIP, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Length in Unicode code points, so one emoji counts as one character.
export function countChars(value) {
  return [...value].length;
}

export function validateSubmission(input) {
  const name = cleanName(input.name);
  const message = cleanMessage(input.message);
  const errors = {};

  if (!name) {
    errors.name = 'Please enter your name.';
  } else if (countChars(name) > LIMITS.nameMax) {
    errors.name = `Your name can be at most ${LIMITS.nameMax} characters.`;
  }

  if (!message) {
    errors.message = 'Please write a message.';
  } else if (countChars(message) > LIMITS.messageMax) {
    errors.message = `Your message can be at most ${LIMITS.messageMax} characters (it is ${countChars(message)}).`;
  }

  return { ok: Object.keys(errors).length === 0, values: { name, message }, errors };
}

// The form carries the time it was rendered. Returns 'ok', 'too_fast' or 'invalid'.
export function checkTiming(tsValue, now, minFillMs = LIMITS.minFillMs) {
  const text = String(tsValue ?? '');
  if (!/^\d{10,15}$/.test(text)) return 'invalid';
  const ts = Number(text);
  if (ts > now + 60_000) return 'invalid';
  return now - ts < minFillMs ? 'too_fast' : 'ok';
}

export function parsePage(value) {
  return /^[1-9]\d{0,5}$/.test(value ?? '') ? Number(value) : 1;
}
