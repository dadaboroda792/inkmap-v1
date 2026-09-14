export const NODE_W = 220;
export const MAX_LEVELS = 5;
export const PALETTE = ['#ffd6da', '#ffe9b8', '#d9f5ce', '#cfe4ff', '#e4dbff', '#ffd9f0', '#e8eaed', ''];
const SIDES = new Set(['auto', 'right', 'bottom', 'left', 'top']);

export const state = { meta: {}, nodes: [], edges: [], strokes: [], shapes: [], reveal: 1 };
const BRUSH_STYLES = ['pen', 'pencil', 'marker', 'highlighter'];

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit() {
  for (const fn of subs) {
    try { fn(); } catch (err) { console.error('subscriber error:', err); }
  }
}

let flushHandler = null;
export function setFlushHandler(fn) { flushHandler = fn; }

export function uid(prefix) {
  const b = crypto.getRandomValues(new Uint8Array(4));
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return `${prefix}_${s}`;
}

function normLevels(src) {
  const raw = Array.isArray(src?.levels) ? src.levels : [];
  const list = raw
    .slice(0, MAX_LEVELS)
    .map(l => ({ id: String(l?.id ?? uid('l')), text: String(l?.text ?? ''), pin: Boolean(l?.pin) }));
  if (!list.length) list.push({ id: uid('l'), text: String(src?.note ?? ''), pin: false });
  return list;
}

function normTags(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const t of v) {
    const s = String(t).trim().toLowerCase().slice(0, 24);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

function normNode(n) {
  const special = Boolean(n.isText || n.isImage);
  const levels = normLevels(n);
  return {
    id: String(n.id), x: +n.x || 0, y: +n.y || 0,
    title: String(n.title ?? '').trim() || (special ? '' : 'Без названия'),
    note: levels[0].text,
    levels,
    color: n.color ?? '',
    image: n.image ?? null,
    audio: n.audio ?? null,
    glowMode: ['off','glow','outline'].includes(n.glowMode) ? n.glowMode : (n.glow ? 'glow' : 'off'),
    isGroup: Boolean(n.isGroup),
    isText: Boolean(n.isText),
    isImage: Boolean(n.isImage),
    font: n.font === 'plain' ? 'plain' : 'hand',
    groupId: n.groupId ? String(n.groupId) : null,
    w: +n.w || NODE_W,
    h: +n.h || 84,
    collapsed: Boolean(n.collapsed),
    tags: normTags(n.tags),
    isTask: Boolean(n.isTask),
    done: Boolean(n.done),
  };
}

export function normalizeState(raw = {}) {
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).map(normNode);
  const ids = new Set(nodes.map(n => n.id));
  const edges = (Array.isArray(raw.edges) ? raw.edges : [])
    .filter(e => ids.has(e.from) && ids.has(e.to))
    .map(e => ({
      id: String(e.id), from: e.from, to: e.to,
      fromSide: SIDES.has(e.fromSide) ? e.fromSide : 'auto',
      toSide: SIDES.has(e.toSide) ? e.toSide : 'auto',
      label: String(e.label ?? ''), dashed: Boolean(e.dashed), arrow: e.arrow !== false,
    }));
  const strokes = (Array.isArray(raw.strokes) ? raw.strokes : [])
    .filter(s => Array.isArray(s.points) && s.points.length > 1)
    .map(s => {
      const out = {
        id: String(s.id), points: s.points.map(p => [+p[0] || 0, +p[1] || 0]),
        color: String(s.color || '#8a93a6'), width: Math.min(12, Math.max(1, +s.width || 2.5)),
        style: BRUSH_STYLES.includes(s.style) ? s.style : 'pen',
      };
      if (Array.isArray(s.widths) && s.widths.length === s.points.length) {
        out.widths = s.widths.map(w => Math.min(60, Math.max(0.2, +w || 1)));
      }
      return out;
    });
  const shapes = (Array.isArray(raw.shapes) ? raw.shapes : [])
    .filter(s => ['rect', 'ellipse', 'arrow'].includes(s.type) && Array.isArray(s.a) && Array.isArray(s.b))
    .map(s => ({
      id: String(s.id), type: s.type,
      a: [+s.a[0] || 0, +s.a[1] || 0], b: [+s.b[0] || 0, +s.b[1] || 0],
      color: String(s.color || '#8a93a6'), width: Math.min(12, Math.max(1, +s.width || 2.5)),
    }));
  return {
    meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
    nodes, edges, strokes, shapes,
    reveal: Math.min(MAX_LEVELS, Math.max(1, Math.round(+raw.reveal || 1))),
  };
}

