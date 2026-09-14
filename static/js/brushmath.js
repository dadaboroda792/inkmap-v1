export function ema(prev, target, alpha = 0.25) {
  return prev + (target - prev) * alpha;
}

export function velocityTarget(v) {
  const t = Math.min(1, Math.max(0, (v - 0.12) / 1.5));
  return 1.35 - 0.95 * t;
}

export function pressureTarget(p) {
  return 0.45 + Math.min(1, Math.max(0.05, p)) * 1.15;
}

export function clampWidth(base, w) {
  return Math.min(base * 1.9, Math.max(base * 0.3, w));
}

function r2(v) {
  return Math.round(v * 100) / 100;
}

function rotAround(p, c, a) {
  const s = Math.sin(a), co = Math.cos(a);
  const dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * co - dy * s, c[1] + dx * s + dy * co];
}

function perp(v) {
  return [-v[1], v[0]];
}

export function strokeRing(points, widths) {
  const n = points.length;
  if (!Array.isArray(widths) || widths.length !== n || n < 2) return null;
  const vecs = new Array(n).fill(null);
  let lastT = null;
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 2)];
    const b = points[Math.min(n - 1, i + 2)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) { lastT = [dx / len, dy / len]; vecs[i] = [-lastT[0], -lastT[1]]; }
    else if (lastT) vecs[i] = [-lastT[0], -lastT[1]];
  }
  vecs[0] = vecs[1] || vecs[0] || [1, 0];
  for (let i = n - 1; i >= 1; i--) if (!vecs[i]) vecs[i] = vecs[i - 1];
  const hw = i => Math.max(0.25, widths[i]) / 2;
  const left = [], right = [];
  let prevSharp = false;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const r = hw(i);
    const v = vecs[i];
    if (i === n - 1) {
      const o = perp(v);
      left.push([p[0] - o[0] * r, p[1] - o[1] * r]);
      right.push([p[0] + o[0] * r, p[1] + o[1] * r]);
      break;
    }
    const nv = vecs[i + 1];
    const dot = v[0] * nv[0] + v[1] * nv[1];
    let ux, uy;
    if (dot <= -0.999) { ux = -v[0]; uy = -v[1]; }
    else {
      ux = nv[0] + (v[0] - nv[0]) * dot;
      uy = nv[1] + (v[1] - nv[1]) * dot;
      const ul = Math.hypot(ux, uy) || 1;
      ux /= ul; uy /= ul;
    }
    const isPrevSharp = (v[0] * vecs[Math.max(0, i - 1)][0] + v[1] * vecs[Math.max(0, i - 1)][1]) < 0 && !prevSharp;
    const isNextSharp = dot < 0;
    if ((i > 0 && isPrevSharp) || isNextSharp) {
      const pv = vecs[Math.max(0, i - 1)] || v;
      const o = perp(pv);
      const segs = 5;
      for (let s = 0; s <= segs; s++) {
        const t = (s / segs) * Math.PI;
        left.push(rotAround([p[0] - o[0] * r, p[1] - o[1] * r], p, t));
        right.push(rotAround([p[0] + o[0] * r, p[1] + o[1] * r], p, -t));
      }
      prevSharp = isNextSharp;
      continue;
    }
    prevSharp = false;
    const lp = [p[0] - perp(v)[0] * r, p[1] - perp(v)[1] * r];
    const rp = [p[0] + perp(v)[0] * r, p[1] + perp(v)[1] * r];
    left.push(lp);
    right.push(rp);
  }
  const ease = arr => {
    if (arr.length < 3) return arr;
    const src = arr.map(p => p.slice());
    const out = arr.map(p => p.slice());
    for (let i = 1; i < arr.length - 1; i++) {
      for (const k of [0, 1]) {
        const avg = (src[i - 1][k] + 2 * src[i][k] + src[i + 1][k]) / 4;
        out[i][k] += (avg - src[i][k]) * 0.4;
      }
    }
    return out;
  };
  const Ls = ease(left), Rs = ease(right);
  const first = points[0], lastP = points[n - 1];
  const endCap = [];
  const eo = perp(vecs[n - 1]);
  const eStart = [lastP[0] - eo[0] * hw(n - 1), lastP[1] - eo[1] * hw(n - 1)];
  const eSegs = 8;
  for (let s = 1; s < eSegs * 1.5; s++) endCap.push(rotAround(eStart, lastP, (Math.PI * 3 * s) / (eSegs * 1.5)));
  endCap.push([lastP[0] + eo[0] * hw(n - 1), lastP[1] + eo[1] * hw(n - 1)]);
  const startCap = [];
  const so = perp(vecs[0]);
  const sStart = [first[0] + so[0] * hw(0), first[1] + so[1] * hw(0)];
  const sSegs = 8;
  for (let s = 1; s <= sSegs; s++) startCap.push(rotAround(sStart, first, (Math.PI * s) / sSegs));
  return [...Ls, ...endCap, ...Rs.reverse(), ...startCap];
}

