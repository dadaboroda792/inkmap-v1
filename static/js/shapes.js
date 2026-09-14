import { state, deleteShape } from './store.js';

function distToSegment(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  let t = len2 ? ((p.x - a[0]) * abx + (p.y - a[1]) * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = p.x - (a[0] + abx * t), dy = p.y - (a[1] + aby * t);
  return Math.hypot(dx, dy);
}

export function hitShape(p) {
  const PAD = 6;
  for (let i = (state.shapes || []).length - 1; i >= 0; i--) {
    const sh = state.shapes[i];
    const x = Math.min(sh.a[0], sh.b[0]) - PAD;
    const y = Math.min(sh.a[1], sh.b[1]) - PAD;
    const w = Math.abs(sh.b[0] - sh.a[0]) + PAD * 2;
    const h = Math.abs(sh.b[1] - sh.a[1]) + PAD * 2;
    if (sh.type === 'arrow') {
      if (distToSegment(p, sh.a, sh.b) <= sh.width * 2 + 8) return sh;
      continue;
    }
    if (p.x < x || p.x > x + w || p.y < y || p.y > y + h) continue;
    if (sh.type === 'ellipse') {
      const rx = w / 2 || 1, ry = h / 2 || 1;
      const dx = (p.x - (x + w / 2)) / rx, dy = (p.y - (y + h / 2)) / ry;
      if (dx * dx + dy * dy <= 1.15) return sh;
    } else {
      return sh;
    }
  }
  return null;
}

export { deleteShape };