export function replaceState(raw) {
  const next = normalizeState(raw);
  state.meta = next.meta;
  state.nodes = next.nodes;
  state.edges = next.edges;
  state.strokes = next.strokes;
  state.shapes = next.shapes;
  state.reveal = next.reveal;
  emit();
}

export function serialize() {
  return {
    version: 1,
    meta: structuredClone(state.meta),
    nodes: structuredClone(state.nodes),
    edges: structuredClone(state.edges),
    strokes: structuredClone(state.strokes),
    shapes: structuredClone(state.shapes),
    reveal: state.reveal,
  };
}

export function getNode(id) { return state.nodes.find(n => n.id === id); }
export function getEdge(id) { return state.edges.find(e => e.id === id); }
export function getStroke(id) { return state.strokes.find(s => s.id === id); }

function overlaps(x, y, h, ignoreId) {
  return state.nodes.some(n =>
    n.id !== ignoreId &&
    x < n.x + NODE_W + 8 && x + NODE_W + 8 > n.x &&
    y < n.y + h + 8 && y + h + 8 > n.y);
}

export function findFreeSpot(x, y, h = 84) {
  if (!overlaps(x, y, h)) return { x, y };
  for (let row = 0; row <= 12; row++) {
    for (let col = 1; col <= 8; col++) {
      const cx = x + col * (NODE_W + 24);
      const cy = y + row * (h + 24);
      if (!overlaps(cx, cy, h)) return { x: cx, y: cy };
    }
  }
  return { x: x + (NODE_W + 24) * 9, y: y + 12 * (h + 24) };
}

export function addNode(patch = {}) {
  const isGroup = Boolean(patch.isGroup);
  const special = Boolean(patch.isText || patch.isImage);
  const w = +patch.w || (isGroup ? 420 : NODE_W);
  const h = +patch.h || (isGroup ? 300 : 84);
  let x = +patch.x || 0, y = +patch.y || 0;
  if (!patch.allowOverlap && !isGroup) {
    const free = findFreeSpot(x, y, h);
    x = free.x; y = free.y;
  }
  const node = {
    id: patch.id ?? uid('n'), x, y, w, h,
    title: patch.title ?? (special ? '' : 'Без названия'), note: patch.note ?? '',
    color: patch.color ?? '', image: patch.image ?? null, audio: patch.audio ?? null,
    collapsed: Boolean(patch.collapsed),
    tags: normTags(patch.tags),
    isTask: Boolean(patch.isTask),
    done: Boolean(patch.done),
    glowMode: ['off','glow','outline'].includes(patch.glowMode) ? patch.glowMode : 'off',
    isGroup,
    isText: Boolean(patch.isText),
    isImage: Boolean(patch.isImage),
    font: patch.font === 'plain' ? 'plain' : 'hand',
    groupId: patch.groupId ? String(patch.groupId) : null,
  };
  node.levels = normLevels(patch);
  node.note = node.levels[0].text;
  state.nodes.push(node); emit(); return node;
}
export function updateNode(id, patch) {
  const n = getNode(id); if (!n) return;
  if (patch.tags !== undefined) patch = { ...patch, tags: normTags(patch.tags) };
  Object.assign(n, patch);
  if (Array.isArray(patch.levels)) {
    n.levels = normLevels({ levels: patch.levels });
    n.note = n.levels[0].text;
  } else if (patch.note !== undefined && Array.isArray(n.levels) && n.levels.length) {
    n.levels[0] = { ...(n.levels[0] || { id: uid('l') }), text: String(n.note) };
  }
  emit();
}
export function setReveal(k) {
  state.reveal = Math.min(MAX_LEVELS, Math.max(1, Math.round(+k || 1)));
  emit();
}
export function deleteNode(id) {
  const i = state.nodes.findIndex(n => n.id === id); if (i < 0) return;
  state.nodes.splice(i, 1);
  state.edges = state.edges.filter(e => e.from !== id && e.to !== id);
  emit();
}

