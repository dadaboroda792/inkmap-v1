import { state, addStroke, deleteStroke, uid, markDirty, subscribe, replaceState, addShape } from './store.js';
import { screenToWorld, view } from './view.js';
import { noteInkUse } from './edges.js';
import { selection, select } from './input.js';
import { hitShape, deleteShape } from './shapes.js';
import { ema, velocityTarget, pressureTarget, clampWidth, variableOutline, refineStroke } from './brushmath.js';

let wrap = null, inkG = null, shapeG = null;
export let mode = 'off'; // off | select | pen | eraser | rect | ellipse | arrow

const PEN_KEY = 'inkmap-pen';
export const PEN_COLORS = ['auto', '#f1f3f7', '#1e2430', '#ff7676', '#ffd43b', '#69db7c', '#74c0fc'];
const settings = { color: 'auto', width: 2.5, eraser: 12, brush: 'pen' };
const INPUT_SMOOTH = 0.45;
const wStep = px => Math.max(0.4, px / Math.max(0.05, view.scale));

export const BRUSHES = {
  pen:         { f: 1,   op: 1,    cap: 'round', label: 'Ручка' },
  pencil:      { f: 0.6, op: 0.85, cap: 'round', label: 'Карандаш' },
  marker:      { f: 1.8, op: 0.55, cap: 'round', label: 'Маркер' },
  highlighter: { f: 4,   op: 0.3,  cap: 'butt',  label: 'Хайлайтер' },
};

export function setPenColor(c) { settings.color = c; saveSettings(); }
export function setPenWidth(w) { settings.width = Math.min(12, Math.max(1, w)); saveSettings(); }
export function setEraserRadius(r) { settings.eraser = Math.min(48, Math.max(4, r)); saveSettings(); }
export function setBrush(b) { if (BRUSHES[b]) { settings.brush = b; saveSettings(); } }
export function penSettings() { return { ...settings }; }

export function clearAllInk() {
  state.strokes.length = 0;
  state.shapes.length = 0;
  replaceState(state);
  markDirty();
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(PEN_KEY) || '{}');
    if (typeof saved.color === 'string') settings.color = saved.color;
    const w = +saved.width;
    if (w >= 1 && w <= 12) settings.width = w;
    const er = +saved.eraser;
    if (er >= 4 && er <= 48) settings.eraser = er;
    if (BRUSHES[saved.brush]) settings.brush = saved.brush;
  } catch {}
}
function saveSettings() {
  localStorage.setItem(PEN_KEY, JSON.stringify(settings));
}

function cssVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
function strokeColor() {
  return settings.color === 'auto' ? cssVar('--ink-color', '#aab3c5') : settings.color;
}

export function setMode(next) {
  mode = next;
  const drawModes = ['pen', 'eraser', 'rect', 'ellipse', 'arrow'];
  window.__inkMode = drawModes.includes(next);
  document.body.classList.toggle('mode-pen', next === 'pen');
  document.body.classList.toggle('mode-eraser', next === 'eraser');
  document.body.classList.toggle('mode-shape', ['rect', 'ellipse', 'arrow'].includes(next));
  document.getElementById('tool-select')?.classList.toggle('active', next === 'select');
  document.getElementById('tool-pen')?.classList.toggle('active', next === 'pen');
  document.getElementById('tool-eraser')?.classList.toggle('active', next === 'eraser');
  document.getElementById('tool-rect')?.classList.toggle('active', next === 'rect');
  document.getElementById('tool-ellipse')?.classList.toggle('active', next === 'ellipse');
  document.getElementById('tool-arrow')?.classList.toggle('active', next === 'arrow');
  document.getElementById('ink-bar')?.classList.toggle('hidden', !['pen', 'eraser'].includes(next));
  document.body.classList.toggle('mode-eraser-wide', next === 'eraser');
  document.body.classList.toggle('mode-text', next === 'text');
  document.getElementById('tool-text')?.classList.toggle('active', next === 'text');
  clearHighlights();
  if (next !== 'off') noteInkUse();
}

