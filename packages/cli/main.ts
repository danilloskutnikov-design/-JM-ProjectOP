import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlan } from '../editor/index.ts';
import { PRESETS } from '../schema/index.ts';
import type { Project, StickerPlacement } from '../schema/index.ts';
import {
  bootstrap, exportBatch, exportMp4, loadAssets, loadProject, newProject, outputSize, rebuild, renderTimeline,
  saveProject, stageStatus, styleOf, verifyProject, DEFAULT_PLACEMENTS,
} from '../project/index.ts';
import type { BuildContext } from '../project/index.ts';
import { Surface } from '../render/index.ts';
import { encodePng } from '../render/png.ts';

const ASSETS_DIR = fileURLToPath(new URL('../../examples/assets', import.meta.url));

function args(argv: string[]): { pos: string[]; opt: Record<string, string> } {
  const pos: string[] = [];
  const opt: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'; } else pos.push(argv[i]);
  }
  return { pos, opt };
}
function ctx(): BuildContext { return { registry: bootstrap(), assets: loadAssets(process.env.PROJECTOP_ASSETS ?? ASSETS_DIR) }; }
function ensureDir(path: string): void { mkdirSync(dirname(path), { recursive: true }); }

function printPlan(text: string, c: BuildContext) {
  const plan = parsePlan(text, c.registry.list('stageType'));
  console.log('Распознанный план:');
  plan.stages.forEach((s, i) => console.log(`  ${i + 1}. ${s.type.padEnd(9)} ${s.targetSec} с`));
  for (const i of plan.issues) console.log(`  ${i.severity === 'error' ? '✗' : '!'} ${i.message}`);
  return plan;
}

function printReport(r: ReturnType<typeof rebuild>) {
  console.log(`Дублей записано: ${r.newTakes.length} (${r.newTakes.join(', ') || '—'}); пересимулированы этапы: ${r.regenerated.join(', ') || '—'}; переиспользованы: ${r.reused.join(', ') || '—'}`);
  for (const f of r.failures) console.log(`  ! ${f.take}: ${f.code} в этапе ${f.stage}: ${f.message}`);
  for (const s of r.timeline.stages) {
    console.log(`  ${s.stageId.padEnd(9)} ${(s.outFrames / 30).toFixed(1)} с (цель ${(s.targetFrames / 30).toFixed(1)}), сырой материал ${(s.naturalTicks / 30).toFixed(1)} с, ускорение действия ×${s.actionSpeed}${s.droppedSpans ? ', отброшено фрагментов: ' + s.droppedSpans : ''}${s.note ? ' — ' + s.note : ''}`);
  }
  for (const n of r.timeline.needsRetake) console.log(`  ✗ этап ${n.stageId}: нужна перегенерация (${n.reason})`);
  console.log(`Итого: ${r.timeline.totalFrames} кадров = ${(r.timeline.totalFrames / 30).toFixed(1)} с`);
}

