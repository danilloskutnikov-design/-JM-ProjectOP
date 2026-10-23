// Run the app in the default browser (no Electron):  node app/dev.ts
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const srv = await startServer({
  port: Number(process.env.PORT ?? 0),
  uiDir: join(root, 'app', 'ui'),
  assetsDirs: [join(root, 'examples', 'assets'), join(homedir(), 'JM ProjectOP', 'assets')],
  dataDir: process.env.PROJECTOP_DATA ?? join(homedir(), 'JM ProjectOP'),
});
console.log('JM ProjectOP запущен:', srv.url);
console.log('Данные и экспорт:', srv.session.opts.dataDir);
console.log('Закройте это окно, чтобы остановить приложение.');
if (!process.env.NO_OPEN) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', srv.url]] : process.platform === 'darwin' ? ['open', [srv.url]] : ['xdg-open', [srv.url]];
  spawn(cmd[0] as string, cmd[1] as string[], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}
