export const MM_W = 200;
export const MM_H = 140;
const PAD = 10;

export function contentBounds(nodes, shapes, strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + (n.w || 220)); y1 = Math.max(y1, n.y + (n.h || 84));
  }
  for (const s of shapes) {
    for (const p of [s.a, s.b]) {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
  }
  for (const st of strokes) {
    for (const p of st.points) {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
  }
  if (!isFinite(x0)) return null;
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

export function fitTransform(bbox) {
  const k = Math.min((MM_W - PAD * 2) / bbox.w, (MM_H - PAD * 2) / bbox.h);
  return {
    k,
    ox: (MM_W - bbox.w * k) / 2 - bbox.x * k,
    oy: (MM_H - bbox.h * k) / 2 - bbox.y * k,
  };
}

import { state, subscribe, computeHiddenIds } from './store.js';
import { view, applyView, onViewChange } from './view.js';

let mmEl = null, svgEl = null, rectEl = null, wrapEl = null;
let T = { k: 0.1, ox: 0, oy: 0 };
let mmScheduled = false;
const NS = 'http://www.w3.org/2000/svg';

export function initMinimap(wrap) {
  wrapEl = wrap;
  mmEl = document.createElement('div');
  mmEl.id = 'minimap';
  mmEl.innerHTML = `<svg id="mm-svg" width="${MM_W}" height="${MM_H}"></svg><div id="mm-rect"></div>`;
  wrap.appendChild(mmEl);
  svgEl = mmEl.querySelector('#mm-svg');
  rectEl = mmEl.querySelector('#mm-rect');
  if (localStorage.getItem('inkmap-minimap') === 'off') mmEl.classList.add('hidden');

  subscribe(() => {
    if (mmScheduled) return;
    mmScheduled = true;
    requestAnimationFrame(() => { mmScheduled = false; render(); });
  });
  onViewChange(positionRect);
  render();
  positionRect();

  mmEl.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try { mmEl.setPointerCapture(e.pointerId); } catch {}
    jump(e);
    const move = ev => { ev.preventDefault(); ev.stopPropagation(); jump(ev); };
    const up = ev => {
      ev.stopPropagation();
      mmEl.removeEventListener('pointermove', move);
      mmEl.removeEventListener('pointerup', up);
      mmEl.removeEventListener('pointercancel', up);
    };
    mmEl.addEventListener('pointermove', move);
    mmEl.addEventListener('pointerup', up);
    mmEl.addEventListener('pointercancel', up);
  });
}

export function toggleMinimap() {
  mmEl.classList.toggle('hidden');
  localStorage.setItem('inkmap-minimap', mmEl.classList.contains('hidden') ? 'off' : 'on');
}

function currentBBox() {
  const hidden = computeHiddenIds(state);
  const b = contentBounds(state.nodes.filter(n => !hidden.has(n.id)), state.shapes, state.strokes);
  if (b) return b;
  const r = wrapEl.getBoundingClientRect();
  return { x: -view.x / view.scale, y: -view.y / view.scale, w: r.width / view.scale, h: r.height / view.scale };
}

function el(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function render() {
  if (!svgEl || mmEl.classList.contains('hidden')) return;
  T = fitTransform(currentBBox());
  while (svgEl.firstChild) svgEl.firstChild.remove();

  for (const s of state.strokes.slice(0, 120)) {
    const pts = s.points.filter((_, i) => i % 3 === 0)
      .map(p => `${(p[0] * T.k + T.ox).toFixed(1)},${(p[1] * T.k + T.oy).toFixed(1)}`).join(' ');
    if (!pts) continue;
    svgEl.appendChild(el('polyline', { points: pts, fill: 'none', stroke: s.color || '#8a93a6', 'stroke-width': Math.max(0.5, s.width * T.k), opacity: 0.55 }));
  }
  for (const sh of state.shapes.slice(0, 120)) {
    const x = (Math.min(sh.a[0], sh.b[0]) * T.k + T.ox).toFixed(1);
    const y = (Math.min(sh.a[1], sh.b[1]) * T.k + T.oy).toFixed(1);
    const w = (Math.abs(sh.b[0] - sh.a[0]) * T.k).toFixed(1);
    const h = (Math.abs(sh.b[1] - sh.a[1]) * T.k).toFixed(1);
    if (sh.type === 'arrow') {
      svgEl.appendChild(el('line', { x1: x, y1: y, x2: +x + +w, y2: +y + +h, stroke: sh.color || '#8a93a6', 'stroke-width': 1 }));
    } else {
      svgEl.appendChild(el(sh.type === 'ellipse' ? 'ellipse' : 'rect',
        sh.type === 'ellipse'
          ? { cx: +x + +w / 2, cy: +y + +h / 2, rx: +w / 2 || 1, ry: +h / 2 || 1, fill: 'none', stroke: sh.color || '#8a93a6', 'stroke-width': 1 }
          : { x, y, width: Math.max(1, +w), height: Math.max(1, +h), fill: 'none', stroke: sh.color || '#8a93a6', 'stroke-width': 1 }));
    }
  }
  const mmNodeColor = getComputedStyle(document.documentElement).getPropertyValue('--mm-node').trim() || 'rgba(108,140,255,.35)';
  const hidden = computeHiddenIds(state);
  for (const n of state.nodes.slice(0, 250)) {
    if (hidden.has(n.id)) continue;
    const h = n.isGroup && n.collapsed ? 24 : (n.h || 84);
    const r = el('rect', {
      x: (n.x * T.k + T.ox).toFixed(1), y: (n.y * T.k + T.oy).toFixed(1),
      width: Math.max(2, (n.w || 220) * T.k).toFixed(1), height: Math.max(2, h * T.k).toFixed(1),
      rx: 1.5,
      fill: n.isGroup ? 'none' : (n.color || mmNodeColor),
      stroke: 'rgba(128,140,170,.7)', 'stroke-width': 0.8,
    });
    svgEl.appendChild(r);
  }
  positionRect();
}

function positionRect() {
  if (!rectEl || !wrapEl || mmEl.classList.contains('hidden')) return;
  const r = wrapEl.getBoundingClientRect();
  const wx = -view.x / view.scale, wy = -view.y / view.scale;
  const w = Math.min(MM_W, Math.max(6, r.width / view.scale * T.k));
  const h = Math.min(MM_H, Math.max(6, r.height / view.scale * T.k));
  rectEl.style.width = w + 'px';
  rectEl.style.height = h + 'px';
  rectEl.style.left = Math.min(Math.max(wx * T.k + T.ox, 0), Math.max(0, MM_W - w)) + 'px';
  rectEl.style.top = Math.min(Math.max(wy * T.k + T.oy, 0), Math.max(0, MM_H - h)) + 'px';
}

function jump(e) {
  const r = mmEl.getBoundingClientRect();
  const wx = (e.clientX - r.left - T.ox) / T.k;
  const wy = (e.clientY - r.top - T.oy) / T.k;
  const wr = wrapEl.getBoundingClientRect();
  view.x = wr.width / 2 - wx * view.scale;
  view.y = wr.height / 2 - wy * view.scale;
  applyView();
}
