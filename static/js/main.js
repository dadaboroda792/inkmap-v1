import * as store from './store.js';
import * as view from './view.js';
import { centerOn } from './view.js';
import { renderNodes, startTitleEdit } from './nodes.js';
import { initEdges, renderEdges, initEdgeClicks } from './edges.js';
import { initInput, select, selection } from './input.js';
import { initInk, setMode, mode as inkMode, PEN_COLORS, BRUSHES, setPenColor, setPenWidth, setBrush, setEraserRadius, penSettings, clearAllInk } from './ink.js';

import { initHistory, undo, redo } from './history.js';
import { initSearch } from './search.js';
import { initTheme } from './theme.js';
import { initIO } from './io.js';
import { initNodePanel } from './nodepanel.js';
import * as api from './api.js';
import { banner } from './banner.js';
import { initMinimap, toggleMinimap } from './minimap.js';
import { startRecording, stopRecording, isRecording, onRecordingStopped, elapsedMs } from './voice.js';

const params = new URLSearchParams(location.search);
export const mapName = params.get('map');

if (!mapName) {
  location.href = '/static/index.html';
} else {
  boot();
}

function boot() {
  document.getElementById('map-title').textContent = mapName;

  const wrap = document.getElementById('canvas-wrap');
  const viewport = document.getElementById('viewport');
  const svg = document.getElementById('scene-svg');

  initTheme();

  view.initView(wrap, viewport);
  initEdges(svg);
  store.subscribe(() => renderNodes(viewport));
  renderNodes(viewport);
  initInput(wrap, viewport);
  document.addEventListener('spark:nodes-moved', () => renderNodes(viewport));
  initInk(wrap, svg);
  setMode('select');
  initEdgeClicks(wrap);
  initHistory();
  initSearch();
  initIO(mapName, wrap);
  initNodePanel();
  initMinimap(wrap);

  document.getElementById('btn-mm').addEventListener('click', (e) => {
    toggleMinimap();
    e.currentTarget.classList.toggle('active');
  });
  if (localStorage.getItem('inkmap-minimap') === 'off') document.getElementById('btn-mm').classList.remove('active');

  // текстовый режим: пустой блок удаляем
  document.addEventListener('spark:text-empty', (e) => {
    store.deleteNode(e.detail);
    select(null);
    store.markDirty();
  });

  // голосовые заметки
  const btnVoice = document.getElementById('btn-voice');
  const voiceTimer = document.getElementById('voice-timer');
  let voiceTick = null;
  let voiceTarget = null;
  function setVoiceUI(on) {
    btnVoice.classList.toggle('recording', on);
    voiceTimer.classList.toggle('hidden', !on);
    clearInterval(voiceTick); voiceTick = null;
    if (on) voiceTick = setInterval(() => {
      const s = Math.floor(elapsedMs() / 1000);
      voiceTimer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 300);
  }
  async function toggleVoice(targetNodeId) {
    if (isRecording()) { stopRecording(); return; }
    try {
      await startRecording();
      voiceTarget = targetNodeId || null;
      setVoiceUI(true);
      banner(voiceTarget ? 'Запись… нажмите «Стоп» для завершения' : 'Идёт запись — нажмите микрофон ещё раз для остановки');
    } catch (err) { banner('Нет доступа к микрофону: ' + err.message); }
  }
  btnVoice.addEventListener('click', () => toggleVoice(null));
  document.addEventListener('spark:voice-record', (e) => toggleVoice(e.detail));
  onRecordingStopped(async (blob, duration, ext) => {
    setVoiceUI(false);
    if (!blob || duration < 1) { banner('Слишком короткая запись'); return; }
    try {
      banner('Сохраняю запись…');
      const url = await api.uploadMedia(blob, `voice.${ext}`);
      const target = voiceTarget && store.getNode(voiceTarget) ? voiceTarget : null;
      if (target) store.updateNode(target, { audio: url });
      else {
        const r = wrap.getBoundingClientRect();
        const w = view.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
        const t = new Date();
        const stamp = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
        store.addNode({ title: `Голосовая заметка ${stamp}`, audio: url, x: Math.round(w.x - 110), y: Math.round(w.y - 30) });
      }
      store.markDirty();
      banner('Голосовая заметка сохранена');
    } catch (err) { banner('Не удалось сохранить запись: ' + err.message); }
  });

  // переключатель глубины заметок
  function maxLevelsUsed() {
    let m = 1;
    for (const n of store.state.nodes) {
      const used = (n.levels || []).length;
      if (used > m) m = used;
    }
    return m;
  }
  function refreshRevealCtl() {
    const ctl = document.getElementById('reveal-ctl');
    const minus = document.getElementById('reveal-minus');
    const plus = document.getElementById('reveal-plus');
    const mu = maxLevelsUsed();
    ctl.classList.toggle('hidden', mu < 2);
    document.getElementById('reveal-val').textContent = store.state.reveal;
    minus.disabled = store.state.reveal <= 1;
    plus.disabled = store.state.reveal >= Math.min(store.MAX_LEVELS, mu);
  }
  document.getElementById('reveal-minus').addEventListener('click', () => store.setReveal(store.state.reveal - 1));
  document.getElementById('reveal-plus').addEventListener('click', () => store.setReveal(store.state.reveal + 1));
  store.subscribe(refreshRevealCtl);
  refreshRevealCtl();

  // подсветка выделенного (мультиселект: ноды + фигуры + штрихи)
  document.addEventListener('spark:selection', () => {
    viewport.querySelectorAll('.ink-node.selected').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('#shape-g .ink-shape.selected, #ink-g .ink-stroke.selected')
      .forEach(el => el.classList.remove('selected'));
    for (const id of selection.ids) {
      viewport.querySelector(`.ink-node[data-id="${CSS.escape(id)}"]`)?.classList.add('selected');
      document.querySelector(`#shape-g [data-id="${CSS.escape(id)}"]`)?.classList.add('selected');
      document.querySelector(`#ink-g [data-id="${CSS.escape(id)}"]`)?.classList.add('selected');
    }
    renderNodes(viewport);
  });

  // тулбар
  document.getElementById('btn-add-node').addEventListener('click', () => {
    const r = wrap.getBoundingClientRect();
    const w = view.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    const node = store.addNode({ x: Math.round(w.x - 110), y: Math.round(w.y - 24), title: '' });
    store.markDirty();
    select('node', node.id);
    startTitleEdit(node);
  });

  document.getElementById('btn-add-group').addEventListener('click', () => {
    const r = wrap.getBoundingClientRect();
    const w = view.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    const g = store.addNode({
      isGroup: true, allowOverlap: true,
      x: Math.round(w.x - 210), y: Math.round(w.y - 150),
      w: 420, h: 300, title: 'Группа', color: '',
    });
    store.markDirty();
    select('node', g.id);
    startTitleEdit(g);
  });

  document.getElementById('tool-select').addEventListener('click', () => setMode('select'));
  document.getElementById('tool-pen').addEventListener('click', () => setMode(inkMode === 'pen' ? 'off' : 'pen'));
  document.getElementById('tool-eraser').addEventListener('click', () => setMode(inkMode === 'eraser' ? 'off' : 'eraser'));
  document.getElementById('tool-rect').addEventListener('click', () => setMode(inkMode === 'rect' ? 'off' : 'rect'));
  document.getElementById('tool-ellipse').addEventListener('click', () => setMode(inkMode === 'ellipse' ? 'off' : 'ellipse'));
  document.getElementById('tool-arrow').addEventListener('click', () => setMode(inkMode === 'arrow' ? 'off' : 'arrow'));
  document.getElementById('tool-text').addEventListener('click', () => {
    setMode(document.body.classList.contains('mode-text') ? 'select' : 'text');
  });
  initInkBar();
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);

  window.addEventListener('keydown', (e) => {
    const t = document.activeElement;
    if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
    if (e.key === 'Escape' && window.__inkMode) { setMode('off'); return; }
    if (e.key === 'Escape' && document.body.classList.contains('mode-text')) { setMode('select'); return; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyZ') { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyY' || (e.shiftKey && e.code === 'KeyZ'))) { e.preventDefault(); redo(); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') { e.preventDefault(); document.getElementById('btn-search').click(); }
    else if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      const toolKeys = { KeyV: 'select', KeyP: 'pen', KeyE: 'eraser', KeyR: 'rect', KeyO: 'ellipse', KeyA: 'arrow', KeyT: 'text' };
      if (toolKeys[e.code]) setMode(toolKeys[e.code]);
    }
  });

  function initInkBar() {
    const bar = document.getElementById('ink-bar');
    const brushRow = bar.querySelector('#brush-row');
    for (const [id, B] of Object.entries(BRUSHES)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'brush-btn';
      b.dataset.b = id;
      b.textContent = B.label;
      b.title = B.label;
      b.addEventListener('click', () => { setBrush(id); markBrush(); });
      brushRow.appendChild(b);
    }
    function markBrush() {
      const cur = penSettings().brush;
      [...brushRow.children].forEach(b => b.classList.toggle('on', b.dataset.b === cur));
    }
    markBrush();

    const colorsEl = bar.querySelector('.pen-colors');
    for (const c of PEN_COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sw';
      b.dataset.c = c;
      b.style.background = c === 'auto'
        ? 'linear-gradient(135deg, var(--accent), #8ce0ff)'
        : c;
      b.title = c === 'auto' ? 'Авто (по теме)' : c;
      b.addEventListener('click', () => { setPenColor(c); markActive(); });
      colorsEl.appendChild(b);
    }
    const widthInput = document.getElementById('pen-width');
    widthInput.addEventListener('input', () => {
      setPenWidth(+widthInput.value);
      syncPreview();
      markActive();
    });
    const eraserInput = document.getElementById('eraser-width');
    eraserInput.value = penSettings().eraser;
    eraserInput.addEventListener('input', () => setEraserRadius(+eraserInput.value));
    document.getElementById('pen-clear').addEventListener('click', clearAllInk);
    widthInput.value = penSettings().width;
    markActive();
    syncPreview();

    function markActive() {
      [...colorsEl.children].forEach(b => b.classList.toggle('on', b.dataset.c === penSettings().color));
      widthInput.value = penSettings().width;
    }
    function syncPreview() {
      const pv = document.getElementById('pen-preview');
      const p = penSettings();
      const d = Math.min(22, p.width * 2.2);
      pv.style.width = d + 'px'; pv.style.height = d + 'px';
      pv.style.background = p.color === 'auto'
        ? getComputedStyle(document.documentElement).getPropertyValue('--ink-color')
        : p.color;
    }
  }

  // сессия: загрузка + автосейв
  initSession(mapName).then((ok) => {
    if (!ok) return;
    renderNodes(viewport);
    renderEdges();
    const first = store.state.nodes[0];
    if (first && store.state.nodes.length <= 2) centerOn(first.x + 110, first.y + 40);
  });

  async function initSession(name) {
    let raw;
    try {
      raw = await api.getMap(name);
    } catch (e) {
      showLoadError(name, e);
      return false;
    }
    store.replaceState(raw);

    let saving = false;
    let rerun = false;
    let retryTimer = null;
    const flush = async () => {
      if (saving) { rerun = true; return; }
      saving = true;
      clearTimeout(retryTimer); retryTimer = null;
      setStatus('dirty');
      try {
        await api.saveMap(name, store.serialize());
        setStatus('saved');
      } catch (err) {
        banner('Не сохранено: ' + err.message + ' — повторю через 5 с');
        setStatus('err');
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => { flush(); }, 5000);
      } finally {
        saving = false;
        if (rerun) { rerun = false; flush(); }
      }
    };
    store.setFlushHandler(flush);
    document.addEventListener('spark:dirty', () => setStatus('dirty'));

    window.addEventListener('beforeunload', (ev) => {
      const st = document.getElementById('save-status');
      if (st && (st.classList.contains('dirty') || st.classList.contains('err'))) {
        try {
          api.saveMap(name, store.serialize(), { keepalive: true }).catch(() => {});
        } catch {}
        ev.preventDefault();
        ev.returnValue = '';
      }
    });
    window.addEventListener('pagehide', () => {
      const st = document.getElementById('save-status');
      if (st && (st.classList.contains('dirty') || st.classList.contains('err'))) {
        try {
          api.saveMap(name, store.serialize(), { keepalive: true }).catch(() => {});
        } catch {}
      }
    });
    return true;
  }

  function setStatus(cls) {
    const el = document.getElementById('save-status');
    if (!el) return;
    el.className = 'status ' + cls;
    el.textContent = { saved: 'сохранено', dirty: 'изменения…', err: 'ошибка' }[cls] ?? '';
  }

  function showLoadError(name, err) {
    const box = document.getElementById('load-error');
    box.replaceChildren();
    const p = document.createElement('p');
    p.textContent = `Не удалось открыть карту «${name}»: ${err.message}`;
    const a = document.createElement('a');
    a.href = '/static/index.html';
    a.textContent = 'Ко всем картам';
    box.append(p, a);
    box.classList.remove('hidden');
  }

  window.__store = store; // debug-хелпер для консоли
}
