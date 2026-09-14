import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeState, uid, addNode, addEdge, deleteNode,
  getNode, subscribe, state, _resetForTests, NODE_W,
  updateNode, setReveal, MAX_LEVELS,
  computeHiddenIds, childMap, countDescendants, replaceState, duplicateNode,
} from '../static/js/store.js';

test('normalizeState fills defaults and whitelists sides', () => {
  const s = normalizeState({
    nodes: [{ id: 'a', title: '' }],
    edges: [{ id: 'e', from: 'a', to: 'a', fromSide: '<img>' }],
  });
  assert.equal(s.nodes[0].title, 'Без названия');
  assert.equal(s.nodes[0].collapsed, false);
  assert.equal(s.edges[0].fromSide, 'auto');
  assert.equal(s.edges[0].arrow, true);
});

test('normalizeState keeps valid strokes, drops broken ones', () => {
  const s = normalizeState({
    strokes: [
      { id: 's1', points: [[1, 2], [3, 4]] },
      { id: 's2', points: [] },
    ],
  });
  assert.equal(s.strokes.length, 1);
  assert.equal(s.strokes[0].width, 2.5);
});

test('strokes keep widths array when valid', () => {
  const s = normalizeState({
    strokes: [
      { id: 's1', points: [[0, 0], [10, 0]], widths: [3, 5] },
      { id: 's2', points: [[0, 0], [10, 0]], widths: 'oops' },
      { id: 's3', points: [[0, 0], [10, 0]], widths: [3] },
    ],
  });
  assert.deepEqual(s.strokes[0].widths, [3, 5]);
  assert.equal(s.strokes[1].widths, undefined);
  assert.equal(s.strokes[2].widths, undefined);
});

test('addNode supports text/image/audio/font fields', () => {
  _resetForTests();
  const t = addNode({ isText: true, title: '' });
  assert.equal(t.isText, true);
  assert.equal(t.title, '');
  const img = addNode({ isImage: true, title: '', image: '/images/x.png', w: 320, h: 200 });
  assert.equal(img.isImage, true);
  assert.equal(img.w, 320);
  const v = addNode({ audio: '/media/a.webm' });
  assert.equal(v.audio, '/media/a.webm');
  assert.notEqual(v.title, '');
  const f = addNode({ font: 'hand' });
  assert.equal(f.font, 'hand');
});

test('note migrates into level 1 and stays mirrored', () => {
  const s = normalizeState({ nodes: [{ id: 'a', note: 'привет' }] });
  assert.equal(s.nodes[0].levels.length, 1);
  assert.equal(s.nodes[0].levels[0].text, 'привет');
  assert.equal(s.nodes[0].note, 'привет');
});

test('levels capped at MAX_LEVELS with ids', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ text: 'u' + i }));
  const s = normalizeState({ nodes: [{ id: 'a', levels: many }] });
  assert.equal(s.nodes[0].levels.length, MAX_LEVELS);
  for (const l of s.nodes[0].levels) assert.match(l.id, /^l_/);
});

test('level pin survives normalization and updates', () => {
  const s = normalizeState({ nodes: [{ id: 'a', levels: [{ text: 'a' }, { text: 'b', pin: true }] }] });
  assert.equal(s.nodes[0].levels[0].pin, false);
  assert.equal(s.nodes[0].levels[1].pin, true);
  _resetForTests();
  const n = addNode({ note: 'x' });
  updateNode(n.id, { levels: [{ id: n.levels[0].id, text: 'x' }, { text: 'y', pin: true }] });
  const got = getNode(n.id);
  assert.equal(got.levels[1].pin, true);
  assert.equal(got.levels[0].pin, false);
});

test('updateNode levels mirrors note; note edit updates level1', () => {
  _resetForTests();
  const n = addNode({ title: 'T', note: 'first' });
  updateNode(n.id, { levels: [{ id: n.levels[0].id, text: 'first!' }, { text: 'deep' }] });
  const got = getNode(n.id);
  assert.equal(got.note, 'first!');
  assert.equal(got.levels[1].text, 'deep');
  updateNode(n.id, { note: 'changed' });
  assert.equal(getNode(n.id).levels[0].text, 'changed');
});

test('reveal normalizes and setReveal clamps', () => {
  let s = normalizeState({ reveal: 99 });
  assert.equal(s.reveal, MAX_LEVELS);
  s = normalizeState({});
  assert.equal(s.reveal, 1);
  _resetForTests();
  setReveal(3); assert.equal(state.reveal, 3);
  setReveal(0); assert.equal(state.reveal, 1);
  setReveal(50); assert.equal(state.reveal, MAX_LEVELS);
});

test('addEdge rejects self and duplicates both ways', () => {
  _resetForTests();
  const a = addNode({}); const b = addNode({});
  assert.equal(addEdge({ from: a.id, to: a.id }), null);
  assert.ok(addEdge({ from: a.id, to: b.id }));
  assert.equal(addEdge({ from: b.id, to: a.id }), null);
  assert.equal(addEdge({ from: a.id, to: b.id }), null);
});

