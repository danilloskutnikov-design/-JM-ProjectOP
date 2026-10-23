'use strict';
const T = new URLSearchParams(location.search).get('t') || '';
const $ = (id) => document.getElementById(id);
const DEFAULT_TEXT = 'Сначала очистка чехла, затем рисование, затем наклейки и показ результата';
const STAGE_NAMES = { clean: 'Очистка', draw: 'Рисование', stickers: 'Наклейки', reveal: 'Показ результата' };

let meta = null;
let state = { has: false };
let previewVersion = -1;
let previewTimer = null;
let jobRunning = false;
let planOk = false;

async function api(path, body) {
  const r = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-token': T, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = r.headers.get('content-type') || '';
  const j = ct.includes('json') ? await r.json() : null;
  if (!r.ok) throw new Error((j && j.error) || r.statusText);
  return j;
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const status = (s) => { $('status').textContent = s; };
const fmtSec = (f) => (f / 30).toFixed(1) + ' с';

// ───────────── dialogs ─────────────
function showDialog(title, bodyHtml, buttons) {
  const dlg = $('dlg');
  $('dlgTitle').textContent = title;
  $('dlgBody').innerHTML = bodyHtml;
  $('dlgMenu').innerHTML = '';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.textContent = b.label; el.value = b.value; el.type = b.noClose ? 'button' : 'submit';
    if (b.primary) el.className = 'primary';
    if (b.onClick) el.addEventListener('click', b.onClick);
    $('dlgMenu').appendChild(el);
  }
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true });
    dlg.returnValue = 'cancel';
    dlg.showModal();
  });
}
async function askText(title, value) {
  const r = await showDialog(title, `<input type="text" id="dlgInput" value="${value.replace(/"/g, '&quot;')}">`, [
    { label: 'Отмена', value: 'cancel' }, { label: 'Сохранить', value: 'ok', primary: true }]);
  return r === 'ok' ? $('dlgInput').value : null;
}

// ───────────── form ─────────────
const stickerSelects = () => [$('selSt0'), $('selSt1'), $('selSt2')];
function fillSelect(sel, items, value) {
  sel.innerHTML = items.map((a) => `<option value="${a.id}">${a.name}</option>`).join('');
  if (value && items.some((a) => a.id === value)) sel.value = value;
}
function quietRect() {
  if (!$('quietOn').checked) return null;
  return { x: +$('qx').value, y: +$('qy').value, w: +$('qw').value, h: +$('qh').value };
}
function collectForm() {
  return {
    text: $('text').value, name: $('projName').value,
    preset: document.querySelector('input[name=preset]:checked').value,
    persona: $('selPersona').value, seed: +$('seed').value || 0, speed: +$('speed').value || 1,
    quiet: quietRect(), background: $('selBg').value, drawing: $('selDrawing').value,
    stickers: stickerSelects().map((s) => s.value), caseColor: $('caseColor').value, loop: $('selLoop').value,
  };
}

// ───────────── plan ─────────────
const refreshPlan = debounce(async () => {
  try {
    const plan = await api('plan', { text: $('text').value });
    planOk = plan.ok;
    $('planChips').innerHTML = plan.stages.map((s, i) => `<span class="chip ${plan.ok ? 'ok' : ''}">${i + 1}. ${STAGE_NAMES[s.type] || s.type} · ${s.targetSec} с</span>`).join('');
    $('planIssues').innerHTML = plan.issues.map((i) => `<li class="${i.severity}">${i.message}</li>`).join('');
    $('btnBuild').disabled = !plan.ok;
  } catch (e) { status('Ошибка разбора: ' + e.message); }
}, 250);

// ───────────── render state ─────────────
function applyFrameGeometry() {
  const p = state.has ? state.preset : meta.presets[document.querySelector('input[name=preset]:checked').value];
  $('frame').style.setProperty('--ar', `${p.width} / ${p.height}`);
  const pct = (v, total) => (v / total * 100) + '%';
  const safe = $('safe');
  safe.style.left = pct(p.insets.l, p.width); safe.style.top = pct(p.insets.t, p.height);
  safe.style.width = pct(p.width - p.insets.l - p.insets.r, p.width); safe.style.height = pct(p.height - p.insets.t - p.insets.b, p.height);
  const q = state.has ? p.quietZone : quietRect();
  const qe = $('quiet');
  if (q) { qe.style.left = pct(q.x, p.width); qe.style.top = pct(q.y, p.height); qe.style.width = pct(q.w, p.width); qe.style.height = pct(q.h, p.height); }
  const on = $('guides').checked;
  safe.hidden = !on; qe.hidden = !on || !q;
}

