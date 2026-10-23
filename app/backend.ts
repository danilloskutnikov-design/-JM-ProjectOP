import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePlan } from '../packages/editor/index.ts';
import { PRESETS } from '../packages/schema/index.ts';
import type { Asset, Plan, Project, Rect } from '../packages/schema/index.ts';
import {
  DEFAULT_PLACEMENTS, bootstrap, checkFfmpeg, exportMp4, newProject, rebuild, renderTimeline, stageStatus, validateAssets,
} from '../packages/project/index.ts';
import type { AssetMap, BuildContext, BuildReport } from '../packages/project/index.ts';
import { Surface } from '../packages/render/index.ts';
import { encodePng } from '../packages/render/png.ts';
import { outputSize } from '../packages/project/index.ts';
import { validateProject } from '../packages/schema/index.ts';

export interface SessionOptions { assetsDirs: string[]; dataDir: string }

export interface CreateForm {
  text: string;
  name?: string;
  preset: 'onboard' | 'paywall';
  persona: string;
  seed: number;
  speed: number;
  quiet: Rect | null;
  background: string;
  drawing: string;
  stickers: string[];
  caseColor: string;
  loop: 'off' | 'cut';
}

export interface UpdatePatch {
  name?: string;
  background?: string;
  drawing?: string;
  stickers?: string[];
  caseColor?: string;
  loop?: 'off' | 'cut';
  quiet?: Rect | null;
  /** stage id → target seconds */
  durations?: Record<string, number>;
}

export interface Job {
  id: string;
  kind: 'preview' | 'export';
  status: 'running' | 'done' | 'error';
  progress: number;
  result?: Record<string, unknown>;
  error?: string;
}

const safeName = (s: string) => s.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'project';

export class Session {
  opts: SessionOptions;
  ctx: BuildContext;
  project: Project | null = null;
  version = 0;
  lastReport: BuildReport | null = null;
  jobs: Map<string, Job> = new Map();
  jobSeq = 0;
  running: string | null = null;
  assetWarnings: string[] = [];

  constructor(opts: SessionOptions) {
    this.opts = opts;
    for (const d of ['projects', 'exports', 'tmp']) mkdirSync(join(opts.dataDir, d), { recursive: true });
    this.ctx = { registry: bootstrap(), assets: this.loadAssets() };
  }

