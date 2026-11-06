// Minimal Chrome DevTools Protocol client for browser tests. No dependencies:
// it launches a locally installed Chrome/Chromium headless and talks to it over
// a WebSocket (built into Node 22+).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function findChrome() {
  const known = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  for (const path of known) if (existsSync(path)) return path;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = spawnSync('which', [name], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return null;
}

export async function launchChrome(chromePath) {
  const profile = mkdtempSync(join(tmpdir(), 'testlearning-chrome-'));
  const child = spawn(
    chromePath,
    ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'], detached: true },
  );

  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Chrome did not report a DevTools port:\n${output}`)), 20_000);
    child.stderr.on('data', (chunk) => {
      output += chunk;
      const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.on('exit', () => reject(new Error(`Chrome exited early:\n${output}`)));
  });

  let target;
  for (let i = 0; i < 50 && !target; i++) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = list.find((t) => t.type === 'page');
    if (!target) await sleep(100);
  }
  if (!target) throw new Error('Chrome has no page target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let nextId = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message));
      else resolve(data.result);
    } else if (data.method) {
      events.push(data);
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(`Evaluation failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}\n${expression}`);
    }
    return result.result.value;
  }

  // Poll an expression until it is truthy.
  async function waitFor(expression, { timeout = 8000 } = {}) {
    const end = Date.now() + timeout;
    for (;;) {
      const value = await evaluate(expression).catch(() => undefined);
      if (value) return value;
      if (Date.now() > end) throw new Error(`Timed out waiting for: ${expression}`);
      await sleep(50);
    }
  }

  async function goto(url) {
    const mark = events.length;
    await send('Page.navigate', { url });
    const end = Date.now() + 15_000;
    while (!events.slice(mark).some((e) => e.method === 'Page.loadEventFired')) {
      if (Date.now() > end) throw new Error(`Page did not load: ${url}`);
      await sleep(25);
    }
  }

  // Console errors, exceptions and CSP violations. Failed network requests (the
  // 400/422 answers some tests provoke on purpose) are not included.
  function problems() {
    const found = [];
    for (const { method, params } of events) {
      if (method === 'Log.entryAdded' && params.entry.level === 'error' && params.entry.source !== 'network') {
        found.push(`${params.entry.source}: ${params.entry.text}`);
      }
      if (method === 'Runtime.exceptionThrown') found.push(`exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`);
      if (method === 'Runtime.consoleAPICalled' && params.type === 'error') found.push(`console.error: ${params.args.map((a) => a.value ?? a.description).join(' ')}`);
    }
    return found;
  }

  async function close() {
    try {
      ws.close();
    } catch {}
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {}
    }
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }

  await send('Page.enable');
  await send('Log.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  return { send, evaluate, waitFor, goto, problems, close };
}
