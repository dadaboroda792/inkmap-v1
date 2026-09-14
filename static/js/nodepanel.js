import { getNode, getShape, updateNode, updateShape, deleteNode, deleteShape, duplicateNode, markDirty, state, MAX_LEVELS } from './store.js';
import { startTitleEdit } from './nodes.js';
import { selection, select } from './input.js';

const NODE_COLORS = [
  '', '#cfe4ff', '#d9f5ce', '#ffd9f0', '#ffe9b8', '#ffd6da', '#e4dbff', '#e8eaed',
  '#74c0fc', '#69db7c', '#ffd43b', '#ff8787', '#da77f2', '#63e6be',
];

let panel = null, editingId = null, editingKind = null;

export function initNodePanel() {
  panel = document.getElementById('node-panel');
  document.addEventListener('spark:selection', refresh);
  document.addEventListener('spark:nodes-moved', () => { if (editingId) position(); });
}

function refresh() {
  if (selection.kind === 'node') {
    const n = getNode(selection.ids.has ? [...selection.ids][0] : selection.id) || getNode(selection.id);
    if (n) { show(n.id, 'node'); return; }
  }
  if (selection.kind === 'shape') {
    const s = getShape(selection.id);
    if (s) { show(s.id, 'shape'); return; }
  }
  hide();
}

function show(id, kind) {
  if (editingId !== id || editingKind !== kind) {
    editingId = id;
    editingKind = kind;
    build();
  }
  position();
  panel.classList.remove('hidden');
}

function hide() {
  editingId = null;
  editingKind = null;
  panel?.classList.add('hidden');
}

function position() {
  panel.style.right = '16px';
  panel.style.top = '64px';
}

function build() {
  if (editingKind === 'shape') buildShape();
  else buildNode();
}

function head(titleText, onRename, node) {
  const title = document.createElement('div');
  title.className = 'np-title';
  title.textContent = titleText;
  const head = document.createElement('div');
  head.className = 'np-head';
  head.append(title);
  if (onRename) {
    const editBtn = document.createElement('button');
    editBtn.className = 'np-edit'; editBtn.type = 'button'; editBtn.textContent = 'Переименовать';
    editBtn.addEventListener('click', onRename);
    head.append(editBtn);
  }
  return head;
}

function colorRow(current, onPick) {
  const wrap = document.createElement('div');
  const label = document.createElement('div');
  label.className = 'np-label';
  label.textContent = 'Цвет';
  const colors = document.createElement('div');
  colors.className = 'np-colors';
  for (const c of NODE_COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw' + (current === c ? ' on' : '') + (c === '' ? ' none' : '');
    b.style.background = c || 'var(--node)';
    b.title = c === '' ? 'Авто' : c;
    b.addEventListener('click', () => {
      onPick(c);
      markDirty();
      [...colors.children].forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    });
    colors.appendChild(b);
  }
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.value = current && /^#[0-9a-f]{6}$/i.test(current) ? current : '#6c8cff';
  custom.title = 'Свой цвет';
  custom.addEventListener('input', () => {
    onPick(custom.value);
    markDirty();
    [...colors.children].forEach(x => x.classList.remove('on'));
  });
  colors.appendChild(custom);
  wrap.append(label, colors);
  return wrap;
}

function widthRow(current, onPick) {
  const l = document.createElement('label');
  l.className = 'np-label';
  const s = document.createElement('input');
  s.type = 'range'; s.min = '1'; s.max = '12'; s.step = '0.5'; s.value = current;
  s.addEventListener('input', () => onPick(+s.value));
  l.append(document.createTextNode('Толщина'), s);
  return l;
}

function rowButtons(pairs) {
  const row = document.createElement('div');
  row.className = 'np-row';
  for (const [text, cls, fn] of pairs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    if (cls) b.className = cls;
    b.addEventListener('click', fn);
    row.appendChild(b);
  }
  return row;
}

/* ---------- редактор узла / группы ---------- */

