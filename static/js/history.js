import { state, subscribe, replaceState, markDirty } from './store.js';

const MAX = 100;
let undoStack = [];
let redoStack = [];
let restoring = false;
let lastSnap = '';

function snapshot() {
  return JSON.stringify({
    meta: state.meta,
    nodes: state.nodes,
    edges: state.edges,
    strokes: state.strokes,
    shapes: state.shapes,
    reveal: state.reveal,
  });
}

export function initHistory() {
  let timer = null;
  subscribe(() => {
    if (restoring) return;
    clearTimeout(timer);
    timer = setTimeout(push, 250);
  });
  push();
}

function push() {
  const snap = snapshot();
  if (snap === lastSnap) return;
  undoStack.push(lastSnap);
  if (undoStack.length > MAX) undoStack.shift();
  lastSnap = snap;
  redoStack.length = 0;
  updateButtons();
}

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(lastSnap);
  lastSnap = undoStack.pop();
  apply(lastSnap);
}

export function redo() {
  if (!redoStack.length) return;
  undoStack.push(lastSnap);
  lastSnap = redoStack.pop();
  apply(lastSnap);
}

function apply(snap) {
  restoring = true;
  try {
    replaceState(JSON.parse(snap));
  } finally {
    restoring = false;
  }
  updateButtons();
  markDirty();
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

export function updateButtons() {
  const u = document.getElementById('btn-undo');
  const r = document.getElementById('btn-redo');
  if (u) u.disabled = !canUndo();
  if (r) r.disabled = !canRedo();
}