export function duplicateNode(id) {
  const n = getNode(id); if (!n) return null;
  return addNode({
    x: n.x + 26, y: n.y + 26,
    title: n.title, note: n.note,
    levels: structuredClone(n.levels || [{ id: uid('l'), text: n.note }]),
    color: n.color, image: n.image, audio: n.audio,
    collapsed: n.collapsed, font: n.font,
    tags: n.tags ? [...n.tags] : [],
    isTask: Boolean(n.isTask), done: false,
    isText: n.isText, isImage: n.isImage,
    w: n.w, h: n.h, allowOverlap: true,
  });
}

export function addEdge({ from, to }) {
  if (from === to) return null;
  const dup = state.edges.some(e =>
    (e.from === from && e.to === to) || (e.from === to && e.to === from));
  if (dup) return null;
  const edge = {
    id: uid('e'), from, to,
    fromSide: 'auto', toSide: 'auto', label: '', dashed: false, arrow: true,
  };
  state.edges.push(edge); emit(); return edge;
}
export function updateEdge(id, patch) {
  const e = getEdge(id); if (!e) return;
  Object.assign(e, patch); emit();
}
export function deleteEdge(id) {
  const i = state.edges.findIndex(e => e.id === id);
  if (i < 0) return;
  state.edges.splice(i, 1); emit();
}

/* ---------- tree-fold ---------- */

export function childMap(st = state) {
  const m = new Map();
  for (const e of st.edges) {
    const arr = m.get(e.from);
    if (arr) arr.push(e.to); else m.set(e.from, [e.to]);
  }
  return m;
}

export function countDescendants(rootId, m = childMap()) {
  const seen = new Set([rootId]);
  const stack = [rootId];
  let cnt = 0;
  while (stack.length) {
    const id = stack.pop();
    for (const c of m.get(id) || []) {
      if (!seen.has(c)) { seen.add(c); stack.push(c); cnt++; }
    }
  }
  return cnt;
}

export function computeHiddenIds(st = state) {
  const kids = childMap(st);
  const hidden = new Set();
  for (const n of st.nodes) {
    if (!n.collapsed) continue;
    const seen = new Set([n.id]);
    const stack = [n.id];
    while (stack.length) {
      const id = stack.pop();
      for (const c of kids.get(id) || []) {
        if (!seen.has(c)) { seen.add(c); hidden.add(c); stack.push(c); }
      }
    }
  }
  return hidden;
}
export function addStroke(stroke) {
  state.strokes.push(stroke); emit(); return stroke;
}
export function updateStroke(id, patch) {
  const s = getStroke(id); if (!s) return;
  Object.assign(s, patch); emit();
}
export function deleteStroke(id) {
  const i = state.strokes.findIndex(s => s.id === id); if (i < 0) return;
  state.strokes.splice(i, 1); emit();
}

export function getShape(id) { return state.shapes.find(s => s.id === id); }
export function addShape(shape) {
  state.shapes.push(shape); emit(); return shape;
}
export function deleteShape(id) {
  const i = state.shapes.findIndex(s => s.id === id); if (i < 0) return;
  state.shapes.splice(i, 1); emit();
}
export function updateShape(id, patch) {
  const s = state.shapes.find(s => s.id === id); if (!s) return;
  Object.assign(s, patch); emit();
}

let flushTimer = null;
export function markDirty() {
  document.dispatchEvent(new CustomEvent('spark:dirty'));
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { if (flushHandler) flushHandler(); }, 1000);
}
export function cancelDirty() { clearTimeout(flushTimer); }

export function _resetForTests() {
  state.meta = {}; state.nodes.length = 0; state.edges.length = 0;
  state.strokes.length = 0; state.shapes.length = 0; state.reveal = 1;
}