test('deleteNode cascades edges', () => {
  _resetForTests();
  const a = addNode({}); const b = addNode({});
  addEdge({ from: a.id, to: b.id });
  deleteNode(a.id);
  assert.equal(state.edges.length, 0);
  assert.equal(getNode(a.id), undefined);
});

test('uid format + uniqueness', () => {
  assert.match(uid('n'), /^n_[0-9a-f]{8}$/);
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(uid('n'));
  assert.equal(seen.size, 1000);
});

test('mutations notify subscribers; unsubscribe works', () => {
  _resetForTests();
  let calls = 0;
  const un = subscribe(() => calls++);
  addNode({});
  assert.ok(calls >= 1);
  un();
});

test('NODE_W constant', () => { assert.equal(NODE_W, 220); });

test('addNode avoids overlap with existing nodes', () => {
  _resetForTests();
  const a = addNode({ x: 0, y: 0 });
  const b = addNode({ x: 0, y: 0 });
  assert.notDeepEqual([b.x, b.y], [a.x, a.y]);
  const dx = b.x - a.x, dy = b.y - a.y;
  assert.ok(Math.abs(dx) > NODE_W || Math.abs(dy) > 84);
});

test('glowMode normalized + legacy glow migrated', () => {
  const s = normalizeState({ nodes: [{ id: 'a', glow: 1 }] });
  assert.equal(s.nodes[0].glowMode, 'glow');
  const s2 = normalizeState({ nodes: [{ id: 'b', glowMode: 'outline' }] });
  assert.equal(s2.nodes[0].glowMode, 'outline');
  const s3 = normalizeState({ nodes: [{ id: 'c', glowMode: 'weird' }] });
  assert.equal(s3.nodes[0].glowMode, 'off');
});

test('computeHiddenIds folds descendants transitively', () => {
  _resetForTests();
  replaceState({
    nodes: [
      { id: 'a', collapsed: true }, { id: 'b' }, { id: 'c' }, { id: 'd' },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b' },
      { id: 'e2', from: 'b', to: 'c' },
    ],
  });
  const hidden = computeHiddenIds();
  assert.equal(hidden.size, 2);
  assert.ok(hidden.has('b') && hidden.has('c'));
  assert.ok(!hidden.has('a') && !hidden.has('d'));
});

test('unfold clears hidden set; mid-tree fold hides only tail', () => {
  _resetForTests();
  replaceState({
    nodes: [{ id: 'a' }, { id: 'b', collapsed: true }, { id: 'c' }],
    edges: [{ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'b', to: 'c' }],
  });
  assert.deepEqual([...computeHiddenIds()].sort(), ['c']);
  updateNode('b', { collapsed: false });
  assert.equal(computeHiddenIds().size, 0);
});

test('computeHiddenIds survives cycles', () => {
  _resetForTests();
  replaceState({
    nodes: [{ id: 'a', collapsed: true }, { id: 'x' }, { id: 'y' }],
    edges: [
      { id: 'e1', from: 'a', to: 'x' },
      { id: 'e2', from: 'x', to: 'y' },
      { id: 'e3', from: 'y', to: 'a' },
    ],
  });
  const hidden = computeHiddenIds();
  assert.equal(hidden.size, 2);
  assert.ok(hidden.has('x') && hidden.has('y'));
});

test('childMap and countDescendants count subtree', () => {
  _resetForTests();
  replaceState({
    nodes: [{ id: 'r' }, { id: 'm' }, { id: 'l1' }, { id: 'l2' }],
    edges: [
      { id: 'e1', from: 'r', to: 'm' },
      { id: 'e2', from: 'm', to: 'l1' },
      { id: 'e3', from: 'm', to: 'l2' },
    ],
  });
  const m = childMap();
  assert.equal(countDescendants('r', m), 3);
  assert.equal(countDescendants('m', m), 2);
  assert.equal(countDescendants('l1', m), 0);
});

test('normTags: lowercase, trim, dedupe, cap 8', () => {
  const s = normalizeState({
    nodes: [{ id: 'a', tags: ['UE', ' ue ', '', 'UE', 'x'.repeat(30), 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9'] }],
  });
  assert.deepEqual(s.nodes[0].tags, ['ue', 'x'.repeat(24), 't1', 't2', 't3', 't4', 't5', 't6']);
});

test('isTask/done survive replaceState and updateNode', () => {
  replaceState({ nodes: [{ id: 't1', title: 'Задача', isTask: true, done: true }] });
  assert.equal(getNode('t1').done, true);
  updateNode('t1', { done: false });
  assert.equal(getNode('t1').done, false);
  replaceState({ nodes: [] });
});

test('duplicateNode copies tags/isTask, resets done', () => {
  _resetForTests();
  addNode({ id: 'src', title: 'С', x: -5000, y: -5000, tags: ['a', 'b'], isTask: true, done: true });
  const d = duplicateNode('src');
  assert.deepEqual(d.tags, ['a', 'b']);
  assert.equal(d.isTask, true);
  assert.equal(d.done, false);
});