function buildNode() {
  const node = getNode(editingId);
  if (!node) { hide(); return; }

  panel.replaceChildren();
  panel.append(head(node.isGroup ? 'Группа' : 'Узел', node.isGroup ? null : () => startTitleEdit(node)));

  // цвет (рамка группы / заливка узла)
  panel.append(colorRow(node.color || '', c => updateNode(node.id, { color: c })));

  if (!node.isGroup) {
    // свернуть
    if (!node.isText && !node.isImage) {
      const fold = document.createElement('input');
      fold.type = 'checkbox'; fold.checked = Boolean(node.collapsed); fold.id = 'np-fold';
      fold.addEventListener('change', () => { updateNode(node.id, { collapsed: fold.checked }); markDirty(); });
      panel.append(mkLabel(fold, 'Свернуть'));
    }

    // неон
    const glowWrap = document.createElement('div');
    glowWrap.className = 'np-glow';
    for (const [val, label] of [['off', 'Нет'], ['outline', 'Контур'], ['glow', 'Полное']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.className = node.glowMode === val ? 'on' : '';
      b.addEventListener('click', () => {
        updateNode(node.id, { glowMode: val });
        markDirty();
        [...glowWrap.children].forEach(x => x.classList.remove('on'));
        b.classList.add('on');
      });
      glowWrap.appendChild(b);
    }
    const glowLabel = document.createElement('div');
    glowLabel.className = 'np-label';
    glowLabel.textContent = 'Неон';
    panel.append(glowLabel, glowWrap);

    // картинка
    if (node.image) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = 'Убрать картинку';
      rm.className = 'np-wide';
      rm.addEventListener('click', () => { updateNode(node.id, { image: null }); markDirty(); build(); });
      panel.append(rm);
    }

    // голос
    if (!node.isText && !node.isImage) panel.append(buildAudioRow(node));

    // уровни заметок
    if (!node.isText && !node.isImage) panel.append(buildLevelsRow(node));

    // шрифт заголовка
    const fontWrap = document.createElement('div');
    fontWrap.className = 'np-glow np-fonts';
    for (const [val, label] of [['', 'Обычный'], ['hand', 'Рукописный']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.className = (node.font || '') === val ? 'on' : '';
      b.addEventListener('click', () => {
        updateNode(node.id, { font: val || null });
        markDirty();
        [...fontWrap.children].forEach(x => x.classList.remove('on'));
        b.classList.add('on');
      });
      fontWrap.appendChild(b);
    }
    const fontLabel = document.createElement('div');
    fontLabel.className = 'np-label';
    fontLabel.textContent = 'Шрифт';
    panel.append(fontLabel, fontWrap);
  }

  // действия
  const pairs = [];
  if (!node.isGroup) {
    pairs.push(['Дублировать', '', () => {
      const copy = duplicateNode(node.id);
      markDirty();
      select('node', copy.id);
    }]);
  }
  pairs.push(['Удалить', 'danger', () => {
    if (node.isGroup) {
      for (const ch of state.nodes) if (ch.groupId === node.id) updateNode(ch.id, { groupId: null });
    }
    deleteNode(node.id);
    markDirty();
    hide();
  }]);
  panel.append(rowButtons(pairs));
}

function mkLabel(input, text) {
  const l = document.createElement('label');
  l.className = 'np-label';
  l.append(input, document.createTextNode(text));
  return l;
}

function buildLevelsRow(node) {
  const wrap = document.createElement('div');
  wrap.className = 'np-audio';
  const label = document.createElement('div');
  label.className = 'np-label';
  label.textContent = `Уровни заметок (${node.levels.length}/${MAX_LEVELS})`;
  wrap.append(label);

  node.levels.forEach((lvl, i) => {
    const row = document.createElement('div');
    row.className = 'np-level-row';
    const tag = document.createElement('span');
    tag.className = 'np-level-tag';
    tag.textContent = 'L' + (i + 1);
    const ta = document.createElement('textarea');
    ta.className = 'np-level-text';
    ta.rows = 2;
    ta.placeholder = `Уровень ${i + 1}`;
    ta.value = lvl.text;
    ta.addEventListener('input', () => {
      const next = node.levels.map((l, j) => (j === i ? { ...l, text: ta.value } : l));
      updateNode(node.id, { levels: next });
      markDirty();
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '✕';
    del.title = 'Удалить уровень';
    del.disabled = node.levels.length <= 1;
    if (del.disabled) del.classList.add('disabled');
    del.addEventListener('click', () => {
      const next = node.levels.filter((_, j) => j !== i);
      updateNode(node.id, { levels: next });
      markDirty();
      build();
    });
    const pin = document.createElement('input');
    pin.type = 'checkbox';
    pin.className = 'np-pin';
    pin.checked = Boolean(lvl.pin);
    pin.title = 'Закрепить: всегда показывать этот уровень на этой ноде';
    pin.addEventListener('change', () => {
      const next = node.levels.map((l, j) => (j === i ? { ...l, pin: pin.checked } : l));
      updateNode(node.id, { levels: next });
      markDirty();
    });
    row.append(tag, ta, pin, del);
    wrap.append(row);
  });

  if (node.levels.length < MAX_LEVELS) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'np-wide';
    add.textContent = `Добавить уровень ${node.levels.length + 1}`;
    add.addEventListener('click', () => {
      const next = [...node.levels, { text: '' }];
      updateNode(node.id, { levels: next });
      markDirty();
      build();
    });
    wrap.append(add);
  }
  return wrap;
}

function buildAudioRow(node) {  const wrap = document.createElement('div');
  wrap.className = 'np-audio';
  const label = document.createElement('div');
  label.className = 'np-label';
  label.textContent = 'Голос';
  const recBtn = document.createElement('button');
  recBtn.type = 'button';
  recBtn.className = 'np-wide';
  recBtn.textContent = node.audio ? 'Перезаписать голос' : 'Записать голос';
  recBtn.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('spark:voice-record', { detail: node.id }));
  });
  wrap.append(label, recBtn);
  if (node.audio) {
    const a = document.createElement('audio');
    a.controls = true;
    a.preload = 'metadata';
    a.src = node.audio;
    a.style.width = '100%';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = 'Убрать запись';
    rm.className = 'np-wide danger';
    rm.addEventListener('click', () => { updateNode(node.id, { audio: null }); markDirty(); build(); });
    wrap.append(a, rm);
  }
  return wrap;
}

/* ---------- редактор фигуры ---------- */

function buildShape() {
  const sh = getShape(editingId);
  if (!sh) { hide(); return; }

  panel.replaceChildren();
  const names = { rect: 'Прямоугольник', ellipse: 'Эллипс', arrow: 'Стрелка' };
  panel.append(head(names[sh.type] || 'Фигура', null));

  panel.append(colorRow(sh.color || '', c => { updateShape(sh.id, { color: c }); markDirty(); }));
  panel.append(widthRow(sh.width || 2.5, w => { updateShape(sh.id, { width: w }); markDirty(); }));

  panel.append(rowButtons([
    ['Удалить', 'danger', () => { deleteShape(sh.id); markDirty(); select(null); hide(); }],
  ]));
}
