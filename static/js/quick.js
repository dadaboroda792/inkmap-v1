import { state, addNode, addEdge, updateNode, getNode, NODE_W } from './store.js';

export function childrenCount(parentId) {
  return state.edges.filter(e => e.from === parentId).length;
}

export function spawnThought(parentId) {
  const parent = getNode(parentId);
  if (!parent) return null;
  const child = addNode({
    x: parent.x + NODE_W + 60,
    y: parent.y + childrenCount(parentId) * 100,
    title: parent.title,
    note: (parent.note ?? '').trim(),
    color: parent.color,
    glowMode: parent.glowMode,
    groupId: parent.isGroup ? null : parent.groupId,
  });
  addEdge({ from: parentId, to: child.id });
  updateNode(parentId, { note: '' });
  return child;
}

export function handleNoteKey(e, node) {
  if (e.isComposing || e.keyCode === 229) return false;
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey) return false;
  if (!(node.note ?? '').trim()) { e.preventDefault(); return false; }
  e.preventDefault();
  spawnThought(node.id);
  return true;
}