async function contactSheet(p: Project, c: BuildContext, out: string, every: number, cols = 6, scale = 0.25): Promise<void> {
  const frames: Surface[] = [];
  await renderTimeline(p, c, p.timeline!, { scale, guides: false, shouldRender: (i) => i % every === 0, onFrame(s) { const f = new Surface(s.w, s.h); f.copyFrom(s); frames.push(f); } });
  const w = frames[0].w, h = frames[0].h, rows = Math.ceil(frames.length / cols);
  const sheet = new Surface(w * cols, h * rows);
  frames.forEach((f, n) => {
    const ox = (n % cols) * w, oy = Math.floor(n / cols) * h;
    for (let y = 0; y < h; y++) sheet.data.set(f.data.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * sheet.w + ox) * 4);
  });
  ensureDir(out);
  writeFileSync(out, encodePng(sheet));
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = args(rest);
  const c = ctx();
  switch (cmd) {
    case 'plan': {
      const plan = printPlan(pos[0] ?? '', c);
      process.exit(plan.ok ? 0 : 2);
      break;
    }
    case 'new': {
      const text = opt.text ?? 'Сначала очистка чехла, затем рисование, затем наклейки и показ результата';
      const plan = printPlan(text, c);
      if (!plan.ok) { console.error('План содержит ошибки — исправьте инструкцию.'); process.exit(2); }
      const preset = (opt.preset ?? 'onboard') as 'onboard' | 'paywall';
      if (!PRESETS[preset]) throw new Error(`unknown preset ${preset}`);
      const qz = opt.quiet ? opt.quiet.split(',').map(Number) : null;
      const p = newProject({
        name: opt.name ?? 'untitled', preset, stages: plan.stages, scenarioSource: text, persona: opt.persona, seed: opt.seed ? Number(opt.seed) : 1,
        quietZone: qz ? { x: qz[0], y: qz[1], w: qz[2], h: qz[3] } : null, background: opt.background, drawing: opt.drawing,
        stickers: opt.stickers ? opt.stickers.split(',').map((a, i): StickerPlacement => ({ ...DEFAULT_PLACEMENTS[i % 3], asset: a })) : undefined,
      }, c.assets);
      printReport(rebuild(p, c));
      const out = opt.out ?? 'out/project.json';
      ensureDir(out);
      saveProject(p, out);
      console.log('Проект сохранён:', out);
      break;
    }
    case 'verify': {
      const p = loadProject(pos[0]);
      let bad = 0;
      for (const r of verifyProject(p, c)) {
        console.log(`${r.take}: ${r.checked} (валидных этапов ${r.validStages}) → ${r.ok ? 'OK' : 'РАСХОЖДЕНИЕ'}${r.problems.length ? ' — ' + r.problems.join('; ') : ''}`);
        if (!r.ok) bad++;
      }
      process.exit(bad ? 1 : 0);
      break;
    }
    case 'swap': {
      const p = loadProject(pos[0]);
      if (opt.drawing) p.scene.drawing = opt.drawing;
      if (opt.background) p.scene.background = opt.background;
      if (opt['case-color']) p.scene.caseColor = opt['case-color'];
      if (opt.stickers) p.scene.stickers = opt.stickers.split(',').map((a, i) => ({ ...p.scene.stickers[i % p.scene.stickers.length], asset: a }));
      const st = stageStatus(p, c);
      console.log(st.stale.length ? `Нужна перегенерация этапов: ${st.stale.join(', ')}` : 'Перегенерация не нужна: достаточно перерендерить.');
      saveProject(p, opt.out ?? pos[0]);
      break;
    }
    case 'rebuild': {
      const p = loadProject(pos[0]);
      printReport(rebuild(p, c));
      saveProject(p, opt.out ?? pos[0]);
      break;
    }
    case 'render': {
      const p = loadProject(pos[0]);
      const out = opt.out ?? 'out/video.mp4';
      ensureDir(out);
      const r = await exportMp4(p, c, out, opt.scale ? Number(opt.scale) : 1);
      console.log(`MP4: ${r.path} ${r.width}×${r.height}, ${r.frames} кадров (${r.seconds.toFixed(1)} с), чёрных кадров: ${r.blackFrames}, стык last→first: ${r.seamDiff.toFixed(1)}`);
      if (r.quietZone) console.log(`Зона под крестик: плотность деталей ${r.quietZone.edgeDensity.toFixed(2)} (порог ${r.quietZone.threshold}) → ${r.quietZone.ok ? 'спокойная' : 'ПРИВЛЕКАЕТ ВНИМАНИЕ — замените фон'}`);
      break;
    }
    case 'demo': {
      // End-to-end showcase of the acceptance scenarios (writes to --outdir, default out/demo).
      const dir = opt.outdir ?? 'out/demo';
      const scale = Number(opt.scale ?? 0.5);
      mkdirSync(dir, { recursive: true });
      const text = 'Сначала очистка чехла, затем рисование, затем наклейки и показ результата';
      const plan = printPlan(text, c);
      console.log('\n[1] Onboard: инструкция → автоигра → монтаж → MP4');
      const on = newProject({ name: 'demo-onboard', preset: 'onboard', stages: plan.stages, scenarioSource: text, seed: 1 }, c.assets);
      printReport(rebuild(on, c));
      saveProject(on, `${dir}/onboard.json`);
      let r = await exportMp4(on, c, `${dir}/onboard.mp4`, scale);
      console.log(`    → ${r.path} ${r.width}×${r.height}, ${r.seconds.toFixed(1)} с, чёрных кадров: ${r.blackFrames}`);
      console.log('\n[2] Paywall: зона под крестик, шумный фон → замена фона после монтажа');
      const pw = newProject({ name: 'demo-paywall', preset: 'paywall', stages: plan.stages, scenarioSource: text, seed: 2, persona: 'fast', quietZone: { x: 964, y: 20, w: 140, h: 110 }, background: 'bg-dots' }, c.assets);
      rebuild(pw, c);
      r = await exportMp4(pw, c, `${dir}/paywall-busy-bg.mp4`, scale);
      console.log(`    шумный фон: плотность ${r.quietZone!.edgeDensity.toFixed(2)} → ${r.quietZone!.ok ? 'спокойная' : 'ПРИВЛЕКАЕТ ВНИМАНИЕ'}`);
      pw.scene.background = 'bg-calm';
      const st2 = stageStatus(pw, c);
      console.log(`    замена фона: перегенерация этапов — ${st2.stale.join(', ') || 'не нужна (только рендер)'}`);
      rebuild(pw, c);
      saveProject(pw, `${dir}/paywall.json`);
      r = await exportMp4(pw, c, `${dir}/paywall.mp4`, scale);
      console.log(`    спокойный фон: плотность ${r.quietZone!.edgeDensity.toFixed(2)} → ${r.quietZone!.ok ? 'спокойная' : 'ПРИВЛЕКАЕТ ВНИМАНИЕ'}; ${r.path} ${r.width}×${r.height}`);
      console.log('\n[3] Замена рисунка и наклеек после монтажа (монтажный план сохраняется)');
      on.scene.drawing = 'drawing-flower';
      on.scene.stickers = on.scene.stickers.map((x, i) => ({ ...x, asset: ['sticker-heart', 'sticker-dot', 'sticker-star'][i] }));
      console.log(`    нужна перегенерация: ${stageStatus(on, c).stale.join(', ')}`);
      printReport(rebuild(on, c));
      saveProject(on, `${dir}/onboard-flower.json`);
      r = await exportMp4(on, c, `${dir}/onboard-flower.mp4`, scale);
      console.log(`    → ${r.path} ${r.width}×${r.height}, ${r.seconds.toFixed(1)} с, чёрных кадров: ${r.blackFrames}`);
      break;
    }
    case 'batch': {
      const p = loadProject(pos[0]);
      const variants = JSON.parse(readFileSync(pos[1], 'utf8'));
      const res = await exportBatch(p, c, variants, opt.outdir ?? 'out/batch');
      for (const r of res) console.log(`${r.name}: ${r.export.width}×${r.export.height}, ${(r.export.frames / 30).toFixed(1)} с; пересимулировано: ${r.build.regenerated.join(', ') || '—'}; чёрных кадров: ${r.export.blackFrames}`);
      break;
    }
    case 'preview': {
      const p = loadProject(pos[0]);
      const want = Number(opt.frame ?? 0);
      const scale = opt.scale ? Number(opt.scale) : 0.5;
      const { w, h } = outputSize(p, scale);
      const shot = new Surface(w, h);
      await renderTimeline(p, c, p.timeline!, { scale, guides: opt.guides !== 'false', shouldRender: (i) => i === want, onFrame(s) { shot.copyFrom(s); } });
      const out = opt.out ?? 'out/preview.png';
      ensureDir(out);
      writeFileSync(out, encodePng(shot));
      console.log('Кадр сохранён:', out);
      break;
    }
    case 'contact': {
      const p = loadProject(pos[0]);
      const out = opt.out ?? 'out/contact.png';
      await contactSheet(p, c, out, Number(opt.every ?? 15), Number(opt.cols ?? 6), Number(opt.scale ?? 0.2));
      console.log('Контактный лист:', out);
      break;
    }
    default:
      console.log('Команды: plan "<текст>" | new --preset onboard|paywall --text "..." --out p.json | verify p.json | swap p.json --drawing ID | rebuild p.json | render p.json --out v.mp4 [--scale 1] | preview p.json --frame N | contact p.json | batch p.json variants.json --outdir DIR | demo [--scale 0.5] [--outdir DIR]');
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
