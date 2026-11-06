// Shared helper: start the real Worker with `wrangler dev` on free ports, with a
// fresh local D1 database in a temp directory. Nothing touches Cloudflare.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WRANGLER = fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startServer() {
  const stateDir = mkdtempSync(join(tmpdir(), 'testlearning-e2e-'));
  const port = await freePort();
  const inspectorPort = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let log = '';

  const child = spawn(
    process.execPath,
    [WRANGLER, 'dev', '--port', String(port), '--ip', '127.0.0.1', '--inspector-port', String(inspectorPort), '--persist-to', stateDir],
    { cwd: ROOT, detached: true, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' } },
  );
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));

  async function stop() {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {}
    }
    await sleep(500);
    rmSync(stateDir, { recursive: true, force: true });
  }

  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const res = await fetch(`${base}/guide`);
      if (res.status === 200) break;
    } catch {}
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`wrangler dev did not start:\n${log}`);
    }
    await sleep(300);
  }

  return { base, stop };
}
