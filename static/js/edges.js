import { state, getNode, getEdge, subscribe, updateEdge, deleteEdge, markDirty, computeHiddenIds } from './store.js';
import { nodeSize } from './nodes.js';
import { onViewChange } from './view.js';
import { selection, select } from './input.js';

export function clipCenter(r, target) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const dx = target.x - cx, dy = target.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  if (r.w * Math.abs(dy) > r.h * Math.abs(dx)) {
    const t = (r.h / 2) / Math.max(Math.abs(dy), 1e-6);
    return { x: cx + dx * t, y: dy > 0 ? r.y + r.h : r.y };
  }
  const t2 = (r.w / 2) / Math.max(Math.abs(dx), 1e-6);
  return { x: dx > 0 ? r.x + r.w : r.x, y: Math.min(Math.max(cy + dy * t2, r.y), r.y + r.h) };
}

export function anchorPoint(node, el, side, toward) {
  const s = nodeSize(node, el);
  const r = { x: node.x, y: node.y, w: s.w, h: s.h };
  const mid = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  switch (side) {
    case 'right': return { x: r.x + r.w, y: mid.y };
    case 'left': return { x: r.x, y: mid.y };
    case 'top': return { x: mid.x, y: r.y };
    case 'bottom': return { x: mid.x, y: r.y + r.h };
    default: return clipCenter(r, toward);
  }
}

export function bezierPath(a, b) {
  const dx = Math.abs(b.x - a.x);
  const cp = Math.min(160, Math.max(40, dx * 0.5));
  const s = a.x <= b.x ? 1 : -1;
  return `M ${a.x} ${a.y} C ${a.x + cp * s} ${a.y}, ${b.x - cp * s} ${b.y}, ${b.x} ${b.y}`;
}

let g = null;
let scheduled = false;

function edgeColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--edge').trim() || '#8a93a6';
}
function accentColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6c8cff';
}

export function initEdges(svgEl) {
  g = svgEl.querySelector('#edge-g');
  const defs = svgEl.querySelector('#scene-defs');

  function buildMarker(id, color) {
    const m = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    m.id = id;
    m.setAttribute('viewBox', '0 0 10 10');
    m.setAttribute('refX', '9'); m.setAttribute('refY', '5');
    m.setAttribute('markerWidth', '7'); m.setAttribute('markerHeight', '7');
    m.setAttribute('orient', 'auto-start-reverse');
    m.innerHTML = `<path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/>`;
    defs.appendChild(m);
  }
  buildMarker('arr', edgeColor());
  buildMarker('arr-sel', accentColor());

  subscribe(() => scheduleRender());
  document.addEventListener('spark:selection', () => { rerenderOnSelection(); scheduleRender(); });
  document.addEventListener('spark:nodes-moved', scheduleRender);
  onViewChange(scheduleRender);
}

let selectedIdCache = null;
function rerenderOnSelection() {
  // панель связи живёт здесь же
  if (selection.kind === 'edge' && selection.id && !getEdge(selection.id)) {
    select(null);
    closeEdgePanel();
  }
}

function scheduleRender() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; renderEdges(); });
}

export function renderEdges() {
  if (!g) return;
  const base = edgeColor();
  const accent = accentColor();
  const byId = new Map(state.nodes.map(n => [n.id, n]));
  const hiddenByFold = new Set(
    state.nodes.filter(n => n.groupId && byId.get(n.groupId)?.collapsed).map(n => n.id)
  );
  for (const id of computeHiddenIds(state)) hiddenByFold.add(id);
  const seen = new Set();
  for (const e of state.edges) {
    const A = byId.get(e.from), B = byId.get(e.to);
    if (!A || !B || hiddenByFold.has(e.from) || hiddenByFold.has(e.to)) continue;
    seen.add(e.id);
    const cA = center(A), cB = center(B);
    const p0 = anchorPoint(A, null, e.fromSide, cB);
    const p1 = anchorPoint(B, null, e.toSide, cA);
    let path = g.querySelector(`path.ink-edge[data-id="${CSS.escape(e.id)}"]`);
    if (!path) {
      path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.classList.add('ink-edge');
      path.dataset.id = e.id;
      g.appendChild(path);
    }
    path.setAttribute('d', bezierPath(p0, p1));
    const sel = selection.kind === 'edge' && selection.id === e.id;
    path.classList.toggle('selected', sel);
    path.setAttribute('stroke', sel ? accent : base);
    path.setAttribute('stroke-width', sel ? '3' : '2');
    path.setAttribute('fill', 'none');
    if (e.dashed) path.setAttribute('stroke-dasharray', '6 6');
    else path.removeAttribute('stroke-dasharray');
    if (e.arrow) path.setAttribute('marker-end', sel ? 'url(#arr-sel)' : 'url(#arr)');
    else path.removeAttribute('marker-end');
    syncLabel(e, path);
  }
  for (const el of [...g.querySelectorAll('path.ink-edge')]) {
    if (!seen.has(el.dataset.id)) el.remove();
  }
  for (const gl of [...g.querySelectorAll('g.edge-label')]) {
    if (!seen.has(gl.dataset.edge)) gl.remove();
  }
}

