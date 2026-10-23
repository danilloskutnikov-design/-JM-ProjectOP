// End-to-end UI test in a real Chromium (needs `playwright` installed). Usage: node scripts/e2e-ui.ts [shots-dir]
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../app/server.ts';

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const chromium = (pw.chromium ?? pw.default.chromium) as any;
const root = fileURLToPath(new URL('..', import.meta.url));
const shots = process.argv[2] ?? join(root, 'out', 'ui');
mkdirSync(shots, { recursive: true });
const data = mkdtempSync(join(tmpdir(), 'pop-ui-'));
const srv = await startServer({ uiDir: join(root, 'app', 'ui'), assetsDirs: [join(root, 'examples', 'assets')], dataDir: data });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push('pageerror: ' + e.message));
page.on('console', (m: any) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
let step = 0;
const ok = (c: unknown, msg: string) => { if (!c) throw new Error('FAIL: ' + msg); console.log('  ✓ ' + msg); };
const shot = (n: string) => page.screenshot({ path: join(shots, `${String(++step).padStart(2, '0')}-${n}.png`) });
const previewReady = (ver?: number) => page.waitForFunction(() => { const v = document.getElementById('vid') as HTMLVideoElement; return !v.hidden && v.readyState >= 2 && v.videoWidth > 0 && v.dataset.version === document.body.dataset.version; }, null, { timeout: 90000 });
const statusText = () => page.textContent('#status');

try {
  await page.goto(srv.url);
  await page.waitForFunction(() => document.querySelectorAll('#selBg option').length > 0);
  await page.waitForFunction(() => (document.getElementById('planChips')!.textContent || '').includes('Очистка'));
  ok((await page.textContent('#planChips'))?.includes('Очистка'), 'сценарий по умолчанию разобран в чипы этапов');
  await shot('start');

  // broken instruction is flagged and build is blocked
  await page.fill('#text', 'очистка, взрыв, показ результата');
  await page.waitForFunction(() => document.querySelectorAll('#planIssues li').length > 0);
  ok(await page.isDisabled('#btnBuild'), 'кнопка «Собрать» заблокирована при ошибке в инструкции');
  ok((await page.textContent('#planIssues'))?.includes('взрыв'), 'ошибка называет нераспознанную фразу');
  await shot('bad-plan');
  await page.fill('#text', 'Сначала очистка чехла, затем рисование, затем наклейки и показ результата');
  await page.waitForFunction(() => !(document.getElementById('btnBuild') as HTMLButtonElement).disabled);

  // build → timeline + video preview
  await page.click('#btnBuild');
  await previewReady();
  ok((await page.locator('#tlBar .blk').count()) === 4, 'на таймлайне 4 этапа');
  ok(!(await page.isDisabled('#btnExport')), 'экспорт доступен после сборки');
  const dims = await page.evaluate(() => { const v = document.getElementById('vid') as HTMLVideoElement; return [v.videoWidth, v.videoHeight, v.duration]; });
  ok(dims[0] === 562 && dims[1] === 562, `предпросмотр ${dims[0]}×${dims[1]} (половина Onboard)`);
  ok(dims[2] > 10 && dims[2] < 12.5, `длительность предпросмотра ${dims[2].toFixed(1)} с`);
  await shot('built');

  // guides overlay
  const safe = await page.evaluate(() => { const f = document.getElementById('frame')!.getBoundingClientRect(); const s = document.getElementById('safe')!.getBoundingClientRect(); return [(s.left - f.left) / f.width, (s.width) / f.width, s.height / f.height]; });
  ok(Math.abs(safe[0] - 150 / 1124) < 0.01 && Math.abs(safe[1] - 824 / 1124) < 0.01, 'направляющие безопасной зоны стоят по спецификации (150 px / 824 px)');
  await page.uncheck('#guides');
  ok(await page.isHidden('#safe'), 'направляющие выключаются');
  await page.check('#guides');

  // asset swap that needs no re-simulation
  await page.selectOption('#selBg', 'bg-dots');
  await page.waitForFunction(() => /Изменения применены/.test(document.getElementById('status')!.textContent || ''));
  ok(await page.isHidden('#banner'), 'смена фона не требует пересъёмки (баннера нет)');
  await previewReady();

  // asset swap that does
  await page.selectOption('#selDrawing', 'drawing-flower');
  await page.waitForSelector('#banner:not([hidden]) #btnRebuild');
  const banner = await page.textContent('#banner');
  ok(banner?.includes('Рисование') && banner?.includes('Наклейки') && banner?.includes('Показ') && !banner?.includes('Очистка'), 'баннер называет затронутые этапы (без очистки)');
  ok(await page.isDisabled('#btnExport'), 'экспорт заблокирован, пока этапы устарели');
  ok((await page.locator('#tlBar .blk.stale').count()) === 3, 'устаревшие этапы подсвечены на таймлайне');
  await shot('stale');
  await page.click('#btnRebuild');
  await page.waitForSelector('#banner', { state: 'hidden' });
  await page.waitForFunction(() => document.querySelectorAll('#tlBar .blk.stale').length === 0);
  ok((await page.textContent('#report'))?.includes('Переиспользовано: clean'), 'отчёт: очистка переиспользована');
  await previewReady();

  // durations
  const before = await page.textContent('#tlTotal');
  await page.fill('#tlBar input[data-stage=clean]', '5');
  await page.dispatchEvent('#tlBar input[data-stage=clean]', 'change');
  await page.waitForFunction((b: string | null) => document.getElementById('tlTotal')!.textContent !== b, before);
  ok(true, `длительность этапа меняется, итог пересчитан (${before} → ${await page.textContent('#tlTotal')})`);
  await previewReady();
  await shot('retimed');

  // save / open
  await page.click('#btnSave');
  await page.fill('#dlgInput', 'Тест UI');
  await page.click('#dlgMenu button.primary');
  await page.waitForFunction(() => /Сохранено/.test(document.getElementById('status')!.textContent || ''));
  ok(existsSync(join(data, 'projects', 'Тест_UI.json')), 'проект сохранён в папку данных');

  // export (half size to keep the test fast)
  await page.click('#btnExport');
  await page.check('input[name=sc][value="0.5"]');
  await page.click('#dlgMenu button.primary');
  await page.waitForFunction(() => /Готово:/.test(document.getElementById('expInfo')?.textContent || ''), null, { timeout: 120000 });
  const info = await page.textContent('#expInfo');
  const file = (info!.match(/((?:[A-Za-z]:\\|\/)[^\s]*?\.mp4)/) ?? [])[1];
  ok(file && existsSync(file), 'MP4 создан: ' + file);
  const pr = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,r_frame_rate', '-of', 'csv=p=0', file!]).stdout.toString().trim();
  ok(pr === 'h264,562,562,30/1', 'ffprobe: ' + pr);
  await shot('export-done');
  await page.keyboard.press('Escape');

  // paywall + quiet zone flow
  await page.click('#presetSeg label:nth-child(2)');
  await page.check('#quietOn');
  await page.selectOption('#selBg', 'bg-dots');
  await page.click('#btnBuild');
  const paywallPreview = (re: RegExp) => page.waitForFunction((src: string) => {
    const v = document.getElementById('vid') as HTMLVideoElement;
    return v.videoHeight === 500 && v.dataset.version === document.body.dataset.version && new RegExp(src).test(document.getElementById('chips')?.textContent || '');
  }, re.source, { timeout: 120000 });
  await paywallPreview(/зона крестика/);
  ok((await page.textContent('#chips'))?.includes('привлекает внимание'), 'шумный фон: зона под крестик помечена как привлекающая внимание');
  await shot('paywall-busy');
  await page.selectOption('#selBg', 'bg-calm');
  await paywallPreview(/спокойная/);
  ok(true, 'после замены фона зона крестика спокойная — без пересъёмки');
  await shot('paywall-calm');
  const pd = await page.evaluate(() => { const v = document.getElementById('vid') as HTMLVideoElement; return [v.videoWidth, v.videoHeight]; });
  ok(pd[0] === 562 && pd[1] === 500, `paywall ${pd[0]}×${pd[1]}`);

  // open project dialog lists the saved one
  await page.click('#btnOpen');
  await page.waitForFunction(() => (document.getElementById('dlgBody')!.textContent || '').includes('Тест UI'), null, { timeout: 10000 }).catch(() => {});
  ok((await page.textContent('#dlgBody'))?.includes('Тест UI'), 'в диалоге «Открыть» виден сохранённый проект');
  await page.click('#dlgBody button');
  await page.waitForFunction(() => (document.getElementById('projName') as HTMLInputElement).value === 'Тест UI');
  ok(true, 'проект открывается обратно');

  ok(errors.length === 0, 'нет ошибок в консоли браузера' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log('\nUI E2E: всё прошло');
} catch (e) {
  await shot('FAILED').catch(() => {});
  console.error(String(e), errors.length ? '\nconsole: ' + errors.join('\n') : '');
  process.exitCode = 1;
} finally {
  await browser.close();
  await srv.close();
}
