// Faux Google Drive (API v3, le sous-ensemble dont Rime se sert), en mémoire, partagé par tous les appareils simulés.
// Les pages y sont redirigées par fakeGoogle() : fetch réécrit, Google Identity Services remplacé par un bouchon.
import { createServer } from 'node:http';

const TOKEN = 'fake-token';

export async function startFakeDrive() {
  const files = new Map();
  let seq = 0, lastHit = 0, hits = 0;
  const now = () => new Date(Date.now() + seq).toISOString();
  const meta = ({ content, ...f }) => f;
  const touch = f => { f.version = String(Number(f.version) + 1); f.modifiedTime = now(); };

  function create(m, content = '') {
    const id = `file${++seq}`;
    const f = {
      id, name: m.name || 'Sans nom', mimeType: m.mimeType || 'text/plain', parents: m.parents || ['root'],
      appProperties: { ...(m.appProperties || {}) }, description: m.description || '', trashed: false,
      version: '1', createdTime: now(), modifiedTime: now(), content,
    };
    files.set(id, f);
    return f;
  }

  function update(f, m, query, content) {
    for (const k of ['name', 'description', 'trashed']) if (k in m) f[k] = m[k];
    if (m.appProperties) {
      for (const [k, v] of Object.entries(m.appProperties)) v === null ? delete f.appProperties[k] : f.appProperties[k] = v;
    }
    const add = query.get('addParents'), remove = query.get('removeParents');
    if (remove) f.parents = f.parents.filter(p => !remove.split(',').includes(p));
    if (add) f.parents = [...new Set([...f.parents, ...add.split(',')])];
    if (content !== undefined) f.content = content;
    touch(f);
  }

  // q : clauses reliées par « and » — mimeType = '…', trashed = false, '<id>' in parents
  function matches(f, q) {
    return q.split(' and ').every(c => {
      let m;
      if ((m = c.match(/^mimeType = '(.+)'$/))) return f.mimeType === m[1];
      if (c === 'trashed = false') return !f.trashed;
      if ((m = c.match(/^'(.+)' in parents$/))) return f.parents.includes(m[1]);
      throw new Error(`q non géré : ${c}`);
    });
  }

  function multipart(body, type) {
    const boundary = type.match(/boundary=(.+)$/)[1];
    const parts = body.split(`--${boundary}`).slice(1, -1).map(p => p.replace(/^\r\n/, '').replace(/\r\n$/, ''));
    const [m, content] = parts.map(p => p.slice(p.indexOf('\r\n\r\n') + 4));
    return { meta: JSON.parse(m), content };
  }

  async function handle(req, url, body) {
    const path = url.pathname, q = url.searchParams;
    if (path === '/__state') return [200, [...files.values()]];
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return [401, { error: 'unauthorized' }];
    hits++;
    lastHit = Date.now();
    if (path === '/drive/v3/about') return [200, { user: { emailAddress: 'test@example.com' } }];
    let m;
    if ((m = path.match(/^\/(upload\/)?drive\/v3\/files\/?([^/]*)$/))) {
      const upload = !!m[1], id = m[2];
      if (!id && req.method === 'GET') {
        let list = [...files.values()].filter(f => matches(f, q.get('q') || 'trashed = false'));
        if (q.get('orderBy') === 'createdTime') list.sort((a, b) => a.createdTime.localeCompare(b.createdTime));
        return [200, { files: list.map(meta) }];
      }
      if (!id && req.method === 'POST') {
        const { meta: mt, content } = upload ? multipart(body, req.headers['content-type']) : { meta: JSON.parse(body) };
        return [200, meta(create(mt, content))];
      }
      const f = files.get(id);
      if (!f) return [404, { error: 'notFound' }];
      if (req.method === 'GET') return q.get('alt') === 'media' ? [200, f.content, 'text/plain'] : [200, meta(f)];
      if (req.method === 'PATCH') {
        const { meta: mt, content } = upload ? multipart(body, req.headers['content-type']) : { meta: JSON.parse(body || '{}') };
        update(f, mt, q, content);
        return [200, meta(f)];
      }
    }
    return [400, { error: `route non gérée : ${req.method} ${path}` }];
  }

  const server = createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let status, out, type = 'application/json';
      try {
        [status, out, type = type] = await handle(req, new URL(req.url, 'http://x'), body);
      } catch (e) {
        [status, out] = [500, { error: e.message }];
      }
      res.writeHead(status, { ...cors, 'Content-Type': `${type}; charset=utf-8` });
      res.end(typeof out === 'string' ? out : JSON.stringify(out));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  return {
    url: `http://127.0.0.1:${port}/`,
    files,
    texts: () => [...files.values()].filter(f => f.mimeType === 'text/plain' && !f.trashed && f.appProperties.rimeId && !f.appProperties.rimeVersion),
    // Ce que Drive fait de lui-même : un nouveau numéro de version sans changer le contenu
    bump(id) { touch(files.get(id)); },
    edit(id, change) { update(files.get(id), change, new URLSearchParams(), change.content); },
    // Plus aucune requête depuis `quiet` ms : la synchro est finie
    async idle(quiet = 700, timeout = 20000) {
      const start = Date.now(), before = hits;
      for (;;) {
        await new Promise(r => setTimeout(r, 100));
        if (Date.now() - start > timeout) throw new Error('Le faux Drive reçoit encore des requêtes');
        if (Date.now() - lastHit > quiet && (hits > before || Date.now() - start > quiet + 1800)) return;
      }
    },
    close: () => server.close(),
  };
}

// Script posé avant ceux de Rime : les appels à l'API Drive vont au faux Drive, la fenêtre Google répond tout de suite
export function fakeGoogle(driveUrl) {
  return `(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => realFetch(typeof input === 'string' ? input.replace('https://www.googleapis.com/', ${JSON.stringify(driveUrl)}) : input, init);
    window.__auth = 0;
    window.google = { accounts: { oauth2: {
      initTokenClient: cfg => ({ requestAccessToken() { window.__auth++; setTimeout(() => cfg.callback({ access_token: ${JSON.stringify(TOKEN)}, expires_in: 3600 }), 20); } }),
      hasGrantedAllScopes: () => true,
      revoke: (t, cb) => cb && cb(),
    } } };
  })();`;
}

export const GOOGLE_BLOCKED = ['*accounts.google.com*', '*youtube.com*', '*ytimg.com*', '*youtube-nocookie.com*'];
export const validToken = () => ({ value: TOKEN, exp: Date.now() + 3_000_000 });
export const expiredToken = () => ({ value: TOKEN, exp: Date.now() - 1000 });
