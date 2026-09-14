import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentBounds, fitTransform, MM_W, MM_H } from '../static/js/minimap.js';

test('contentBounds covers nodes, shapes and strokes', () => {
  const b = contentBounds(
    [{ x: -50, y: -40, w: 220, h: 84 }],
    [{ a: [500, 500], b: [600, 560] }],
    [{ points: [[10, 20], [30, 60]] }],
  );
  assert.equal(b.x, -50);
  assert.equal(b.y, -40);
  assert.equal(b.w, 650);
  assert.equal(b.h, 600);
});

test('contentBounds returns null when empty', () => {
  assert.equal(contentBounds([], [], []), null);
});

test('fitTransform fits bbox into panel with padding', () => {
  const t = fitTransform({ x: 0, y: 0, w: 1000, h: 700 });
  const PAD = 10;
  assert.ok(t.k > 0);
  assert.ok((1000 * t.k) <= MM_W - PAD * 2 + 0.001);
  assert.ok((700 * t.k) <= MM_H - PAD * 2 + 0.001);
  const left = t.ox;
  const right = (1000 * t.k) + t.ox;
  assert.ok(left >= 0 && right <= MM_W + 0.001);
});
