import { view, applyView, screenToWorld } from './view.js';
import { state, addNode, deleteNode, deleteEdge, getNode, getEdge, addEdge, markDirty, duplicateNode, deleteShape, deleteStroke, updateShape, NODE_W, computeHiddenIds } from './store.js';
import { startTitleEdit, nodeSize, GROUP_COLLAPSED_H } from './nodes.js';
import { anchorPoint, bezierPath } from './edges.js';
import { hitShape } from './shapes.js';

export const selection = { kind: null, id: null, ids: new Set() };
export const dragState = { active: false };

export function select(kind, id) {
  selection.kind = kind;
  selection.id = id ?? null;
  selection.ids = kind === 'node' && id ? new Set([id]) : new Set();
  document.dispatchEvent(new CustomEvent('spark:selection'));
}

export function selectMany(ids) {
  selection.kind = ids.size ? 'node' : null;
  selection.id = null;
  selection.ids = new Set(ids);
  document.dispatchEvent(new CustomEvent('spark:selection'));
}

function hideEdgePanel() {
  document.getElementById('edge-panel')?.classList.add('hidden');
}

let spacePan = false;

export function initInput(wrap, viewport) {
  let pan = null, drag = null, linking = null, marquee = null, groupDrag = null, dragShape = null, resizingShape = null, resizingGroup = null, scalingImg = null;
  const marqueeEl = document.getElementById('marquee');

  function isUiTarget(e) {
    return e.target.closest('.n-title[contenteditable], .n-note[contenteditable], button, input, select, .n-colors, .panel, .menu, .topbar, #minimap');
  }

  function hitNode(worldPt) {
    const hidden = computeHiddenIds(state);
    const els = [...viewport.querySelectorAll('.ink-node')];
    for (let i = els.length - 1; i >= 0; i--) {
      const n = getNode(els[i].dataset.id);
      if (!n || hidden.has(n.id)) continue;
      const s = nodeSize(n, els[i]);
      if (worldPt.x >= n.x && worldPt.x <= n.x + s.w && worldPt.y >= n.y && worldPt.y <= n.y + s.h) {
        return { node: n, el: els[i] };
      }
    }
    return null;
  }

  function groupSnapshot() {
    const nodes = [...selection.ids].map(getNode).filter(Boolean).map(n => ({ n, x: n.x, y: n.y }));
    const shapes = state.shapes.filter(s => selection.ids.has(s.id)).map(s => ({ s, a: [...s.a], b: [...s.b] }));
    const strokes = state.strokes.filter(s => selection.ids.has(s.id)).map(s => ({ s, pts: s.points.map(p => [...p]) }));
    return { nodes, shapes, strokes };
  }

  function grabGroupAt(p) {
    let best = null, bestArea = Infinity;
    for (const n of state.nodes) {
      if (!n.isGroup) continue;
      const eh = n.collapsed ? GROUP_COLLAPSED_H : n.h;
      if (p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + eh) {
        const area = n.w * eh;
        if (area < bestArea) { best = n; bestArea = area; }
      }
    }
    return best;
  }

  function beginGroupDrag(gid, w) {
    const g = getNode(gid);
    if (!g) return false;
    const members = state.nodes.filter(nn => nn.groupId === gid && !nn.isGroup);
    groupDrag = {
      g: {
        nodes: [{ n: g, x: g.x, y: g.y }, ...members.map(cn => ({ n: cn, x: cn.x, y: cn.y }))],
        shapes: state.shapes.filter(ss => ss.groupId === gid).map(ss => ({ s: ss, a: [...ss.a], b: [...ss.b] })),
        strokes: [],
      },
      start: w, moved: false, lastSave: Date.now(),
    };
    select('node', g.id);
    return true;
  }

  function applyGroupMove(g, dx, dy) {
    for (const m of g.nodes) { m.n.x = Math.round(m.x + dx); m.n.y = Math.round(m.y + dy); }
    for (const m of g.shapes) { m.s.a = [m.a[0] + dx, m.a[1] + dy]; m.s.b = [m.b[0] + dx, m.b[1] + dy]; }
    for (const m of g.strokes) { m.s.points = m.pts.map(p => [p[0] + dx, p[1] + dy]); }
    document.dispatchEvent(new CustomEvent('spark:nodes-moved'));
  }

  wrap.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#edge-panel, #node-panel, #minimap')) return;

    // средняя кнопка или Space — панорамирование (работает в ЛЮБОМ режиме)
    const onUi = e.target.closest('.topbar, .panel, .menu, button');
    if ((e.button === 1 || (e.button === 0 && spacePan)) && !onUi) {
      e.preventDefault();
      pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      try { wrap.setPointerCapture(e.pointerId); } catch {}
      return;
    }

    if (window.__inkMode) return;
    if (e.button !== 0) return;

    const portEl = e.target.closest('.n-port');
    if (portEl) {
      e.preventDefault();
      e.stopPropagation();
      const from = getNode(portEl.closest('.ink-node')?.dataset.id);
      if (!from) return;
      try { wrap.setPointerCapture(e.pointerId); } catch {}
      const temp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      temp.classList.add('spark-temp');
      document.getElementById('edge-g').appendChild(temp);
      linking = { from, tempPath: temp, targetEl: null };
      return;
    }

    const handle = e.target.closest('.resize-handle');
    if (handle && !window.__inkMode) {
      e.preventDefault();
      e.stopPropagation();
      const sh = state.shapes.find(s => s.id === handle.dataset.sh);
      if (!sh) return;
      const corner = +handle.dataset.corner;
      const w = screenToWorld(e.clientX, e.clientY);
      const fixed = { x: sh.a[0] + sh.b[0] - w.x, y: sh.a[1] + sh.b[1] - w.y };
      resizingShape = { sh, corner, fixed };
      select('shape', sh.id);
      try { wrap.setPointerCapture(e.pointerId); } catch {}
      return;
    }

    const imgScale = e.target.closest('.img-scale');
    if (imgScale) {
      e.preventDefault();
      e.stopPropagation();
      const node = getNode(imgScale.closest('.ink-node')?.dataset.id);
      if (!node || !node.isImage) return;
      const w = screenToWorld(e.clientX, e.clientY);
      scalingImg = { node, startW: node.w || 320, ratio: (node.h || 200) / (node.w || 320), sx: w.x };
      select('node', node.id);
      try { wrap.setPointerCapture(e.pointerId); } catch {}
      return;
    }

    const shapeEl = e.target.closest('.ink-shape');
    if (shapeEl && !isUiTarget(e)) {
      const sh = state.shapes.find(s => s.id === shapeEl.dataset.id);
      if (sh) {
        select('shape', sh.id);
        hideEdgePanel();
        const w = screenToWorld(e.clientX, e.clientY);
        dragShape = { sh, a0: [...sh.a], b0: [...sh.b], start: w, moved: false, lastSave: Date.now() };
        try { wrap.setPointerCapture(e.pointerId); } catch {}
        return;
      }
    }

    const gHandle = e.target.closest('.g-handle');
    if (gHandle) {
      e.preventDefault();
      e.stopPropagation();
      const gn = getNode(gHandle.closest('.ink-node').dataset.id);
      if (!gn || !gn.isGroup) return;
      resizingGroup = { node: gn, corner: +gHandle.dataset.corner, orig: { x: gn.x, y: gn.y, w: gn.w, h: gn.h } };
      select('node', gn.id);
      try { wrap.setPointerCapture(e.pointerId); } catch {}
      return;
    }

    const nodeEl = e.target.closest('.ink-node');
    if (nodeEl && e.target.closest('.n-audio')) {
      const node = getNode(nodeEl.dataset.id);
      if (node && !selection.ids.has(node.id)) select('node', node.id);
      return;
    }
    if (nodeEl && !isUiTarget(e)) {
      const node = getNode(nodeEl.dataset.id);
      if (!node) return;
      const w = screenToWorld(e.clientX, e.clientY);
      if (node.isGroup) {
        if (!beginGroupDrag(node.id, w)) return;
        try { wrap.setPointerCapture(e.pointerId); } catch {}
        return;
      }
      if (selection.ids.has(node.id) && selection.ids.size > 1) {
        groupDrag = { g: groupSnapshot(), start: w, moved: false };
      } else {
        if (!e.shiftKey) select('node', node.id);
        else {
          const ids = new Set(selection.ids); ids.add(node.id); selectMany(ids);
        }
        drag = { node, dx: w.x - node.x, dy: w.y - node.y, moved: false, lastSave: Date.now() };
        if (!e.shiftKey) select('node', node.id);
      }
      try { wrap.setPointerCapture(e.pointerId); } catch {}
      return;
    }

    if (!nodeEl && !isUiTarget(e)) {
      const w0 = screenToWorld(e.clientX, e.clientY);
      if (document.body.classList.contains('mode-text')) {
        const tn = addNode({ isText: true, allowOverlap: true, title: '', x: Math.round(w0.x - 60), y: Math.round(w0.y - 16) });
        markDirty();
        select('node', tn.id);
        startTitleEdit(tn);
        return;
      }
      const overShape = hitShape(w0);
      const overEdge = e.target.closest && e.target.closest('path.ink-edge');
      if (!overShape && !overEdge) {
        const g = grabGroupAt(w0);
        if (g && beginGroupDrag(g.id, w0)) {
          try { wrap.setPointerCapture(e.pointerId); } catch {}
          return;
        }
      }
      if (!e.shiftKey) { select(null); hideEdgePanel(); }
      // рамка выделения
      marquee = { x0: e.clientX, y0: e.clientY, additive: e.shiftKey && selection.ids.size ? new Set(selection.ids) : new Set() };
      marqueeEl.classList.remove('hidden');
      marqueeEl.style.left = e.clientX + 'px';
      marqueeEl.style.top = e.clientY + 'px';
      marqueeEl.style.width = '0px';
      marqueeEl.style.height = '0px';
      try { wrap.setPointerCapture(e.pointerId); } catch {}
    }
  });

  wrap.addEventListener('pointermove', (e) => {
    if (linking) {
      const w = screenToWorld(e.clientX, e.clientY);
      linking.lastWorld = w;
      const els = [...viewport.querySelectorAll('.ink-node')];
      let hit = null;
      for (let i = els.length - 1; i >= 0; i--) {
        const n = getNode(els[i].dataset.id);
        if (!n || n.id === linking.from.id) continue;
        const s = nodeSize(n, els[i]);
        if (w.x >= n.x && w.x <= n.x + s.w && w.y >= n.y && w.y <= n.y + s.h) { hit = { el: els[i] }; break; }
      }
      if (linking.targetEl && (!hit || hit.el !== linking.targetEl)) linking.targetEl.classList.remove('link-target');
      linking.targetEl = hit ? hit.el : null;
      if (linking.targetEl) linking.targetEl.classList.add('link-target');
      const a = anchorPoint(linking.from, null, 'auto', w);
      linking.tempPath.setAttribute('d', bezierPath(a, w));
      return;
    }

    if (pan) {
      view.x = pan.vx + (e.clientX - pan.x);
      view.y = pan.vy + (e.clientY - pan.y);
      applyView();
      return;
    }

    if (marquee) {
      const x = Math.min(marquee.x0, e.clientX), y = Math.min(marquee.y0, e.clientY);
      marqueeEl.style.left = x + 'px';
      marqueeEl.style.top = y + 'px';
      marqueeEl.style.width = Math.abs(e.clientX - marquee.x0) + 'px';
      marqueeEl.style.height = Math.abs(e.clientY - marquee.y0) + 'px';
      return;
    }

    if (resizingShape) {
      const w = screenToWorld(e.clientX, e.clientY);
      const sh = resizingShape.sh;
      const nx = Math.min(resizingShape.fixed.x, w.x), ny = Math.min(resizingShape.fixed.y, w.y);
      const nb = { x: Math.max(resizingShape.fixed.x, w.x), y: Math.max(resizingShape.fixed.y, w.y) };
      sh.a = [nx, ny]; sh.b = [nb.x, nb.y];
      updateShape(sh.id, { a: sh.a, b: sh.b });
      return;
    }

    if (resizingGroup) {
      const rg = resizingGroup, n = rg.node, o = rg.orig;
      const w = screenToWorld(e.clientX, e.clientY);
      let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
      if (rg.corner === 0) { x0 = w.x; y0 = w.y; }
      if (rg.corner === 1) { x1 = w.x; y0 = w.y; }
      if (rg.corner === 2) { x0 = w.x; y1 = w.y; }
      if (rg.corner === 3) { x1 = w.x; y1 = w.y; }
      n.x = Math.round(Math.min(x0, x1)); n.y = Math.round(Math.min(y0, y1));
      n.w = Math.max(120, Math.round(Math.abs(x1 - x0)));
      n.h = Math.max(80, Math.round(Math.abs(y1 - y0)));
      document.dispatchEvent(new CustomEvent('spark:nodes-moved'));
      return;
    }

    if (dragShape) {
      const w = screenToWorld(e.clientX, e.clientY);
      const dx = w.x - dragShape.start.x, dy = w.y - dragShape.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) dragShape.moved = true;
      dragShape.sh.a = [dragShape.a0[0] + dx, dragShape.a0[1] + dy];
      dragShape.sh.b = [dragShape.b0[0] + dx, dragShape.b0[1] + dy];
      updateShape(dragShape.sh.id, { a: dragShape.sh.a, b: dragShape.sh.b });
      return;
    }

    if (scalingImg) {
      const w = screenToWorld(e.clientX, e.clientY);
      const nw = Math.max(48, Math.round(scalingImg.startW + (w.x - scalingImg.sx)));
      scalingImg.node.w = nw;
      scalingImg.node.h = Math.round(nw * scalingImg.ratio);
      document.dispatchEvent(new CustomEvent('spark:nodes-moved'));
      return;
    }

    if (groupDrag) {
      const w = screenToWorld(e.clientX, e.clientY);
      const dx = w.x - groupDrag.start.x, dy = w.y - groupDrag.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) groupDrag.moved = true;
      applyGroupMove(groupDrag.g, dx, dy);
      dragState.active = true;
      if (Date.now() - (groupDrag.lastSave || 0) > 5000) { groupDrag.lastSave = Date.now(); markDirty(); }
      return;
    }

    if (drag) {
      const w = screenToWorld(e.clientX, e.clientY);
      drag.node.x = Math.round(w.x - drag.dx);
      drag.node.y = Math.round(w.y - drag.dy);
      drag.moved = true;
      dragState.active = true;
      const el = viewport.querySelector(`.ink-node[data-id="${CSS.escape(drag.node.id)}"]`);
      if (el) { el.style.left = drag.node.x + 'px'; el.style.top = drag.node.y + 'px'; }
      document.dispatchEvent(new CustomEvent('spark:nodes-moved'));
      if (Date.now() - drag.lastSave > 5000) { drag.lastSave = Date.now(); markDirty(); }
    }
  });

  function finishLinking() {
    const hit = linking.lastWorld ? hitNode(linking.lastWorld) : null;
    if (hit && hit.node.id !== linking.from.id) {
      addEdge({ from: linking.from.id, to: hit.node.id });
      markDirty();
    }
    linking.tempPath.remove();
    if (linking.targetEl) linking.targetEl.classList.remove('link-target');
    linking = null;
  }
  function cancelLinking() {
    linking.tempPath.remove();
    if (linking.targetEl) linking.targetEl.classList.remove('link-target');
    linking = null;
  }

  function finishMarquee(e) {
    const x0 = Math.min(marquee.x0, e.clientX), x1 = Math.max(marquee.x0, e.clientX);
    const y0 = Math.min(marquee.y0, e.clientY), y1 = Math.max(marquee.y0, e.clientY);
    marqueeEl.classList.add('hidden');
    const ids = marquee.additive;
    const w0 = screenToWorld(x0, y0), w1 = screenToWorld(x1, y1);
    const L = Math.min(w0.x, w1.x), R = Math.max(w0.x, w1.x);
    const T = Math.min(w0.y, w1.y), B = Math.max(w0.y, w1.y);
    if (R - L > 4 && B - T > 4) {
      const hidden = computeHiddenIds(state);
      for (const n of state.nodes) {
        if (hidden.has(n.id)) continue;
        const s = nodeSize(n);
        if (n.x < R && n.x + s.w > L && n.y < B && n.y + s.h > T) ids.add(n.id);
      }
      for (const sh of state.shapes) {
        const sx = Math.min(sh.a[0], sh.b[0]), sy = Math.min(sh.a[1], sh.b[1]);
        const sw = Math.abs(sh.b[0] - sh.a[0]), shh = Math.abs(sh.b[1] - sh.a[1]);
        if (sx < R && sx + sw > L && sy < B && sy + shh > T) ids.add(sh.id);
      }
      for (const st of state.strokes) {
        if (st.points.some(p => p[0] >= L && p[0] <= R && p[1] >= T && p[1] <= B)) ids.add(st.id);
      }
    }
    marquee = null;
    selectMany(ids);
    if (ids.size) hideEdgePanel();
  }

  function assignGroup(node) {
    if (node.isGroup) return;
    const cx = node.x + node.w / 2, cy = node.y + node.h / 2;
    let g = null;
    for (const n of state.nodes) {
      if (!n.isGroup || n.id === node.id || n.collapsed) continue;
      const eh = n.collapsed ? GROUP_COLLAPSED_H : n.h;
      if (cx > n.x && cx < n.x + n.w && cy > n.y && cy < n.y + eh) { g = n; break; }
    }
    const newGid = g ? g.id : null;
    if ((node.groupId || null) !== newGid) { node.groupId = newGid; markDirty(); }
  }

  wrap.addEventListener('pointerup', (e) => {
    if (linking) finishLinking();
    if (marquee) { finishMarquee(e); dragState.active = false; return; }
    if (resizingShape) { markDirty(); resizingShape = null; return; }
    if (resizingGroup) {
      markDirty();
      for (const ch of state.nodes) {
        if (ch.groupId === resizingGroup.node.id) assignGroup(ch);
      }
      resizingGroup = null;
      return;
    }
    if (groupDrag) { if (groupDrag.moved) markDirty(); groupDrag = null; dragState.active = false; return; }
    if (scalingImg) { markDirty(); scalingImg = null; dragState.active = false; return; }
    if (dragShape) { if (dragShape.moved) markDirty(); dragShape = null; dragState.active = false; return; }
    if (drag) {
      if (drag.moved) {
        markDirty();
        assignGroup(drag.node);
      }
    }
    pan = null; drag = null; dragState.active = false;
  });

  wrap.addEventListener('pointercancel', () => {
    if (linking) cancelLinking();
    if (marquee) { marqueeEl.classList.add('hidden'); marquee = null; }
    if (dragShape) dragShape = null;
    scalingImg = null;
    if (groupDrag && groupDrag.moved) markDirty();
    groupDrag = null;
    if (drag && drag.moved) markDirty();
    pan = null; drag = null; dragState.active = false;
  });

  wrap.addEventListener('dblclick', (e) => {
    if (window.__inkMode || document.body.classList.contains('mode-text')) return;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (under && under.closest && under.closest('button')) return;
    const hit = under && under.closest && under.closest('.ink-node')
      ? hitNode(screenToWorld(e.clientX, e.clientY))
      : null;
    if (hit) {
      select('node', hit.node.id);
      startTitleEdit(hit.node);
      return;
    }
    const w = screenToWorld(e.clientX, e.clientY);
    const node = addNode({ x: Math.round(w.x - 110), y: Math.round(w.y - 24), title: '' });
    markDirty();
    select('node', node.id);
    startTitleEdit(node);
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !spacePan) {
      const t = document.activeElement;
      if (!t || (!t.isContentEditable && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) {
        spacePan = true;
        document.body.classList.add('space-pan');
        if (e.target === document.body) e.preventDefault();
      }
      return;
    }
    if (e.key === 'Escape') {
      const t = document.activeElement;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) t.blur();
      select(null);
      hideEdgePanel();
      return;
    }
    const t = document.activeElement;
    if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selection.ids.size) {
        for (const id of selection.ids) {
          if (getNode(id)) deleteNode(id);
          else if (state.shapes.some(s => s.id === id)) deleteShape(id);
          else if (state.strokes.some(s => s.id === id)) deleteStroke(id);
        }
        markDirty();
        select(null);
      } else if (selection.kind === 'edge' && selection.id && getEdge(selection.id)) {
        deleteEdge(selection.id); markDirty(); select(null);
      }
      return;
    }

    if (e.key === 'Enter' && selection.kind === 'node' && selection.ids.size === 1 && getNode(selection.id)) {
      e.preventDefault();
      startTitleEdit(getNode(selection.id));
      return;
    }

    if (e.ctrlKey && !e.shiftKey && e.code === 'KeyD' && selection.ids.size) {
      e.preventDefault();
      const newIds = new Set(selection.ids);
      for (const id of [...selection.ids]) {
        const n = getNode(id);
        if (n) { const copy = duplicateNode(n.id); markDirty(); newIds.add(copy.id); }
      }
      selectMany(newIds);
      return;
    }

    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (nudge && selection.ids.size) {
      e.preventDefault();
      const step = e.shiftKey ? 12 : 2;
      for (const id of selection.ids) {
        const node = getNode(id);
        if (node) { node.x += nudge[0] * step; node.y += nudge[1] * step; }
        else {
          const sh = state.shapes.find(s => s.id === id);
          if (sh) { sh.a = [sh.a[0] + nudge[0] * step, sh.a[1] + nudge[1] * step]; sh.b = [sh.b[0] + nudge[0] * step, sh.b[1] + nudge[1] * step]; }
          else {
            const st = state.strokes.find(s => s.id === id);
            if (st) st.points = st.points.map(p => [p[0] + nudge[0] * step, p[1] + nudge[1] * step]);
          }
        }
      }
      document.dispatchEvent(new CustomEvent('spark:nodes-moved'));
      markDirty();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spacePan = false;
      document.body.classList.remove('space-pan');
    }
  });

  document.getElementById('edge-panel').addEventListener('pointerdown', (e) => e.stopPropagation());
}
