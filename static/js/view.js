export const view = { x: 0, y: 0, scale: 1 };

let wrap = null, viewport = null;
const changeSubs = new Set();

export function onViewChange(fn) { changeSubs.add(fn); }

export function applyZoom(v, clientX, clientY, factor, r) {
  const scale = Math.min(3, Math.max(0.2, v.scale * factor));
  const wx = (clientX - r.left - v.x) / v.scale;
  const wy = (clientY - r.top - v.y) / v.scale;
  return { scale, x: clientX - r.left - wx * scale, y: clientY - r.top - wy * scale };
}

export function initView(wrapEl, viewportEl) {
  wrap = wrapEl; viewport = viewportEl;
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    Object.assign(view, applyZoom(view, e.clientX, e.clientY, factor, wrap.getBoundingClientRect()));
    applyView();
  }, { passive: false });
}

export function applyView() {
  viewport.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  for (const fn of changeSubs) fn();
}

export function screenToWorld(clientX, clientY) {
  const r = wrap.getBoundingClientRect();
  return {
    x: (clientX - r.left - view.x) / view.scale,
    y: (clientY - r.top - view.y) / view.scale,
  };
}

export function centerOn(worldX, worldY) {
  const r = wrap.getBoundingClientRect();
  view.x = r.width / 2 - worldX * view.scale;
  view.y = r.height / 2 - worldY * view.scale;
  applyView();
}
