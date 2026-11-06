// Guards against invisible or bidirectional-override characters hiding in source
// ("Trojan Source"). Write them as \uXXXX escapes instead. The zero-width joiner
// (U+200D) is allowed because emoji sequences need it.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIRS = ['src', 'test', 'public'];
const EXTENSIONS = /\.(js|mjs|json|jsonc|html|md)$/;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (EXTENSIONS.test(name)) yield path;
  }
}

const isInvisible = (cp) =>
  (cp >= 0x80 && cp <= 0x9f) ||
  (cp >= 0x200b && cp <= 0x200f && cp !== 0x200d) ||
  (cp >= 0x2028 && cp <= 0x202f) ||
  (cp >= 0x2060 && cp <= 0x206f) ||
  cp === 0xfeff ||
  (cp >= 0xe0000 && cp <= 0xe007f) ||
  (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d);

describe('source hygiene', () => {
  for (const dir of DIRS) {
    for (const file of files(join(ROOT, dir))) {
      it(`${file.slice(ROOT.length)} has no hidden characters`, () => {
        const found = [];
        const text = readFileSync(file, 'utf8');
        let line = 1;
        for (const ch of text) {
          const cp = ch.codePointAt(0);
          if (ch === '\n') line++;
          if (isInvisible(cp)) found.push(`U+${cp.toString(16).toUpperCase()} on line ${line}`);
        }
        assert.deepEqual(found, []);
      });
    }
  }
});
