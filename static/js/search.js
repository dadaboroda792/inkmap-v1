import { state } from './store.js';
import { centerOn } from './view.js';
import { nodeSize } from './nodes.js';

let box, input, results;

export function initSearch() {
  box = document.getElementById('search-box');
  input = document.getElementById('search-input');
  results = document.getElementById('search-results');

  document.getElementById('btn-search').addEventListener('click', open);
  input.addEventListener('input', () => render(input.value));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') pickCurrent();
    if (e.key === 'ArrowDown') move(1);
    if (e.key === 'ArrowUp') move(-1);
  });
}

function open() {
  box.classList.remove('hidden');
  input.value = '';
  render('');
  input.focus();
}
function close() {
  box.classList.add('hidden');
}

let items = [];
let cursor = 0;

function render(q) {
  q = q.trim().toLowerCase();
  results.replaceChildren();
  items = [];
  cursor = 0;
  if (!q) return;
  for (const n of state.nodes) {
    const noteText = (n.levels || [{ text: n.note }]).map(l => l.text).join(' ');
    const hay = (n.title + ' ' + noteText).toLowerCase();
    if (!hay.includes(q)) continue;
    items.push(n);
    if (items.length >= 8) break;
  }
  for (const n of items) {
    const li = document.createElement('li');
    const snippet = (n.levels?.find(l => l.text.trim()) || { text: n.note }).text;
    li.textContent = n.title + (snippet ? ' — ' + snippet.split('\n')[0].slice(0, 60) : '');
    li.addEventListener('click', () => jump(n));
    results.appendChild(li);
  }
  markCursor();
}

function markCursor() {
  [...results.children].forEach((el, i) => el.classList.toggle('cursor', i === cursor));
}
function move(d) {
  if (!items.length) return;
  cursor = Math.min(items.length - 1, Math.max(0, cursor + d));
  markCursor();
}
function pickCurrent() {
  if (items[cursor]) jump(items[cursor]);
}

function jump(node) {
  close();
  const s = nodeSize(node);
  centerOn(node.x + s.w / 2, node.y + s.h / 2);
  document.dispatchEvent(new CustomEvent('spark:selection'));
  const el = document.querySelector(`.ink-node[data-id="${CSS.escape(node.id)}"]`);
  if (el) {
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1200);
  }
}
