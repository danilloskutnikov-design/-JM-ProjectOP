// Desktop shell: starts the local engine server in-process and shows the UI in a native window.
import { app, BrowserWindow, ipcMain, shell, Menu } from 'electron';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);

if (!app.requestSingleInstanceLock()) app.quit();

/** ffmpeg ships with the app (npm package ffmpeg-static); inside an asar it lives in app.asar.unpacked. */
function ffmpegBinary() {
  try {
    const p = require('ffmpeg-static');
    return p ? p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1') : null;
  } catch {
    return null;
  }
}

let win = null;
let server = null;
let dataDir = null;

async function start() {
  const { startServer } = await import(pathToFileURL(path.join(root, 'dist', 'app', 'server.js')).href);
  const render = await import(pathToFileURL(path.join(root, 'dist', 'packages', 'project', 'render.js')).href);
  const ff = ffmpegBinary();
  if (ff) render.setFfmpegPath(ff);

  dataDir = path.join(app.getPath('documents'), 'JM ProjectOP');
  server = await startServer({
    port: 0,
    uiDir: path.join(root, 'app', 'ui'),
    assetsDirs: [path.join(root, 'examples', 'assets'), path.join(dataDir, 'assets')],
    dataDir,
  });

  ipcMain.handle('show-in-folder', (_e, p) => { if (typeof p === 'string' && p.startsWith(dataDir)) shell.showItemInFolder(p); });
  ipcMain.handle('open-data-dir', () => shell.openPath(dataDir));

  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 980, minHeight: 640, backgroundColor: '#0f1115', title: 'JM ProjectOP',
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${server.port}/`)) e.preventDefault(); });
  await win.loadURL(server.url);
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(start).catch((e) => { console.error(e); app.quit(); });
app.on('window-all-closed', async () => { if (server) await server.close(); app.quit(); });
