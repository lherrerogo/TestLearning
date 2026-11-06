// Minimal auto-escaping HTML templating.
//
// Every value interpolated into an `html` template is escaped unless it is
// itself the result of an `html` template. Static template text is trusted
// code. Always put interpolations inside double-quoted attributes.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

class SafeHtml {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// Marks a string as already safe. ONLY for static code written in this repo
// (the page's own CSS and JS). Never pass anything derived from a request.
export function raw(value) {
  return new SafeHtml(String(value));
}

function render(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}