function renderChips(extra) {
  const chips = [];
  if (state.has && previewVersion !== state.version && !state.stale.length) chips.push('<span class="chip warn">предпросмотр устарел</span>');
  if (extra && extra.quietZone) chips.push(extra.quietZone.ok
    ? `<span class="chip ok">зона крестика спокойная (${extra.quietZone.edgeDensity.toFixed(2)})</span>`
    : `<span class="chip bad">зона крестика привлекает внимание (${extra.quietZone.edgeDensity.toFixed(2)}) — смените фон</span>`);
  if (extra && extra.blackFrames > 0) chips.push(`<span class="chip bad">чёрных кадров: ${extra.blackFrames}</span>`);
  $('chips').innerHTML = chips.join('');
}

function renderTimeline() {
  const bar = $('tlBar');
  if (!state.has) { bar.innerHTML = '<span class="muted">Здесь появится монтаж.</span>'; $('tlTotal').textContent = ''; return; }
  const stale = new Set(state.stale);
  const byId = Object.fromEntries((state.timeline ? state.timeline.stages : []).map((s) => [s.stageId, s]));
  bar.innerHTML = state.scenario.stages.map((st) => {
    const s = byId[st.id];
    const isStale = stale.has(st.id) || !s;
    const grow = s ? s.outFrames : st.targetSec * 30;
    return `<div class="blk ${st.type} ${isStale ? 'stale' : ''}" style="flex:${grow} 1 0">
      <b>${STAGE_NAMES[st.type] || st.type}</b>
      <span class="t">${isStale ? 'нужна пересъёмка' : fmtSec(s.outFrames) + (s.actionSpeed > 1.05 ? ` · ×${s.actionSpeed.toFixed(1)}` : '')}</span>
      <label class="t">цель <input type="number" min="0.5" max="15" step="0.5" value="${st.targetSec}" data-stage="${st.id}"> с</label></div>`;
  }).join('');
  $('tlTotal').textContent = state.timeline ? `итого ${state.timeline.seconds.toFixed(1)} с · ${state.timeline.totalFrames} кадров · 30 FPS` : '';
  bar.querySelectorAll('input[data-stage]').forEach((inp) => inp.addEventListener('change', () => patch({ durations: { [inp.dataset.stage]: +inp.value } })));
}

function renderAll(syncScenario = false) {
  const has = state.has;
  document.body.dataset.version = has ? String(state.version) : '';
  $('btnSave').disabled = !has; $('btnExport').disabled = !has || state.stale.length > 0 || !state.timeline; $('btnPreview').disabled = !has || state.stale.length > 0;
  if (has) {
    $('projName').value = state.name;
    // scenario-level fields are only pulled from the project on create/open; otherwise they hold the user's pending choice
    if (syncScenario) {
      document.querySelector(`input[name=preset][value=${state.preset.id}]`).checked = true;
      $('selPersona').value = state.scenario.persona; $('speed').value = state.scenario.speed; $('seed').value = state.scene.seed;
      $('text').value = state.scenario.source; refreshPlan();
    }
    $('selBg').value = state.scene.background; $('selDrawing').value = state.scene.drawing; $('caseColor').value = state.scene.caseColor;
    stickerSelects().forEach((s, i) => { if (state.scene.stickers[i]) s.value = state.scene.stickers[i].asset; });
    $('selLoop').value = state.loop;
    const q = state.preset.quietZone; $('quietOn').checked = !!q; $('quietBox').hidden = !q;
    if (q) { $('qx').value = q.x; $('qy').value = q.y; $('qw').value = q.w; $('qh').value = q.h; }
    $('vid').loop = state.loop === 'cut';
  }
  applyFrameGeometry();
  const b = $('banner');
  if (has && state.error) { b.className = 'banner bad'; b.innerHTML = 'Проблема с проектом: ' + state.error; b.hidden = false; }
  else if (has && state.stale.length) {
    b.className = 'banner warn';
    b.innerHTML = `Правка затронула этапы: <b>${state.stale.map((s) => STAGE_NAMES[s] || s).join(', ')}</b> — их нужно переснять. Остальное сохранено, монтажный план не изменится. <button id="btnRebuild" class="primary">Пересобрать</button>`;
    b.hidden = false;
    $('btnRebuild').addEventListener('click', rebuildNow);
  } else b.hidden = true;
  $('empty').hidden = has;
  const canPoster = has && !state.stale.length && state.timeline && !state.error;
  const poster = $('poster');
  if (canPoster) { poster.src = `/api/frame?i=0&v=${state.version}&t=${T}`; poster.hidden = $('vid').hidden === false && previewVersion === state.version; }
  else poster.hidden = true;
  $('report').textContent = (state.report || []).join('\n');
  renderTimeline(); renderChips();
}

// ───────────── actions ─────────────
async function guard(fn, busyText) {
  try { if (busyText) status(busyText); await fn(); } catch (e) { status('Ошибка: ' + e.message); const b = $('banner'); b.className = 'banner bad'; b.textContent = e.message; b.hidden = false; }
}

