import { spawn } from 'node:child_process';
import { hashBytes } from '../core/index.ts';
import type { Project, Timeline } from '../schema/index.ts';
import { TakePlayer } from '../session/index.ts';
import { Surface, renderFrame, frameDiff, meanLuma, quietZoneReport } from '../render/index.ts';
import type { RenderStyle, QuietZoneReport } from '../render/index.ts';
import { buildGameConfig } from './project.ts';
import type { BuildContext } from './build.ts';
import { stageStatus } from './build.ts';
import type { BackgroundData } from '../schema/index.ts';

export interface RenderOpts {
  /** Output scale relative to the preset's native size (1 = 1124 px wide). */
  scale?: number;
  /** Safe-zone guides: preview only. Export never passes true. */
  guides?: boolean;
  shouldRender?: (frame: number) => boolean;
  onFrame: (s: Surface, index: number) => Promise<void> | void;
}

export function outputSize(p: Project, scale: number): { w: number; h: number } {
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return { w: even(p.preset.width * scale), h: even(p.preset.height * scale) };
}

export function styleOf(p: Project, ctx: BuildContext): RenderStyle {
  const bg = ctx.assets[p.scene.background];
  if (!bg || bg.kind !== 'background') throw new Error(`background asset "${p.scene.background}" not found`);
  return { caseColor: p.scene.caseColor, background: bg.data as unknown as BackgroundData, quietZone: p.preset.quietZone };
}

export async function renderTimeline(p: Project, ctx: BuildContext, tl: Timeline, o: RenderOpts): Promise<{ w: number; h: number; frames: number }> {
  const st = stageStatus(p, ctx);
  if (st.stale.length) throw new Error(`cannot render: stages need regeneration: ${st.stale.join(', ')} (run rebuild)`);
  const cfg = buildGameConfig(p, ctx.assets);
  const style = styleOf(p, ctx);
  const { w, h } = outputSize(p, o.scale ?? 1);
  const surface = new Surface(w, h);
  const players = new Map<string, TakePlayer>();
  let idx = 0;
  for (const c of tl.clips) {
    let pl = players.get(c.takeId);
    if (!pl) {
      const take = p.takes.find((t) => t.id === c.takeId)!;
      pl = new TakePlayer(cfg, ctx.registry, p.takes, take);
      players.set(c.takeId, pl);
    }
    for (let j = 0; j < c.outFrames; j++) {
      const tick = c.inTick + Math.floor((j * (c.outTick - c.inTick)) / c.outFrames);
      const g = pl.advanceTo(tick);
      if (!o.shouldRender || o.shouldRender(idx)) {
        renderFrame(surface, g, style, { guides: o.guides ?? false });
        await o.onFrame(surface, idx);
      }
      idx++;
    }
  }
  return { w, h, frames: idx };
}

// ───────────── ffmpeg ─────────────
export interface Mp4Writer { write(s: Surface): Promise<void>; finish(): Promise<void> }

let FFMPEG = 'ffmpeg';
/** The desktop app points this at the ffmpeg binary it ships with. */
export function setFfmpegPath(p: string): void { FFMPEG = p; }
export function getFfmpegPath(): string { return FFMPEG; }

/** Resolves with the ffmpeg version line, or null if ffmpeg cannot be started. */
export function checkFfmpeg(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const pr = spawn(FFMPEG, ['-version']);
      let out = '';
      pr.stdout.on('data', (d: Buffer) => { out += d.toString(); });
      pr.on('error', () => resolve(null));
      pr.on('close', (code) => resolve(code === 0 ? out.split('\n')[0] : null));
    } catch { resolve(null); }
  });
}

export type VideoCodec = 'h264' | 'vp8';

/** h264 → deliverable MP4. vp8 (webm) → fast preview that every Chromium can play without proprietary codecs. */
export function startMp4(path: string, w: number, h: number, fps = 30, codec: VideoCodec = 'h264'): Mp4Writer {
  const enc = codec === 'h264'
    ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
    : ['-c:v', 'libvpx', '-b:v', '3M', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p'];
  const proc = spawn(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-framerate', String(fps), '-i', '-',
    ...enc, '-r', String(fps), '-an', path,
  ]);
  let err = '';
  proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
  proc.stdin.on('error', () => {});
  const done = new Promise<void>((resolve, reject) => {
    proc.on('error', (e) => reject(new Error(`cannot start ffmpeg (${FFMPEG}): ${e.message}`)));
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${err}`))));
  });
  done.catch(() => {});
  const closed = new Promise<void>((r) => { proc.once('close', () => r()); });
  return {
    async write(s: Surface) {
      const buf = Buffer.from(s.data.buffer, s.data.byteOffset, s.data.byteLength);
      if (!proc.stdin.write(buf)) await Promise.race([new Promise<void>((r) => { proc.stdin.once('drain', () => r()); }), closed]);
    },
    async finish() { proc.stdin.end(); await done; },
  };
}

export interface ExportReport {
  path: string;
  width: number;
  height: number;
  frames: number;
  seconds: number;
  blackFrames: number;
  /** Loop seam: mean abs difference between the last and the first frame (cut loop). */
  seamDiff: number;
  quietZone: QuietZoneReport | null;
  frameHashes: string[];
}

/** Render the timeline to MP4 (H.264, yuv420p, 30 FPS, no audio) and run delivery QA on the way. */
export async function exportMp4(p: Project, ctx: BuildContext, path: string, scale = 1, opts: { codec?: VideoCodec; onProgress?: (done: number, total: number) => void } = {}): Promise<ExportReport> {
  if (!p.timeline) throw new Error('project has no timeline (run rebuild)');
  const { w, h } = outputSize(p, scale);
  const mp4 = startMp4(path, w, h, 30, opts.codec ?? 'h264');
  let black = 0;
  let first: Surface | null = null;
  let last: Surface | null = null;
  let qz: QuietZoneReport | null = null;
  const hashes: string[] = [];
  const res = await renderTimeline(p, ctx, p.timeline, {
    scale,
    guides: false,
    async onFrame(s, i) {
      await mp4.write(s);
      opts.onProgress?.(i + 1, p.timeline!.totalFrames);
      hashes.push(hashBytes(s.data));
      if (meanLuma(s) < 8) black++;
      if (i === 0) { first = new Surface(w, h); first.copyFrom(s); }
      if (i === 0 && p.preset.quietZone) qz = quietZoneReport(s, p.preset.quietZone, w / p.preset.width);
      if (!last) last = new Surface(w, h);
      last.copyFrom(s);
    },
  });
  await mp4.finish();
  const seam = first && last ? frameDiff(first, last) : 0;
  return {
    path, width: res.w, height: res.h, frames: res.frames, seconds: res.frames / 30,
    blackFrames: black, seamDiff: seam, quietZone: qz, frameHashes: hashes,
  };
}