function clearHighlights() {
  document.querySelectorAll('.erase-target').forEach(el => el.classList.remove('erase-target'));
}

/* --- section --- */

function smoothPath(points) {
  if (points.length < 3) {
    return `M ${points[0][0]} ${points[0][1]} L ${points[points.length - 1][0]} ${points[points.length - 1][1]}`;
  }
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i][0] + points[i + 1][0]) / 2;
    const my = (points[i][1] + points[i + 1][1]) / 2;
    d += ` Q ${points[i][0]} ${points[i][1]}, ${mx} ${my}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

export function renderInk() {
  if (!inkG) return;
  const seen = new Set();
  for (const s of state.strokes) {
    seen.add(s.id);
    const B = BRUSHES[s.style || 'pen'] || BRUSHES.pen;
    const dyn = s.style !== 'highlighter' && Array.isArray(s.widths) && s.widths.length === s.points.length;
    let path = inkG.querySelector(`path[data-id="${CSS.escape(s.id)}"]`);
    if (!path) {
      path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.dataset.id = s.id;
      path.classList.add('ink-stroke');
      inkG.appendChild(path);
    }
    let d = null;
    if (dyn) {
      const ref = refineStroke(s.points, s.widths, wStep(1.25), true);
      d = variableOutline(ref.points, ref.widths);
    }
    if (d) {
      path.setAttribute('d', d);
      path.setAttribute('fill', s.color);
      path.setAttribute('fill-opacity', B.op);
      path.setAttribute('stroke', 'none');
      path.setAttribute('stroke-width', 0);
      path.classList.add('ink-stroke-fill');
    } else {
      paintUniformStroke(path, s, B);
    }
  }
  for (const el of [...inkG.querySelectorAll('path.ink-stroke')]) {
    if (el.dataset.id && !seen.has(el.dataset.id)) el.remove();
  }
}

function paintUniformStroke(path, s, B) {
  path.setAttribute('d', smoothPath(s.points));
  path.setAttribute('stroke', s.color);
  path.setAttribute('stroke-width', s.width);
  path.setAttribute('stroke-opacity', B.op);
  path.setAttribute('stroke-linecap', B.cap);
  path.setAttribute('fill', 'none');
  path.setAttribute('fill-opacity', 1);
  path.classList.remove('ink-stroke-fill');
}

function arrowHead(a, b, size) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const p = (t, r) => `${b[0] - Math.cos(ang - t) * r},${b[1] - Math.sin(ang - t) * r}`;
  return `M ${p(0.42, size)} L ${b[0]},${b[1]} L ${p(-0.42, size)}`;
}

export function renderShapes() {
  if (!shapeG) return;
  const seen = new Set();
  for (const sh of state.shapes || []) {
    seen.add(sh.id);
    let el = shapeG.querySelector(`[data-id="${CSS.escape(sh.id)}"]`);
    if (sh.type === 'arrow') {
      if (!el) {
        el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        el.classList.add('ink-shape');
        shapeG.appendChild(el);
      }
      let line = el.querySelector('.line');
      if (!line) {
        line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.classList.add('line');
        el.appendChild(line);
        const head = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        head.classList.add('head');
        el.appendChild(head);
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hit.classList.add('hit');
        el.appendChild(hit);
      }
      const d = `M ${sh.a[0]} ${sh.a[1]} L ${sh.b[0]} ${sh.b[1]}`;
      line.setAttribute('d', d);
      el.querySelector('.head').setAttribute('d', arrowHead(sh.a, sh.b, 10));
      el.querySelector('.hit').setAttribute('d', d);
      paintGroup(el, sh);
    } else {
      const tag = sh.type === 'ellipse' ? 'ellipse' : 'rect';
      if (!el || el.tagName.toLowerCase() !== tag) {
        if (el) el.remove();
        el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        el.classList.add('ink-shape');
        shapeG.appendChild(el);
      }
      el.dataset.id = sh.id;
      const x = Math.min(sh.a[0], sh.b[0]), y = Math.min(sh.a[1], sh.b[1]);
      const w = Math.abs(sh.b[0] - sh.a[0]), h = Math.abs(sh.b[1] - sh.a[1]);
      if (tag === 'rect') {
        el.setAttribute('x', x); el.setAttribute('y', y);
        el.setAttribute('width', w); el.setAttribute('height', h);
        el.setAttribute('rx', 6);
      } else {
        el.setAttribute('cx', x + w / 2); el.setAttribute('cy', y + h / 2);
        el.setAttribute('rx', w / 2); el.setAttribute('ry', h / 2);
      }
      paintShapeEl(el, sh);
    }
  }
  for (const el of [...shapeG.children]) {
    if (!seen.has(el.dataset.id) && !el.classList.contains('resize-handle')) el.remove();
  }
  updateShapeHandles();
}

function updateShapeHandles() {
  const sel = selection.kind === 'shape' ? state.shapes.find(s => s.id === selection.id) : null;
  [...shapeG.querySelectorAll('.resize-handle')].forEach(h => {
    if (!sel || h.dataset.sh !== sel.id) h.remove();
  });
  if (!sel || sel.type === 'arrow') return;
  ensureNeonFilter();
  const x = Math.min(sel.a[0], sel.b[0]), y = Math.min(sel.a[1], sel.b[1]);
  const w = Math.abs(sel.b[0] - sel.a[0]), h = Math.abs(sel.b[1] - sel.a[1]);
  const sc = view.scale || 1;
  const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
  const dirs = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  corners.forEach((cpt, i) => {
    let hd = shapeG.querySelector(`.resize-handle[data-corner="${i}"][data-sh="${CSS.escape(sel.id)}"]`);
    if (!hd) {
      hd = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      hd.classList.add('resize-handle');
      hd.dataset.corner = i;
      hd.dataset.sh = sel.id;
      const grab = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      grab.classList.add('grab');
      const bracket = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      bracket.classList.add('bracket');
      hd.append(grab, bracket);
      shapeG.appendChild(hd);
    }
    const L = 9 / sc;
    hd.setAttribute('transform', `translate(${cpt[0]} ${cpt[1]})`);
    const bracket = hd.querySelector('.bracket');
    bracket.setAttribute('d', `M ${L * dirs[i][0]} 0 L 0 0 L 0 ${L * dirs[i][1]}`);
    bracket.setAttribute('stroke-width', 2 / sc);
    hd.querySelector('.grab').setAttribute('r', 14 / sc);
  });
}

function ensureNeonFilter() {
  const defsEl = document.getElementById('scene-defs');
  if (!defsEl || defsEl.querySelector('#ink-neon')) return;
  const f = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  f.id = 'ink-neon';
  f.setAttribute('x', '-150%'); f.setAttribute('y', '-150%');
  f.setAttribute('width', '400%'); f.setAttribute('height', '400%');
  const blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
  blur.setAttribute('stdDeviation', '1.6');
  blur.setAttribute('result', 'b');
  const merge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
  const m1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
  m1.setAttribute('in', 'b');
  const m2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
  m2.setAttribute('in', 'SourceGraphic');
  merge.append(m1, m2);
  f.append(blur, merge);
  defsEl.appendChild(f);
}

function paintShapeEl(el, sh) {
  el.setAttribute('stroke', sh.color);
  el.setAttribute('stroke-width', sh.width);
  el.setAttribute('fill', sh.type === 'arrow' ? 'none' : 'transparent');
}
function paintGroup(g, sh) {
  g.dataset.id = sh.id;
  for (const t of g.querySelectorAll('path')) {
    t.setAttribute('stroke', sh.color);
    t.setAttribute('stroke-width', sh.width);
    t.setAttribute('fill', 'none');
  }
}

function distToStroke(s, p) {
  const pts = s.points;
  if (pts.length === 1) return Math.hypot(pts[0][0] - p.x, pts[0][1] - p.y);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const abx = b[0] - a[0], aby = b[1] - a[1];
    const l2 = abx * abx + aby * aby;
    let t = l2 ? ((p.x - a[0]) * abx + (p.y - a[1]) * aby) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p.x - (a[0] + abx * t), p.y - (a[1] + aby * t)));
  }
  return best;
}

function highlightAt(worldPt) {
  let victimStroke = null, best = Infinity;
  const thr = settings.eraser;
  for (const s of state.strokes) {
    const d = distToStroke(s, worldPt);
    if (d < best) { best = d; victimStroke = s; }
  }
  if (victimStroke && best > thr + (victimStroke.width || 2) / 2) victimStroke = null;
  const victimShape = victimStroke ? null : hitShape(worldPt);
  clearHighlights();
  if (victimStroke) {
    inkG.querySelector(`path[data-id="${CSS.escape(victimStroke.id)}"]`)?.classList.add('erase-target');
  } else if (victimShape) {
    shapeG.querySelector(`[data-id="${CSS.escape(victimShape.id)}"]`)?.classList.add('erase-target');
  }
  return victimStroke ? { kind: 'stroke', obj: victimStroke } : (victimShape ? { kind: 'shape', obj: victimShape } : null);
}

function eraseVictim(v) {
  if (!v) return;
  if (v.kind === 'stroke') deleteStroke(v.obj.id);
  else deleteShape(v.obj.id);
  markDirty();
}

export function initInk(wrapEl, svgEl) {
  wrap = wrapEl;
  inkG = svgEl.querySelector('#ink-g');
  shapeG = svgEl.querySelector('#shape-g');
  loadSettings();
  window.__inkDebug = { settings, distToStroke, highlightAt, get selkind() { return selection.kind; }, get selid() { return selection.id; }, get erasing() { return erasing; }, get drawing() { return drawing; }, get mode() { return mode; } };

  subscribe(() => { renderInk(); renderShapes(); });
  document.addEventListener('spark:selection', () => updateShapeHandles());

  let drawing = null;   // stroke
  let drafting = null;  // shape
  let erasing = null;   // victims until pointerup

  wrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !['pen', 'eraser', 'rect', 'ellipse', 'arrow'].includes(mode) || e.target.closest('.topbar, .panel, .menu, #ink-bar, #minimap, button')) return;
    e.preventDefault();
    e.stopPropagation();
    try { wrap.setPointerCapture(e.pointerId); } catch {}
    const w = screenToWorld(e.clientX, e.clientY);

    if (mode === 'eraser') {
      erasing = new Map();
      erasing.last = [w.x, w.y];
      collectAt(w);
      noteInkUse();
      return;
    }

    if (mode === 'pen') {
      const B = BRUSHES[settings.brush] || BRUSHES.pen;
      drawing = { id: uid('s'), points: [[w.x, w.y]], pressures: [e.pressure || 0.5], pointerType: e.pointerType, sx: w.x, sy: w.y };
      drawing.base = settings.width * B.f;
      const p0 = e.pressure || 0.5;
      drawing.factor = e.pointerType === 'pen' ? pressureTarget(p0) : 1.15;
      if (settings.brush !== 'highlighter') {
        const w0 = clampWidth(drawing.base, drawing.base * drawing.factor);
        drawing.widths = [w0];
        drawing.tail = { x: w.x, y: w.y, w: w0 };
        drawing.lastT = performance.now();
      }
      drawing.tempPath = tempPathEl(strokeColor(), settings.width * B.f, smoothPath(drawing.points), settings.brush);
      return;
    }

    // rect | ellipse | arrow
    drafting = { type: mode, a: [w.x, w.y], b: [w.x, w.y], el: null };
    if (mode === 'arrow') {
      drafting.el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      drafting.el.classList.add('ink-shape');
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.classList.add('line');
      const head = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      head.classList.add('head');
      drafting.el.append(line, head);
      shapeG.appendChild(drafting.el);
    } else {
      drafting.el = document.createElementNS('http://www.w3.org/2000/svg', mode === 'ellipse' ? 'ellipse' : 'rect');
      drafting.el.classList.add('ink-shape');
      shapeG.appendChild(drafting.el);
    }
  });

  wrap.addEventListener('pointermove', (e) => {
    updateEraserCursor(e);
    if (mode === 'eraser') {
      const w = screenToWorld(e.clientX, e.clientY);
      if (erasing) interpolateCollect(w); else highlightAt(w);
      return;
    }
    const w = screenToWorld(e.clientX, e.clientY);
    if (drawing) {
      drawing.sx += (w.x - drawing.sx) * INPUT_SMOOTH;
      drawing.sy += (w.y - drawing.sy) * INPUT_SMOOTH;
      const sw = { x: drawing.sx, y: drawing.sy };
      if (drawing.widths) {
        const now = performance.now();
        const dt = Math.max(1, now - drawing.lastT);
        const tail = drawing.tail;
        const dist = Math.hypot(sw.x - tail.x, sw.y - tail.y);
        drawing.lastT = now;
        const target = e.pointerType === 'pen' ? pressureTarget(e.pressure || 0.5) : velocityTarget((dist * Math.max(0.05, view.scale)) / dt);
        drawing.factor = ema(drawing.factor, target);
        const targetW = clampWidth(drawing.base, drawing.base * drawing.factor);
        if (dist > wStep(0.5)) {
          const step = wStep(1.25);
          const k = Math.max(1, Math.ceil(dist / step));
          for (let j = 1; j <= k; j++) {
            const t = j / k;
            drawing.points.push([tail.x + (sw.x - tail.x) * t, tail.y + (sw.y - tail.y) * t]);
            drawing.widths.push(tail.w + (targetW - tail.w) * t);
          }
          drawing.tail = { x: sw.x, y: sw.y, w: targetW };
        } else {
          drawing.widths[drawing.widths.length - 1] = targetW;
        }
        const ref = refineStroke(drawing.points, drawing.widths, wStep(1.25), true);
        drawing.tempPath.setAttribute('d', variableOutline(ref.points, ref.widths) || smoothPath(drawing.points));
        drawing.tempPath.classList.add('ink-stroke-fill');
        drawing.tempPath.setAttribute('stroke-width', 0.01);
        drawing.tempPath.setAttribute('stroke', 'none');
        drawing.tempPath.setAttribute('fill', strokeColor());
        drawing.tempPath.setAttribute('fill-opacity', BRUSHES[settings.brush].op);
      } else {
        drawing.points.push([drawing.sx, drawing.sy]);
        drawing.pressures.push(e.pressure || 0.5);
        drawing.tempPath.setAttribute('d', smoothPath(drawing.points));
      }
    } else if (drafting) {
      drafting.b = [w.x, w.y];
      updateDraft(drafting);
    }
  });

  function collectAt(w) {
    const v = highlightAt(w);
    if (v) erasing.set(v.kind + ':' + v.obj.id, v);
  }
  function interpolateCollect(w) {
    const [lx, ly] = erasing.last;
    const dist = Math.hypot(w.x - lx, w.y - ly);
    const step = Math.max(4, settings.eraser / 2);
    const n = Math.min(40, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      collectAt([lx + (w.x - lx) * i / n, ly + (w.y - ly) * i / n]);
    }
    collectAt(w);
    erasing.last = [w.x, w.y];
  }

  function finish() {
    try {
      if (mode === 'eraser' && erasing) {
        for (const v of erasing.values()) {
          if (v.kind === 'stroke') deleteStroke(v.obj.id);
          else deleteShape(v.obj.id);
        }
        if (erasing.size) markDirty();
        erasing = null;
        clearHighlights();
        noteInkUse();
        return;
      }
      if (drawing) {
        if (drawing.points.length > 1) {
          let wds = null;
          if (drawing.widths) {
            const ref = refineStroke(drawing.points, drawing.widths, wStep(1.75), false);
            wds = ref.widths.map(v => Math.round(v * 100) / 100);
          }
          addStroke({
            id: drawing.id, points: drawing.points,
            color: strokeColor(), width: Math.round(drawing.base * 10) / 10,
            style: settings.brush,
            ...(wds ? { widths: wds } : {}),
          });
          markDirty();
        }
        drawing.tempPath.remove();
        drawing = null;
        noteInkUse();
        return;
      }
      if (drafting) {
        const size = Math.hypot(drafting.b[0] - drafting.a[0], drafting.b[1] - drafting.a[1]);
        if (size >= 5) {
          const sh = addShape({
            id: uid('f'), type: drafting.type,
            a: drafting.a.map(Math.round), b: drafting.b.map(Math.round),
            color: strokeColor(), width: settings.width,
          });
          select('shape', sh.id);
          markDirty();
        }
        drafting.el.remove();
        drafting = null;
        setMode('select');
        noteInkUse();
      }
    } catch (err) {
      console.error('ink finish error:', err);
    }
  }
  wrap.addEventListener('pointerup', finish);
  wrap.addEventListener('pointercancel', finish);
}

function updateDraft(d) {
  const x = Math.min(d.a[0], d.b[0]), y = Math.min(d.a[1], d.b[1]);
  const w = Math.abs(d.b[0] - d.a[0]), h = Math.abs(d.b[1] - d.a[1]);
  const col = strokeColor();
  if (d.type === 'arrow') {
    d.el.querySelector('.line').setAttribute('d', `M ${d.a[0]} ${d.a[1]} L ${d.b[0]} ${d.b[1]}`);
    d.el.querySelector('.head').setAttribute('d', arrowHead(d.a, d.b, 10));
    for (const p of d.el.querySelectorAll('path')) {
      p.setAttribute('stroke', col); p.setAttribute('stroke-width', settings.width); p.setAttribute('fill', 'none');
    }
  } else if (d.type === 'ellipse') {
    d.el.setAttribute('cx', x + w / 2); d.el.setAttribute('cy', y + h / 2);
    d.el.setAttribute('rx', w / 2); d.el.setAttribute('ry', h / 2);
    d.el.setAttribute('stroke', col); d.el.setAttribute('stroke-width', settings.width); d.el.setAttribute('fill', 'transparent');
  } else {
    d.el.setAttribute('x', x); d.el.setAttribute('y', y);
    d.el.setAttribute('width', w); d.el.setAttribute('height', h);
    d.el.setAttribute('rx', 6);
    d.el.setAttribute('stroke', col); d.el.setAttribute('stroke-width', settings.width); d.el.setAttribute('fill', 'transparent');
  }
}

function tempPathEl(color, width, d, brush) {
  const B = BRUSHES[brush || 'pen'] || BRUSHES.pen;
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  t.classList.add('ink-stroke');
  t.setAttribute('stroke', color);
  t.setAttribute('stroke-width', width);
  t.setAttribute('stroke-opacity', B.op);
  t.setAttribute('stroke-linecap', B.cap);
  t.setAttribute('fill', 'none');
  t.setAttribute('d', d);
  inkG.appendChild(t);
  return t;
}

/* курсор-кружок ластика */
function updateEraserCursor(e) {
  const cur = document.getElementById('eraser-cursor');
  if (!cur || mode !== 'eraser') return;
  const r = settings.eraser * 2 * (view.scale || 1);
  cur.style.width = r + 'px';
  cur.style.height = r + 'px';
  cur.style.left = e.clientX - r / 2 + 'px';
  cur.style.top = e.clientY - r / 2 + 'px';
}