async function build() {
  await guard(async () => {
    $('btnBuild').disabled = true;
    const r = await api('create', collectForm());
    if (!r.ok) { $('planIssues').innerHTML = r.plan.issues.map((i) => `<li class="${i.severity}">${i.message}</li>`).join(''); status('Сценарий содержит ошибки'); return; }
    state = r.state; previewVersion = -1; $('vid').hidden = true;
    renderAll(true); status('Ролик собран. Делаю предпросмотр…'); schedulePreview(0);
  }, 'Автоигра и монтаж…').finally(() => { $('btnBuild').disabled = !planOk; });
}

async function patch(p) {
  await guard(async () => {
    state = await api('update', p); renderAll();
    status(state.stale.length ? 'Нужна пересборка затронутых этапов' : 'Изменения применены'); if (!state.stale.length) schedulePreview(700);
  });
}
const patchQuiet = debounce(() => patch({ quiet: quietRect() }), 400);

async function rebuildNow() {
  await guard(async () => { state = await api('rebuild', {}); renderAll(); status('Пересобрано'); schedulePreview(0); }, 'Переснимаю затронутые этапы…');
}

async function waitJob(id, onProgress) {
  for (;;) {
    const j = await api('job?id=' + id);
    onProgress(j.progress);
    if (j.status === 'done') return j.result;
    if (j.status === 'error') throw new Error(j.error);
    await new Promise((r) => setTimeout(r, 150));
  }
}

function schedulePreview(ms) { clearTimeout(previewTimer); previewTimer = setTimeout(runPreview, ms); }
async function runPreview() {
  if (!state.has || state.stale.length || state.error) return;
  if (jobRunning) return schedulePreview(500);
  jobRunning = true;
  const prog = $('prog'); prog.hidden = false; prog.firstElementChild.style.width = '0';
  try {
    status('Рендерю предпросмотр…');
    const job = await api('preview', {});
    const res = job.status === 'done' ? job.result : await waitJob(job.id, (p) => { prog.firstElementChild.style.width = (p * 100) + '%'; });
    if (res.version !== state.version) { jobRunning = false; prog.hidden = true; return schedulePreview(0); }
    const v = $('vid');
    v.src = `${res.url}?t=${T}`; v.hidden = false; $('poster').hidden = true; v.play().catch(() => {});
    v.dataset.version = String(res.version); previewVersion = res.version; renderChips(res); status('Предпросмотр готов');
  } catch (e) { status('Предпросмотр: ' + e.message); const b = $('banner'); b.className = 'banner bad'; b.textContent = e.message; b.hidden = false; }
  finally { jobRunning = false; prog.hidden = true; }
}

async function exportMp4() {
  let started = false;
  clearTimeout(previewTimer);
  const body = `<label class="check"><input type="radio" name="sc" value="1" checked> Полный размер (${state.preset.width} × ${state.preset.height})</label>
    <label class="check"><input type="radio" name="sc" value="0.5"> Половина размера (быстрее, для проверки)</label>
    <div id="expInfo" class="muted" style="margin-top:12px">H.264 · 30 FPS · без звука · ${fmtSec(state.timeline.totalFrames)}</div>
    <div class="prog" id="expProg" hidden><i></i></div>`;
  await showDialog('Экспорт MP4', body, [
    { label: 'Закрыть', value: 'cancel' },
    { label: 'Экспортировать', value: 'go', primary: true, noClose: true, onClick: async (ev) => {
      if (started) return; started = true; ev.target.disabled = true;
      clearTimeout(previewTimer);
      if (jobRunning) { $('expInfo').textContent = 'Жду окончания предпросмотра…'; while (jobRunning) await new Promise((r) => setTimeout(r, 200)); }
      const scale = +document.querySelector('input[name=sc]:checked').value;
      const pr = $('expProg'); pr.hidden = false;
      try {
        jobRunning = true;
        const job = await api('export', { scale });
        const r = await waitJob(job.id, (p) => { pr.firstElementChild.style.width = (p * 100) + '%'; $('expInfo').textContent = `Рендер… ${(p * 100).toFixed(0)}%`; });
        const qz = r.quietZone ? `<br>Зона под крестик: ${r.quietZone.ok ? 'спокойная ✓' : '<b style="color:#ff9aa6">привлекает внимание — смените фон</b>'}` : '';
        $('expInfo').innerHTML = `Готово: <b>${r.width}×${r.height}</b>, ${r.seconds.toFixed(1)} с, чёрных кадров: ${r.blackFrames}${qz}<br><span style="word-break:break-all">${r.path}</span><br>
          <a href="${r.url}?t=${T}" download="${r.file}">Скачать</a>${window.desktop ? ' · <a href="#" id="showFolder">Показать в папке</a>' : ''}`;
        if (window.desktop) $('showFolder').addEventListener('click', (e) => { e.preventDefault(); window.desktop.showInFolder(r.path); });
        status('Экспорт завершён: ' + r.file);
      } catch (e) { $('expInfo').innerHTML = '<span style="color:#ff9aa6">Ошибка: ' + e.message + '</span>'; started = false; ev.target.disabled = false; }
      finally { jobRunning = false; pr.hidden = true; }
    } },
  ]);
}

