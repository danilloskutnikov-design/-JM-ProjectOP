import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { basename, extname, join, normalize, sep } from 'node:path';
import { Session } from './backend.ts';

export interface ServerOptions {
  port?: number;
  uiDir: string;
  assetsDirs: string[];
  dataDir: string;
}
export interface RunningServer {
  url: string;
  port: number;
  token: string;
  session: Session;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webm': 'video/webm', '.mp4': 'video/mp4',
};

function send(res: ServerResponse, code: number, body: string | Buffer, type = 'application/json; charset=utf-8'): void {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const json = (res: ServerResponse, code: number, v: unknown) => send(res, code, JSON.stringify(v));

async function readBody(req: IncomingMessage): Promise<Record<string, any>> {
  let n = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > 1_000_000) throw new Error('request too large');
    chunks.push(c as Buffer);
  }
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}

function serveFile(req: IncomingMessage, res: ServerResponse, path: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) return send(res, 404, 'not found', 'text/plain');
  const size = statSync(path).size;
  const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? parseInt(range[1], 10) : size - parseInt(range[2], 10);
    let end = range[1] && range[2] ? parseInt(range[2], 10) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return void res.end(); }
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    return void createReadStream(path, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  createReadStream(path).pipe(res);
}

/**
 * Local-only HTTP server: serves the UI and a small JSON API.
 *  - binds to 127.0.0.1 only; Host header must be localhost (DNS-rebinding guard);
 *  - API and media require a random per-launch token, so other web pages cannot drive it.
 */
export async function startServer(o: ServerOptions): Promise<RunningServer> {
  const session = new Session({ assetsDirs: o.assetsDirs, dataDir: o.dataDir });
  const token = randomBytes(16).toString('hex');
  const uiRoot = normalize(o.uiDir);

  const server = createServer(async (req, res) => {
    try {
      const host = (req.headers.host ?? '').replace(/:\d+$/, '');
      if (host !== '127.0.0.1' && host !== 'localhost') return send(res, 403, 'forbidden', 'text/plain');
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const authed = url.searchParams.get('t') === token || req.headers['x-token'] === token;

      if (path.startsWith('/api/')) {
        if (!authed) return json(res, 401, { error: 'unauthorized' });
        const body = req.method === 'POST' ? await readBody(req) : {};
        switch (path) {
          case '/api/meta': return json(res, 200, await session.meta());
          case '/api/reload-assets': session.reloadAssets(); return json(res, 200, await session.meta());
          case '/api/plan': return json(res, 200, session.parse(String(body.text ?? '')));
          case '/api/create': return json(res, 200, session.create(body as never));
          case '/api/state': return json(res, 200, session.state());
          case '/api/update': return json(res, 200, session.update(body as never));
          case '/api/rebuild': return json(res, 200, session.rebuild());
          case '/api/frame': return send(res, 200, await session.frame(Number(url.searchParams.get('i') ?? 0)), 'image/png');
          case '/api/preview': return json(res, 200, await session.startPreview());
          case '/api/export': return json(res, 200, await session.startExport(Number(body.scale) === 0.5 ? 0.5 : 1));
          case '/api/job': { const j = session.jobs.get(String(url.searchParams.get('id'))); return j ? json(res, 200, j) : json(res, 404, { error: 'no such job' }); }
          case '/api/save': return json(res, 200, { path: session.save(String(body.name ?? '')) });
          case '/api/projects': return json(res, 200, session.list());
          case '/api/open': return json(res, 200, session.open(String(body.file ?? '')));
          default: return json(res, 404, { error: 'unknown endpoint' });
        }
      }
      if (path.startsWith('/media/')) {
        if (!authed) return send(res, 401, 'unauthorized', 'text/plain');
        const [, , dir, file] = path.split('/');
        if ((dir !== 'tmp' && dir !== 'exports') || !file) return send(res, 404, 'not found', 'text/plain');
        return serveFile(req, res, join(o.dataDir, dir, basename(decodeURIComponent(file))));
      }
      // static UI (no secrets inside)
      const rel = path === '/' ? 'index.html' : path.slice(1);
      const full = normalize(join(uiRoot, rel));
      if (full !== uiRoot && !full.startsWith(uiRoot + sep)) return send(res, 403, 'forbidden', 'text/plain');
      return serveFile(req, res, full);
    } catch (e) {
      json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  await new Promise<void>((resolve) => server.listen(o.port ?? 0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/?t=${token}`, port, token, session,
    close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
