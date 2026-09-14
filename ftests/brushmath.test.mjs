import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ema, velocityTarget, pressureTarget, clampWidth, variableOutline, refineStroke } from '../static/js/brushmath.js';

test('ema converges toward value', () => {
  let v = 0;
  for (let i = 0; i < 50; i++) v = ema(v, 10);
  assert.ok(v > 9.5 && v <= 10);
});

test('velocityTarget: faster means thinner', () => {
  const slow = velocityTarget(0);
  const fast = velocityTarget(10);
  assert.ok(slow > fast);
  assert.ok(fast >= 0.3 && fast <= 0.5);
});

test('pressureTarget grows with pressure', () => {
  assert.ok(Math.abs(pressureTarget(1) - 1.6) < 1e-9);
  assert.ok(pressureTarget(0.5) > pressureTarget(0.1));
  assert.ok(pressureTarget(0.01) >= 0.5);
});

test('clampWidth respects min and max', () => {
  assert.equal(clampWidth(4, 99), 7.6);
  assert.equal(clampWidth(4, 0), 1.2);
  assert.equal(clampWidth(6, 6), 6);
});

test('variableOutline builds closed path around stroke', () => {
  const d = variableOutline([[0, 0], [100, 0]], [4, 4]);
  assert.ok(d.startsWith('M'));
  assert.ok(d.trim().endsWith('Z'));
});

test('variableOutline is a single closed quadratic subpath', () => {
  const d = variableOutline([[0, 0], [50, 10], [100, 0]], [4, 8, 4]);
  assert.equal((d.match(/M /g) || []).length, 1);
  assert.ok((d.match(/Q /g) || []).length >= 4);
  assert.ok(d.endsWith('Z'));
});

test('variableOutline survives a sharp reversal without NaN', () => {
  const d = variableOutline([[0, 0], [30, 0], [30.5, 2], [2, 3]], [5, 6, 6, 5]);
  assert.ok(!d.includes('NaN'), d);
  assert.ok(d.endsWith('Z'));
});

test('variableOutline never produces NaN on real input', () => {
  const pts = [[10.5, 20], [11, 20.4], [12.3, 21], [40, 60]];
  const widths = [3.1, 2.7, 5, 4.2];
  const d = variableOutline(pts, widths);
  assert.ok(!d.includes('NaN'), d);
});

test('refineStroke smooths, resamples and preserves endpoints', () => {
  const pts = [[0, 0], [1.2, 0.3], [2.4, -0.2], [30, 5], [60, 10]];
  const ws = [3, 4.2, 5.1, 6, 6];
  const ref = refineStroke(pts, ws, 2.5);
  assert.equal(ref.points.length, ref.widths.length);
  assert.ok(ref.points.length >= pts.length);
  assert.deepEqual(ref.points[0], [0, 0]);
  assert.deepEqual(ref.points[ref.points.length - 1], [60, 10]);
  for (const p of ref.points) assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]));
  for (const w of ref.widths) assert.ok(Number.isFinite(w));
});

test('refineStroke keeps straight line straight', () => {
  const line = [[0, 0], [20, 0], [40, 0], [80, 0]];
  const ref = refineStroke(line, [4, 4, 4, 4], 3);
  assert.ok(ref.points.every(p => Math.abs(p[1]) < 1e-9));
});