async function openProject() {
  await guard(async () => {
    const list = await api('projects');
    if (!list.length) { await showDialog('Открыть проект', '<div class="muted">Сохранённых проектов пока нет.</div>', [{ label: 'Закрыть', value: 'cancel' }]); return; }
    const pick = await showDialog('Открыть проект', '<div class="list">' + list.map((p) => `<button type="submit" value="${p.file}">${p.name}</button>`).join('') + '</div>', [{ label: 'Отмена', value: 'cancel' }]);
    if (pick === 'cancel') return;
    state = await api('open', { file: pick }); previewVersion = -1; $('vid').hidden = true; renderAll(true);
    status('Проект открыт'); if (!state.stale.length && state.timeline) schedulePreview(0);
  });
}
async function saveProject() {
  const name = await askText('Сохранить проект', $('projName').value);
  if (name === null) return;
  await guard(async () => { const r = await api('save', { name }); $('projName').value = name; status('Сохранено: ' + r.path); });
}

// ───────────── init ─────────────
async function init() {
  meta = await api('meta');
  fillSelect($('selBg'), meta.assets.background, 'bg-calm');
  fillSelect($('selDrawing'), meta.assets.drawing, 'drawing-heart-star');
  const defSt = ['sticker-star', 'sticker-smile', 'sticker-bolt'];
  stickerSelects().forEach((s, i) => fillSelect(s, meta.assets.sticker, defSt[i]));
  fillSelect($('selPersona'), meta.personas.map((p) => ({ id: p, name: { careful: 'Аккуратный', fast: 'Быстрый', playful: 'Игривый' }[p] || p })), 'careful');
  $('text').value = DEFAULT_TEXT;
  $('quietBox').hidden = true;
  $('assetsInfo').textContent = `Ассетов: ${Object.values(meta.assets).reduce((n, a) => n + a.length, 0)}. Папка проектов: ${meta.dataDir}`;
  if (!meta.ffmpeg) { const b = $('banner'); b.className = 'banner bad'; b.textContent = 'ffmpeg не найден — сборка и предпросмотр возможны, но видео сделать нельзя. В установщике приложения ffmpeg уже внутри.'; b.hidden = false; }
  if (meta.assetWarnings.length) status('Пропущены некорректные ассеты: ' + meta.assetWarnings.join('; '));
  applyFrameGeometry(); renderTimeline(); refreshPlan();

  $('text').addEventListener('input', refreshPlan);
  $('btnBuild').addEventListener('click', build);
  $('btnPreview').addEventListener('click', () => schedulePreview(0));
  $('btnExport').addEventListener('click', exportMp4);
  $('btnOpen').addEventListener('click', openProject);
  $('btnSave').addEventListener('click', saveProject);
  $('guides').addEventListener('change', applyFrameGeometry);
  document.querySelectorAll('input[name=preset]').forEach((r) => r.addEventListener('change', () => { if (!state.has) applyFrameGeometry(); else status('Формат меняет раскладку: нажмите «Собрать ролик», чтобы снять заново'); }));
  $('quietOn').addEventListener('change', () => { $('quietBox').hidden = !$('quietOn').checked; if (state.has) patch({ quiet: quietRect() }); else applyFrameGeometry(); });
  ['qx', 'qy', 'qw', 'qh'].forEach((id) => $(id).addEventListener('input', () => { if (state.has) patchQuiet(); else applyFrameGeometry(); }));
  $('selBg').addEventListener('change', () => state.has && patch({ background: $('selBg').value }));
  $('selDrawing').addEventListener('change', () => state.has && patch({ drawing: $('selDrawing').value }));
  stickerSelects().forEach((s) => s.addEventListener('change', () => state.has && patch({ stickers: stickerSelects().map((x) => x.value) })));
  $('caseColor').addEventListener('input', debounce(() => state.has && patch({ caseColor: $('caseColor').value }), 300));
  $('selLoop').addEventListener('change', () => state.has && patch({ loop: $('selLoop').value }));
  $('projName').addEventListener('change', () => state.has && patch({ name: $('projName').value }));
  $('vid').addEventListener('loadeddata', () => { $('poster').hidden = true; });
}
init().catch((e) => status('Не удалось запустить: ' + e.message));
