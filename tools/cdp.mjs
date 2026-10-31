// Edge sans écran, piloté par le protocole DevTools : pages, contextes isolés (un contexte = un appareil), captures.
// Aucune dépendance : WebSocket et fetch de Node 22.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
export const BASE = process.env.RIME_URL || 'http://localhost:8080';
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function waitFor(label, fn, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Délai dépassé : ${label}`);
    await sleep(100);
  }
}

class Connection {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();   // sessionId → Map(event → [fn])
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p?.reject(new Error(`${p.method} : ${m.error.message}`));
        else p?.resolve(m.result);
      } else {
        (this.handlers.get(m.sessionId || '')?.get(m.method) || []).forEach(fn => fn(m.params));
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  on(sessionId, event, fn) {
    if (!this.handlers.has(sessionId)) this.handlers.set(sessionId, new Map());
    const m = this.handlers.get(sessionId);
    m.set(event, [...(m.get(event) || []), fn]);
  }
}

export class Page {
  constructor(conn, sessionId) {
    this.conn = conn;
    this.sessionId = sessionId;
    this.errors = [];
    conn.on(sessionId, 'Runtime.exceptionThrown', p => this.errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text));
    conn.on(sessionId, 'Runtime.consoleAPICalled', p => {
      if (p.type === 'error') this.errors.push(p.args.map(a => a.value ?? a.description).join(' '));
    });
    // Blocages CSP, ressources introuvables… (hors requêtes bloquées exprès par le test)
    conn.on(sessionId, 'Log.entryAdded', ({ entry }) => {
      if (entry.level === 'error' && !/ERR_BLOCKED_BY_CLIENT/.test(entry.text) && !/favicon.ico/.test(entry.url || '')) this.errors.push(`${entry.text}${entry.url ? ` (${entry.url})` : ''}`);
    });
  }
  send(method, params) { return this.conn.send(method, params, this.sessionId); }

  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`Dans la page : ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n${expr.slice(0, 200)}`);
    return r.result.value;
  }

  async goto(url) {
    const loaded = new Promise(r => this.conn.on(this.sessionId, 'Page.loadEventFired', r));
    await this.send('Page.navigate', { url });
    await loaded;
  }

  // Le stockage d'un appareil, posé depuis une page neutre du même domaine : l'app resauve son brouillon au pagehide
  async seed(storage, path = '/') {
    await this.goto(`${BASE}/style.css`);
    await this.eval(`localStorage.clear(); Object.entries(${JSON.stringify(storage)}).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)))`);
    await this.goto(`${BASE}${path}`);
  }

  async size(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
  }

  async screenshot(path) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(data, 'base64'));
  }
}

export async function launch() {
  const dir = mkdtempSync(join(tmpdir(), 'rime-edge-'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let info;
  for (let i = 0; i < 100 && !info; i++) {
    try { info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(150); }
  }
  if (!info) throw new Error('Edge ne répond pas');
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const conn = new Connection(ws);

  return {
    // Un contexte a son propre stockage : c'est un autre appareil
    async context() {
      return (await conn.send('Target.createBrowserContext', { disposeOnDetach: true })).browserContextId;
    },
    // init : script posé avant ceux de la page ; blocked : adresses refusées (Google, YouTube…)
    async page({ context, init = '', blocked = [], bypassCsp = false } = {}) {
      const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank', ...(context && { browserContextId: context }) });
      const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
      const page = new Page(conn, sessionId);
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      await page.send('Log.enable');
      await page.send('Network.enable');
      if (blocked.length) await page.send('Network.setBlockedURLs', { urls: blocked });
      if (bypassCsp) await page.send('Page.setBypassCSP', { enabled: true });
      if (init) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: init });
      await page.size(1440, 900);
      return page;
    },
    async close() {
      ws.close();
      proc.kill();
      await sleep(400);
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}