function center(n) {
  const s = nodeSize(n);
  return { x: n.x + s.w / 2, y: n.y + s.h / 2 };
}

function syncLabel(e, path) {
  let gl = g.querySelector(`g.edge-label[data-edge="${CSS.escape(e.id)}"]`);
  if (!e.label) { if (gl) gl.remove(); return; }
  if (!gl) {
    gl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gl.classList.add('edge-label');
    gl.dataset.edge = e.id;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    gl.append(rect, text);
    g.appendChild(gl);
  }
  const text = gl.querySelector('text');
  text.textContent = e.label;
  try {
    const mid = path.getPointAtLength(path.getTotalLength() / 2);
    gl.setAttribute('transform', `translate(${mid.x}, ${mid.y})`);
    const w = Math.max(34, e.label.length * 7.2 + 14);
    const rect = gl.querySelector('rect');
    rect.setAttribute('x', -w / 2); rect.setAttribute('y', -11);
    rect.setAttribute('width', w); rect.setAttribute('height', 22);
    rect.setAttribute('rx', 11);
  } catch { /* путь не в DOM — пересчитается на следующей перерисовке */ }
}

/* ---------- клик по ребру (устойчив к pointer-capture) ---------- */

export function initEdgeClicks(wrapEl) {
  wrapEl.addEventListener('click', (e) => {
    if (selection.kind === 'node' || inkJustUsed()) return;
    const path = resolveEdgeTarget(e);
    if (!path) return;
    const id = path.dataset.id;
    if (!getEdge(id)) return;
    if (selection.kind === 'edge' && selection.id === id) {
      deleteEdge(id);
      markDirty();
      select(null);
      return;
    }
    select('edge', id);
    const edge = getEdge(id);
    if (edge) openEdgePanel(edge);
  });
}

function resolveEdgeTarget(e) {
  const direct = e.target.closest && e.target.closest('path.ink-edge');
  if (direct) return direct;
  const under = document.elementFromPoint(e.clientX, e.clientY);
  return under && under.closest ? under.closest('path.ink-edge') : null;
}

let lastInkUse = 0;
export function noteInkUse() { lastInkUse = Date.now(); }
function inkJustUsed() { return Date.now() - lastInkUse < 300; }

/* ---------- панель связи ---------- */

const SIDE_LABELS = { auto: 'Авто', right: 'Право', bottom: 'Низ', left: 'Лево', top: 'Верх' };

function sideSelect(id, cur) {
  const sel = document.createElement('select');
  sel.id = id;
  for (const [val, label] of Object.entries(SIDE_LABELS)) {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = label;
    if (val === cur) opt.selected = true;
    sel.appendChild(opt);
  }
  return sel;
}

export function openEdgePanel(edge) {
  const panel = document.getElementById('edge-panel');
  panel.replaceChildren();

  const mkLabel = (input, text) => {
    const l = document.createElement('label');
    l.append(input, document.createTextNode(text));
    return l;
  };

  const arrow = document.createElement('input');
  arrow.type = 'checkbox'; arrow.checked = edge.arrow;
  arrow.addEventListener('change', () => { updateEdge(edge.id, { arrow: arrow.checked }); markDirty(); });

  const dashed = document.createElement('input');
  dashed.type = 'checkbox'; dashed.checked = edge.dashed;
  dashed.addEventListener('change', () => { updateEdge(edge.id, { dashed: dashed.checked }); markDirty(); });

  const labelInput = document.createElement('input');
  labelInput.id = 'ep-label'; labelInput.placeholder = 'Подпись'; labelInput.value = edge.label || '';
  labelInput.addEventListener('input', () => { updateEdge(edge.id, { label: labelInput.value }); markDirty(); });

  const fromSel = sideSelect('ep-from', edge.fromSide);
  fromSel.addEventListener('change', () => { updateEdge(edge.id, { fromSide: fromSel.value }); markDirty(); });

  const toSel = sideSelect('ep-to', edge.toSide);
  toSel.addEventListener('change', () => { updateEdge(edge.id, { toSide: toSel.value }); markDirty(); });

  const del = document.createElement('button');
  del.className = 'danger'; del.type = 'button'; del.textContent = 'Удалить связь';
  del.addEventListener('click', () => {
    deleteEdge(edge.id);
    markDirty();
    select(null);
  });

  const rowSides = document.createElement('div');
  rowSides.className = 'sides';
  rowSides.append(
    Object.assign(document.createElement('span'), { textContent: 'Из:' }), fromSel,
    Object.assign(document.createElement('span'), { textContent: 'В:' }), toSel,
  );

  panel.append(mkLabel(arrow, 'Стрелка'), mkLabel(dashed, 'Пунктир'), labelInput, rowSides, del);
  panel.classList.remove('hidden');
}

export function closeEdgePanel() {
  document.getElementById('edge-panel')?.classList.add('hidden');
}
