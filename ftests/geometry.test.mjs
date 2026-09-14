import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipCenter, bezierPath } from '../static/js/edges.js';

test('clipCenter exits through right side', () => {
  const p = clipCenter({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 25 });
  assert.equal(p.x, 100);
  assert.equal(p.y, 25);
});

test('clipCenter exits through bottom side', () => {
  const p = clipCenter({ x: 0, y: 0, w: 100, h: 50 }, { x: 50, y: 400 });
  assert.equal(p.y, 50);
  assert.equal(p.x, 50);
});

test('clipCenter same center returns center', () => {
  const p = clipCenter({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5 });
  assert.deepEqual([p.x, p.y], [5, 5]);
});

import { applyZoom } from '../static/js/view.js';

const rect = { left: 0, top: 0 };

test('zoom at cursor keeps point fixed', () => {
  const v2 = applyZoom({ x: 0, y: 0, scale: 1 }, 300, 200, 2, rect);
  assert.equal(v2.scale, 2);
  assert.equal((300 - v2.x) / v2.scale, 300);
  assert.equal((200 - v2.y) / v2.scale, 200);
});

test('scale clamped 0.2..3', () => {
  assert.equal(applyZoom({ x: 0, y: 0, scale: 3 }, 0, 0, 10, rect).scale, 3);
  assert.equal(applyZoom({ x: 0, y: 0, scale: .2 }, 0, 0, .01, rect).scale, .2);
});
