// Smoke test of the COMPILED app (dist/), run with plain `node` — the same way Electron runs it.
import http from 'node:http';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { startServer } = await import(pathToFileURL(path.join(root, 'dist', 'app', 'server.js')).href);
const data = mkdtempSync(path.join(tmpdir(), 'pop-dist-'));
const srv = await startServer({ uiDir: path.join(root, 'app', 'ui'), assetsDirs: [path.join(root, 'examples', 'assets')], dataDir: data });
const base = `http://127.0.0.1:${srv.port}`;
const call = async (p, body, token = srv.token) => {
  const r = await fetch(base + '/api/' + p, { method: body ? 'POST' : 'GET', headers: { 'x-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('  ✓', m); };
try {
  const html = await (await fetch(base + '/')).text();
  ok(html.includes('JM ProjectOP'), 'UI отдаётся');
  ok((await fetch(base + '/api/meta')).status === 401, 'API без токена закрыт (401)');
  ok((await fetch(base + '/api/meta', { headers: { 'x-token': 'wrong' } })).status === 401, 'неверный токен отклонён');
  const rawStatus = (hostHeader) => new Promise((resolve) => {
    const rq = http.request({ host: '127.0.0.1', port: srv.port, path: '/api/meta', headers: { host: hostHeader, 'x-token': srv.token } }, (r) => { r.resume(); resolve(r.statusCode); });
    rq.on('error', () => resolve(0)); rq.end();
  });
  ok((await rawStatus('evil.example.com')) === 403, 'чужой Host отклонён (защита от DNS rebinding)');
  ok((await rawStatus(`localhost:${srv.port}`)) === 200, 'localhost разрешён');
  ok((await fetch(base + '/../package.json')).status !== 200 || !(await (await fetch(base + '/../package.json')).text()).includes('jm-projectop'), 'выход за пределы папки UI невозможен');
  const meta = (await call('meta')).json;
  ok(meta.assets.drawing.length >= 2 && meta.personas.length === 3, 'ассеты и персонажи загружены');
  ok(meta.ffmpeg, 'ffmpeg найден: ' + meta.ffmpeg);
  const form = { text: 'Сначала очистка чехла, затем рисование, затем наклейки и показ результата', preset: 'paywall', persona: 'fast', seed: 3, speed: 1, quiet: { x: 964, y: 20, w: 140, h: 110 }, background: 'bg-calm', drawing: 'drawing-heart-star', stickers: ['sticker-star', 'sticker-smile', 'sticker-bolt'], caseColor: '#f4f1ea', loop: 'cut' };
  const c = (await call('create', form)).json;
  ok(c.ok && c.state.timeline.stages.length === 4, 'проект создан из инструкции');
  const bad = (await call('create', { ...form, text: 'очистка, взрыв' })).json;
  ok(bad.ok === false && bad.plan.issues.length > 0, 'ошибочная инструкция отклонена с причинами');
  const job = (await call('preview', {})).json;
  let j = job;
  while (j.status === 'running') { await new Promise((r) => setTimeout(r, 150)); j = (await call('job?id=' + job.id)).json; }
  ok(j.status === 'done' && existsSync(path.join(data, 'tmp', path.basename(j.result.url))), 'предпросмотр отрендерен: ' + j.result?.url);
  const range = await fetch(`${base}${j.result.url}?t=${srv.token}`, { headers: { range: 'bytes=0-99' } });
  ok(range.status === 206 && (await range.arrayBuffer()).byteLength === 100, 'видео отдаётся с поддержкой Range (перемотка)');
  ok((await fetch(`${base}${j.result.url}`)).status === 401, 'видео без токена закрыто');
  const png = await fetch(`${base}/api/frame?i=0&t=${srv.token}`);
  const buf = Buffer.from(await png.arrayBuffer());
  ok(png.status === 200 && buf.slice(1, 4).toString() === 'PNG', 'кадр отдаётся как PNG');
  const u = (await call('update', { drawing: 'drawing-flower' })).json;
  ok(u.stale.join() === 'draw,stickers,reveal', 'замена рисунка помечает этапы: ' + u.stale.join());
  const r2 = (await call('preview', {}));
  ok(r2.status === 400 && /Нужна перегенерация/.test(r2.json.error), 'предпросмотр при устаревших этапах отказывает понятной ошибкой');
  // packaged-app ffmpeg path rewrite used by main.mjs
  ok('C:\\app\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe'.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1').includes('app.asar.unpacked\\node_modules'), 'путь ffmpeg из asar переписывается на unpacked');
} finally { await srv.close(); }
console.log(process.exitCode ? '\nSMOKE: есть ошибки' : '\nSMOKE dist: всё прошло');