  loadAssets(): AssetMap {
    const out: AssetMap = {};
    this.assetWarnings = [];
    for (const dir of this.opts.assetsDirs) {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const a = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Asset;
          const bad = validateAssets(a);
          if (bad) { this.assetWarnings.push(`${f}: ${bad}`); continue; }
          out[a.id] = a;
        } catch (e) { this.assetWarnings.push(`${f}: ${e instanceof Error ? e.message : String(e)}`); }
      }
    }
    return out;
  }
  reloadAssets(): void { this.ctx.assets = this.loadAssets(); }

  async meta() {
    const by = (k: string) => Object.values(this.ctx.assets).filter((a) => a.kind === k).map((a) => ({ id: a.id, name: a.name })).sort((a, b) => a.id.localeCompare(b.id));
    const ff = await checkFfmpeg();
    return {
      assets: { background: by('background'), drawing: by('drawing'), sticker: by('sticker') },
      assetWarnings: this.assetWarnings,
      presets: PRESETS,
      personas: this.ctx.registry.list('botPersona'),
      ffmpeg: ff,
      dataDir: this.opts.dataDir,
      assetsDirs: this.opts.assetsDirs,
    };
  }

  parse(text: string): Plan { return parsePlan(text, this.ctx.registry.list('stageType')); }

  state() {
    const p = this.project;
    if (!p) return { has: false };
    let stale: string[] = [];
    let error: string | undefined;
    try { stale = stageStatus(p, this.ctx).stale; } catch (e) { error = e instanceof Error ? e.message : String(e); }
    return {
      has: true, version: this.version, error,
      name: p.name, preset: p.preset,
      scenario: { source: p.scenario.source, stages: p.scenario.stages, persona: p.scenario.persona, speed: p.scenario.speed },
      scene: p.scene, loop: p.loop, stale, takes: p.takes.length,
      timeline: p.timeline ? { totalFrames: p.timeline.totalFrames, seconds: p.timeline.totalFrames / 30, stages: p.timeline.stages, needsRetake: p.timeline.needsRetake } : null,
      report: this.lastReport ? this.describe(this.lastReport) : [],
    };
  }

  describe(r: BuildReport): string[] {
    const out: string[] = [];
    out.push(`Новых дублей: ${r.newTakes.length}. Пересимулировано: ${r.regenerated.join(', ') || '—'}. Переиспользовано: ${r.reused.join(', ') || '—'}.`);
    for (const f of r.failures) out.push(`⚠ ${f.take}: ${f.code} (этап ${f.stage}) — ${f.message}`);
    for (const s of r.timeline.stages) {
      out.push(`${s.stageId}: ${(s.outFrames / 30).toFixed(1)} с из цели ${(s.targetFrames / 30).toFixed(1)}; сырой материал ${(s.naturalTicks / 30).toFixed(1)} с; ускорение ×${s.actionSpeed}${s.droppedSpans ? `; отброшено фрагментов: ${s.droppedSpans}` : ''}${s.note ? ' — ' + s.note : ''}`);
    }
    for (const n of r.timeline.needsRetake) out.push(`✗ Этап ${n.stageId}: нет годного материала (${n.reason === 'STALE' ? 'устарел после правки' : 'не снят'}).`);
    return out;
  }

  create(f: CreateForm) {
    const plan = this.parse(f.text);
    if (!plan.ok) return { ok: false as const, plan };
    const place = DEFAULT_PLACEMENTS.map((pl, i) => ({ ...pl, asset: f.stickers[i] ?? pl.asset }));
    const p = newProject({
      name: f.name?.trim() || 'Новый проект', preset: f.preset, stages: plan.stages, scenarioSource: f.text, persona: f.persona,
      speed: f.speed, seed: f.seed, quietZone: f.quiet, background: f.background, drawing: f.drawing,
      stickers: place.slice(0, Math.max(1, Math.min(4, f.stickers.length || 3))), caseColor: f.caseColor, loop: f.loop,
    }, this.ctx.assets);
    this.lastReport = rebuild(p, this.ctx);
    this.project = p;
    this.version++;
    return { ok: true as const, plan, state: this.state() };
  }

  update(patch: UpdatePatch) {
    const p = this.project;
    if (!p) throw new Error('Нет открытого проекта');
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.background) p.scene.background = patch.background;
    if (patch.drawing) p.scene.drawing = patch.drawing;
    if (patch.caseColor) p.scene.caseColor = patch.caseColor;
    if (patch.loop) p.loop = patch.loop;
    if (patch.quiet !== undefined) p.preset.quietZone = patch.quiet;
    if (patch.stickers) {
      p.scene.stickers = patch.stickers.map((a, i) => ({ ...(p.scene.stickers[i] ?? DEFAULT_PLACEMENTS[i % DEFAULT_PLACEMENTS.length]), asset: a }));
    }
    if (patch.durations) {
      for (const st of p.scenario.stages) {
        const v = patch.durations[st.id];
        if (typeof v === 'number' && v >= 0.5 && v <= 15) st.targetSec = v;
      }
    }
    this.version++;
    let stale: string[] = [];
    try { stale = stageStatus(p, this.ctx).stale; } catch (e) { return this.state(); }
    // nothing to re-simulate → cheap: just recompute the edit (durations may have changed)
    if (stale.length === 0) this.lastReport = rebuild(p, this.ctx);
    return this.state();
  }

  rebuild() {
    const p = this.project;
    if (!p) throw new Error('Нет открытого проекта');
    this.lastReport = rebuild(p, this.ctx);
    this.version++;
    return this.state();
  }

  async frame(i: number): Promise<Buffer> {
    const p = this.project;
    if (!p || !p.timeline) throw new Error('Нет собранного проекта');
    const { w, h } = outputSize(p, 0.5);
    const shot = new Surface(w, h);
    await renderTimeline(p, this.ctx, p.timeline, { scale: 0.5, guides: false, shouldRender: (n) => n === i, onFrame(s) { shot.copyFrom(s); } });
    return encodePng(shot);
  }

  // ───────────── jobs ─────────────
  startJob(kind: Job['kind'], run: (job: Job) => Promise<Record<string, unknown>>): Job {
    if (this.running) throw new Error('Уже идёт рендер — дождитесь окончания.');
    const job: Job = { id: String(++this.jobSeq), kind, status: 'running', progress: 0 };
    this.jobs.set(job.id, job);
    this.running = job.id;
    run(job).then((res) => { job.result = res; job.status = 'done'; job.progress = 1; }, (e) => { job.error = e instanceof Error ? e.message : String(e); job.status = 'error'; }).finally(() => { this.running = null; });
    return job;
  }

  async ensureRenderable(): Promise<Project> {
    const p = this.project;
    if (!p || !p.timeline) throw new Error('Сначала соберите ролик.');
    const st = stageStatus(p, this.ctx);
    if (st.stale.length) throw new Error(`Нужна перегенерация этапов: ${st.stale.join(', ')}. Нажмите «Пересобрать».`);
    if (!(await checkFfmpeg())) throw new Error('Не найден ffmpeg: без него нельзя сделать видео. Установите его или используйте установщик приложения (ffmpeg внутри).');
    return p;
  }

  async startPreview(): Promise<Job> {
    const p = await this.ensureRenderable();
    const v = this.version;
    const file = `preview-${v}.webm`;
    const path = join(this.opts.dataDir, 'tmp', file);
    if (existsSync(path)) {
      const job: Job = { id: String(++this.jobSeq), kind: 'preview', status: 'done', progress: 1, result: { url: `/media/tmp/${file}`, version: v } };
      this.jobs.set(job.id, job);
      return job;
    }
    return this.startJob('preview', async (job) => {
      const r = await exportMp4(p, this.ctx, path, 0.5, { codec: 'vp8', onProgress: (d, t) => { job.progress = d / t; } });
      return { url: `/media/tmp/${file}`, version: v, frames: r.frames, blackFrames: r.blackFrames, quietZone: r.quietZone };
    });
  }

  async startExport(scale: number): Promise<Job> {
    const p = await this.ensureRenderable();
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const file = `${safeName(p.name)}_${p.preset.id}_${scale === 1 ? 'full' : 'x' + scale}_${stamp}.mp4`;
    const path = join(this.opts.dataDir, 'exports', file);
    return this.startJob('export', async (job) => {
      const r = await exportMp4(p, this.ctx, path, scale, { codec: 'h264', onProgress: (d, t) => { job.progress = d / t; } });
      return { url: `/media/exports/${file}`, path, file, width: r.width, height: r.height, frames: r.frames, seconds: r.seconds, blackFrames: r.blackFrames, seamDiff: r.seamDiff, quietZone: r.quietZone };
    });
  }

  // ───────────── projects ─────────────
  save(name: string): string {
    const p = this.project;
    if (!p) throw new Error('Нет открытого проекта');
    p.name = name.trim() || p.name;
    const path = join(this.opts.dataDir, 'projects', safeName(p.name) + '.json');
    writeFileSync(path, JSON.stringify(p) + '\n');
    return path;
  }
  list(): Array<{ file: string; name: string }> {
    const dir = join(this.opts.dataDir, 'projects');
    return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
      let name = f.replace(/\.json$/, '');
      try { name = (JSON.parse(readFileSync(join(dir, f), 'utf8')) as Project).name || name; } catch { /* keep file name */ }
      return { file: f, name };
    });
  }
  open(file: string) {
    if (file !== file.replace(/[\\/]/g, '')) throw new Error('bad file name');
    const p = JSON.parse(readFileSync(join(this.opts.dataDir, 'projects', file), 'utf8')) as Project;
    const errs = validateProject(p);
    if (errs.length) throw new Error('Проект повреждён: ' + errs.join('; '));
    this.project = p;
    this.lastReport = null;
    this.version++;
    return this.state();
  }
}
