import { serialize, replaceState, normalizeState, markDirty, addNode } from './store.js';
import { screenToWorld } from './view.js';
import { uploadImage } from './api.js';
import { banner } from './banner.js';

const IMG_FIT = 360;

function addImageObject(url, cx, cy) {
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, IMG_FIT / Math.max(img.naturalWidth || 320, img.naturalHeight || 200));
    const w = Math.round((img.naturalWidth || 320) * k);
    const h = Math.round((img.naturalHeight || 200) * k);
    addNode({ isImage: true, allowOverlap: true, title: '', image: url, w, h, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2) });
    markDirty();
    banner('Картинка добавлена — тяните за угол для масштаба');
  };
  img.onerror = () => { addNode({ isImage: true, allowOverlap: true, title: '', image: url, w: 320, h: 200 }); markDirty(); };
  img.src = url;
}

export function initIO(mapName, wrap) {
  document.getElementById('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `inkmap-${mapName}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ── JSON import ──
  const fileInput = document.getElementById('import-file');
  document.getElementById('btn-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (!confirm('Заменить текущее содержимое карты содержимым файла?')) return;
    try {
      const raw = JSON.parse(await file.text());
      replaceState(raw);
      markDirty();
      banner('Карта загружена из файла');
    } catch (err) {
      banner('Не удалось прочитать файл: ' + err.message);
    }
  });

  // ── Markdown import ──
  const mdInput = document.getElementById('import-md-file');
  document.getElementById('btn-import-md').addEventListener('click', () => mdInput.click());
  mdInput.addEventListener('change', async () => {
    const file = mdInput.files[0];
    mdInput.value = '';
    if (!file) return;
    banner('Импортирую Markdown...');
    try {
      const form = new FormData();
      form.append('file', file);
      const resp = await fetch('/api/import-md', { method: 'POST', body: form });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      const { nodes: newNodes, edges: newEdges, warnings } = await resp.json();
      if (!newNodes.length) { banner('Файл не содержит заголовков (## ...)'); return; }
      const r = wrap.getBoundingClientRect();
      const w = screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
      const minX = Math.min(...newNodes.map(n => n.x));
      const minY = Math.min(...newNodes.map(n => n.y));
      const offX = Math.round(w.x - minX - 110);
      const offY = Math.round(w.y - minY - 40);
      for (const n of newNodes) { n.x += offX; n.y += offY; }
      const cur = serialize();
      const existIds = new Set(cur.nodes.map(n => n.id));
      // у новичков, чей id уже занят, перегенерируем id и перенацеливаем рёбра
      const remap = new Map();
      for (const n of newNodes) {
        if (existIds.has(n.id)) {
          let nid;
          do { nid = 'n_' + Math.random().toString(16).slice(2, 10); }
          while (existIds.has(nid) || newNodes.some(x => x.id === nid));
          remap.set(n.id, nid);
          existIds.add(nid);
        } else {
          existIds.add(n.id);
        }
      }
      let added = 0;
      for (const n of newNodes) {
        const nid = remap.get(n.id) || n.id;
        if (!cur.nodes.some(x => x.id === nid)) { cur.nodes.push({ ...n, id: nid }); added++; }
      }
      const existEids = new Set(cur.edges.map(e => e.id));
      for (const e of newEdges) {
        const a = remap.get(e.from) || e.from;
        const b = remap.get(e.to) || e.to;
        const eid = remap.has(e.from) || remap.has(e.to) ? 'e_' + Math.random().toString(16).slice(2, 10) : e.id;
        if (!existEids.has(eid)) { cur.edges.push({ ...e, id: eid, from: a, to: b }); existEids.add(eid); }
      }
      replaceState(cur);
      markDirty();
      banner(`Импортировано ${added} нод из Markdown`);
      if (warnings && warnings.length) {
        setTimeout(() => banner(`⚠ ${warnings[0]}` + (warnings.length > 1 ? ` (+${warnings.length - 1} ещё)` : '')), 2600);
      }
    } catch (err) {
      banner('Ошибка импорта: ' + err.message);
    }
  });

  // перетащить json-файл на канвас = импорт; картинку = новая нода с картинкой
  wrap.addEventListener('dragover', (e) => { e.preventDefault(); });
  wrap.addEventListener('drop', async (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (f.name.endsWith('.json')) {
      e.preventDefault();
      fileInput.files = e.dataTransfer.files;
      fileInput.dispatchEvent(new Event('change'));
      return;
    }
    if (!f.type.startsWith('image/')) return;
    e.preventDefault();
    const w = screenToWorld(e.clientX, e.clientY);
    banner('Загружаю картинку...');
    try {
      const url = await uploadImage(f);
      addImageObject(url, w.x, w.y);
    } catch (err) {
      banner('Не удалось загрузить картинку: ' + err.message);
    }
  });

  // вставка картинки из буфера (Ctrl+V) — узел в центре экрана
  window.addEventListener('paste', async (e) => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    try {
      const url = await uploadImage(file);
      const r = wrap.getBoundingClientRect();
      const w = screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
      addImageObject(url, w.x, w.y);
    } catch (err) {
      banner('Не удалось вставить картинку: ' + err.message);
    }
  });
}

export { normalizeState };