function ringToPath(ring) {
  const m = ring.length;
  if (m < 4) return null;
  const mx = i => (ring[i % m][0] + ring[(i + 1) % m][0]) / 2;
  const my = i => (ring[i % m][1] + ring[(i + 1) % m][1]) / 2;
  let d = `M ${r2(mx(0))} ${r2(my(0))} `;
  for (let i = 1; i <= m; i++) d += `Q ${r2(ring[i % m][0])} ${r2(ring[i % m][1])} ${r2(mx(i))} ${r2(my(i))} `;
  return `${d}Z`;
}

export function variableOutline(points, widths) {
  const ring = strokeRing(points, widths);
  return ring ? ringToPath(ring) : null;
}

function resampleByArc(pts, ws, step) {
  const outP = [pts[0].slice()], outW = [ws[0]];
  let acc = 0, prev = pts[0], prevW = ws[0];
  for (let i = 1; i < pts.length; i++) {
    let cur = pts[i];
    const cw = ws[i];
    let segLen = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    while (segLen > 0 && acc + segLen >= step) {
      const t = (step - acc) / segLen;
      prev = [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t];
      prevW += (cw - prevW) * t;
      segLen = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      acc = 0;
      outP.push(prev.slice());
      outW.push(prevW);
    }
    acc += segLen;
    prev = cur;
    prevW = cw;
  }
  const lp = pts[pts.length - 1], lw = ws[ws.length - 1];
  const lastOut = outP[outP.length - 1];
  if (lastOut[0] !== lp[0] || lastOut[1] !== lp[1]) { outP.push(lp.slice()); outW.push(lw); }
  return { points: outP, widths: outW };
}

function catmullRomDensify(pts, ws) {
  const n = pts.length;
  if (n < 3) return { points: pts, widths: ws };
  const outP = [pts[0].slice()], outW = [ws[0]];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(2, Math.min(28, Math.ceil(segLen / 1.5)));
    for (let s = 1; s <= steps; s++) {
      if (s === steps) { outP.push([p2[0], p2[1]]); outW.push(ws[i + 1]); continue; }
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      outP.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
      outW.push(ws[i] + (ws[i + 1] - ws[i]) * t);
    }
  }
  return { points: outP, widths: outW };
}

export function refineStroke(points, widths, step = 2.5, densify = true, budget = 4000) {
  const n = points?.length;
  if (!n || !Array.isArray(widths) || widths.length !== n || n < 2) return { points: points || [], widths: widths || [] };
  let pts = points.map(p => [p[0], p[1]]);
  let ws = widths.slice();
  for (let pass = 0; pass < 2; pass++) {
    const sp = pts.map(p => p.slice());
    const sw = ws.slice();
    for (let i = 1; i < pts.length - 1; i++) {
      for (const k of [0, 1]) {
        const avg = (sp[i - 1][k] + 2 * sp[i][k] + sp[i + 1][k]) / 4;
        pts[i][k] += (avg - sp[i][k]) * 0.55;
      }
      ws[i] += ((sw[i - 1] + 2 * sw[i] + sw[i + 1]) / 4 - sw[i]) * 0.35;
    }
  }
  ({ points: pts, widths: ws } = resampleByArc(pts, ws, step));
  if (densify) ({ points: pts, widths: ws } = catmullRomDensify(pts, ws));
  if (pts.length > budget) {
    const bigger = Math.ceil((pts.length / budget) * step);
    ({ points: pts, widths: ws } = resampleByArc(pts, ws, Math.max(step, bigger)));
  }
  const dp = pts.map(p => p.slice());
  for (let i = 1; i < pts.length - 1; i++) {
    for (const k of [0, 1]) pts[i][k] += ((dp[i - 1][k] + 2 * dp[i][k] + dp[i + 1][k]) / 4 - dp[i][k]) * 0.3;
    ws[i] += ((ws[i - 1] + 2 * ws[i] + ws[i + 1]) / 4 - ws[i]) * 0.25;
  }
  return { points: pts, widths: ws };
}
