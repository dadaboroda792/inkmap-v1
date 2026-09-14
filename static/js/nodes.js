import { state, updateNode, getNode, markDirty, NODE_W, computeHiddenIds, childMap, countDescendants } from './store.js';
import { PALETTE } from './palette.js';
import { uploadImage } from './api.js';
import { banner } from './banner.js';

const ICONS = {
  fold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  drop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7s6.5 7 6.5 11.3a6.5 6.5 0 01-13 0C5.5 9.7 12 2.7 12 2.7z"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
};

export const GROUP_COLLAPSED_H = 38;

export function nodeSize(node, el) {
  const el2 = el ?? document.querySelector(`.ink-node[data-id="${CSS.escape(node.id)}"]`);
  return {
    w: el2 ? el2.offsetWidth : NODE_W,
    h: el2 ? el2.offsetHeight : (node.collapsed ? GROUP_COLLAPSED_H : 84),
  };
}

export function renderNodes(viewportEl) {
  viewportRef = viewportEl;
  const groupsById = new Map(state.nodes.filter(n => n.isGroup).map(n => [n.id, n]));
  const treeHidden = computeHiddenIds(state);
  const kidsMap = childMap(state);
  const seen = new Set();
  for (const node of state.nodes) {
    seen.add(node.id);
    let el = viewportEl.querySelector(`.ink-node[data-id="${CSS.escape(node.id)}"]`);
    if (!el) { el = buildNodeEl(node); viewportEl.appendChild(el); }
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
    el.classList.toggle('text-node', node.isText);
    el.classList.toggle('image-node', node.isImage);
    el.classList.toggle('font-hand', node.font === 'hand');
    const parent = node.groupId ? groupsById.get(node.groupId) : null;
    const hidden = (parent && parent.collapsed && !node.isGroup) || treeHidden.has(node.id);
    el.style.display = hidden ? 'none' : '';
    el.classList.toggle('tree-hidden', hidden);
    if (node.isGroup) {
      el.style.background = node.color
        ? `color-mix(in srgb, ${node.color} 16%, transparent)`
        : 'transparent';
      el.style.borderColor = node.color || 'var(--line)';
      el.classList.remove('tinted');
    } else if (!node.isText && !node.isImage) {
      const fill = node.color || 'var(--node)';
      if (el.dataset.fill !== fill) {
        el.dataset.fill = fill;
        el.style.background = fill;
        el.classList.toggle('tinted', Boolean(node.color));
      }
    }
    if (node.isGroup) {
      el.style.width = node.w + 'px';
      el.style.height = (node.collapsed ? GROUP_COLLAPSED_H : node.h) + 'px';
      el.classList.toggle('collapsed', Boolean(node.collapsed));
      const pos = [['-6px', '-6px'], ['calc(100% - 6px)', '-6px'], ['-6px', 'calc(100% - 6px)'], ['calc(100% - 6px)', 'calc(100% - 6px)']];
      el.querySelectorAll('.g-handle').forEach(h => {
        const [lft, tp] = pos[+h.dataset.corner];
        h.style.left = lft; h.style.top = tp;
      });
    }
    if (node.isImage) { el.style.width = node.w + 'px'; el.style.height = node.h + 'px'; }
    if (!node.isGroup && !node.isText && !node.isImage) {
      const collapsed = Boolean(node.collapsed);
      el.classList.toggle('note-collapsed', collapsed);
      el.classList.toggle('has-kids', (kidsMap.get(node.id) || []).length > 0);
      const chip = el.querySelector('.n-fold-chip');
      if (chip) chip.classList.toggle('collapsed', collapsed);
      const badge = el.querySelector('.n-fold-badge');
      if (badge) {
        const cnt = collapsed ? countDescendants(node.id, kidsMap) : 0;
        badge.textContent = '▸ ' + cnt;
        badge.hidden = !collapsed || !cnt;
      }
      el.style.removeProperty('height');
      const meta = el.querySelector('.n-meta');
      if (meta) {
        const tags = node.tags || [];
        meta.hidden = !(node.isTask || tags.length);
        meta.querySelector('.task-toggle').hidden = !node.isTask;
        meta.querySelector('.tag-edit').hidden = tags.length >= 8;
        const tagsEl = meta.querySelector('.n-tags');
        const sig = tags.join('|') + (activeTag ? '>' + activeTag : '');
        if (tagsEl.dataset.sig !== sig) {
          tagsEl.dataset.sig = sig;
          tagsEl.textContent = '';
          for (const t of tags) {
            const pill = document.createElement('span');
            pill.className = 'n-tag' + (activeTag === t ? ' on' : '');
            pill.dataset.tag = t;
            pill.textContent = '#' + t;
            tagsEl.appendChild(pill);
          }
        } else {
          tagsEl.querySelectorAll('.n-tag').forEach(p => p.classList.toggle('on', activeTag === p.dataset.tag));
        }
      }
      el.classList.toggle('is-task', Boolean(node.isTask));
      el.classList.toggle('done', Boolean(node.isTask && node.done));
      el.classList.toggle('node-dim', Boolean(activeTag) && !(node.tags || []).includes(activeTag));
    }
    el.classList.toggle('neon-glow', node.glowMode === 'glow');
    el.classList.toggle('neon-outline', node.glowMode === 'outline');
    el.style.setProperty('--glow', node.color || 'var(--accent)');
    const titleEl = el.querySelector('.n-title');
    if (titleEl) syncText(titleEl, node.title);
    if (!node.isGroup && !node.isText && !node.isImage) syncLevels(el, node);
    if (node.isGroup || node.isText) { el.querySelector('.n-img-wrap')?.classList.add('hidden'); }
    else renderImage(el, node.image);
    syncAudio(el, node);
  }
  for (const el of [...viewportEl.querySelectorAll('.ink-node')]) {
    if (!seen.has(el.dataset.id)) el.remove();
  }
}

function syncAudio(el, node) {
  const wrap = el.querySelector('.n-audio');
  if (!wrap) return;
  const a = wrap.querySelector('audio');
  if (node.audio) {
    if (a.dataset.src !== node.audio) { a.src = node.audio; a.dataset.src = node.audio; }
    wrap.classList.remove('hidden');
  } else {
    a.removeAttribute('src');
    delete a.dataset.src;
    wrap.classList.add('hidden');
  }
}

function syncText(el, text) {
  if (document.activeElement === el) { el.dataset.sync = text; return; }
  const cur = el.dataset.sync ?? el.innerText;
  if (cur !== text) {
    el.innerText = text;
  }
  el.dataset.sync = text;
}

function buildNodeEl(node) {
  const el = document.createElement('div');
  el.className = 'ink-node';
  el.dataset.id = node.id;
  if (node.isGroup) {
    el.innerHTML = `
      <div class="g-titlebar" title="Тяни за полоску, чтобы двигать группу">
        <button class="g-fold" type="button" title="Свернуть / развернуть"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>
        <div class="n-title"></div>
      </div>
      <button class="n-port" type="button" title="Потяни связь"></button>
      <div class="g-handle" data-corner="0"></div>
      <div class="g-handle" data-corner="1"></div>
      <div class="g-handle" data-corner="2"></div>
      <div class="g-handle" data-corner="3"></div>
    `;
    el.classList.add('group-node');
    wireTitle(el, node);
    wireFold(el, node);
    return el;
  }
  if (node.isImage) {
    el.innerHTML = `
      <div class="n-img-wrap"><img class="n-img" alt="" draggable="false"></div>
      <div class="img-scale" title="Потянуть — масштаб"></div>
    `;
    el.classList.add('image-node');
    return el;
  }
  if (node.isText) {
    el.innerHTML = `
      <div class="n-title"></div>
    `;
    el.classList.add('text-node');
    wireTitle(el, node);
    return el;
  }
  el.innerHTML = `
    <button class="g-fold n-fold-chip${node.collapsed ? ' collapsed' : ''}" type="button" title="Свернуть / развернуть"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg><span class="n-fold-badge" hidden></span></button>
    <div class="n-meta" hidden><button class="task-toggle" type="button" title="Отметить выполненной"></button><span class="n-tags"></span><button class="tag-edit" type="button" title="Изменить теги">+</button></div>
    <div class="n-title"></div>
    <div class="n-levels"></div>
    <div class="n-audio hidden"><audio controls preload="metadata"></audio></div>
    <div class="n-img-wrap hidden"><img class="n-img" alt=""></div>
    <button class="n-port" type="button" title="Потяни связь"></button>
  `;
  wireTitle(el, node);
  wireLevels(el, node);
  wireImageDrop(el, node);
  wireFold(el, node);
  wireMeta(el, node);
  return el;
}

let activeTag = null;
let viewportRef = null;

export function setTagFilter(tag) {
  activeTag = (activeTag === tag) ? null : tag;
  if (viewportRef) renderNodes(viewportRef);
}

function wireMeta(el, node) {
  const meta = el.querySelector('.n-meta');
  if (!meta) return;
  const toggle = meta.querySelector('.task-toggle');
  const editBtn = meta.querySelector('.tag-edit');
  const tagsEl = meta.querySelector('.n-tags');
  for (const t of [toggle, editBtn, tagsEl]) t.addEventListener('pointerdown', e => e.stopPropagation());
  toggle.addEventListener('click', () => {
    updateNode(node.id, { done: !getNode(node.id).done });
    markDirty();
  });
  tagsEl.addEventListener('click', (e) => {
    const pill = e.target.closest('.n-tag');
    if (!pill) return;
    setTagFilter(pill.dataset.tag);
    markDirty();
  });
  editBtn.addEventListener('click', () => {
    const cur = (getNode(node.id).tags || []).join(', ');
    const raw = prompt('Теги через запятую:', cur);
    if (raw === null) return;
    updateNode(node.id, { tags: raw.split(',').map(s => s.trim()).filter(Boolean) });
    markDirty();
  });
}

function wireFold(el, node) {
  const btn = el.querySelector('.g-fold');
  btn.addEventListener('pointerdown', e => e.stopPropagation());
  btn.addEventListener('dblclick', e => e.stopPropagation());
  btn.addEventListener('click', () => {
    updateNode(node.id, { collapsed: !node.collapsed });
    markDirty();
  });
}

function wireTitle(el, node) {
  el.querySelector('.n-title').addEventListener('dblclick', () => startTitleEdit(node));
}
export function startTitleEdit(node) {
  const titleEl = document.querySelector(`.ink-node[data-id="${CSS.escape(node.id)}"] .n-title`);
  if (!titleEl || titleEl.isContentEditable) return;
  titleEl.contentEditable = 'true';
  titleEl.classList.add('editing');
  titleEl.focus();
  placeCaretAtEnd(titleEl);
  let finished = false;
  function finish(commit) {
    if (finished) return;
    finished = true;
    titleEl.removeEventListener('blur', onBlur);
    titleEl.removeEventListener('keydown', onKey);
    titleEl.contentEditable = 'false';
    titleEl.classList.remove('editing');
    if (commit) {
      const raw = titleEl.innerText.trim();
      if (node.isText) {
        node.title = raw;
        updateNode(node.id, { title: raw });
        if (!raw) document.dispatchEvent(new CustomEvent('spark:text-empty', { detail: node.id }));
      } else {
        node.title = raw || 'Без названия';
        updateNode(node.id, { title: node.title });
      }
    }
    titleEl.innerText = node.title;
    titleEl.dataset.sync = node.title;
    markDirty();
  }
  function onBlur() { finish(true); }
  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  }
  titleEl.addEventListener('blur', onBlur);
  titleEl.addEventListener('keydown', onKey);
}

export function placeCaretAtEnd(el) {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function syncLevels(el, node) {
  const box = el.querySelector('.n-levels');
  if (!box || !Array.isArray(node.levels)) return;
  const vis = new Set();
  for (let i = 0; i < Math.min(state.reveal, node.levels.length); i++) vis.add(i);
  node.levels.forEach((l, i) => { if (l.pin) vis.add(i); });
  const idxs = [...vis].sort((a, b) => a - b);
  const keep = new Set();
  for (const i of idxs) {
    let div = box.querySelector(`.n-note[data-lvl="${i + 1}"]`);
    if (!div) {
      div = document.createElement('div');
      div.className = 'n-note';
      div.setAttribute('contenteditable', 'plaintext-only');
      div.dataset.lvl = i + 1;
      div.dataset.placeholder = i === 0 ? 'мысль… (Enter — новая мысль)' : `уровень ${i + 1}…`;
      box.appendChild(div);
    }
    keep.add(div);
    div.classList.toggle('pinned', Boolean(node.levels[i].pin));
    syncText(div, node.levels[i].text);
  }
  for (const d of [...box.children]) if (!keep.has(d)) d.remove();
}

function wireLevels(el, node) {
  const box = el.querySelector('.n-levels');
  if (!box) return;
  box.addEventListener('input', (e) => {
    const t = e.target.closest('.n-note');
    if (!t) return;
    const i = (+t.dataset.lvl || 1) - 1;
    if (!node.levels[i]) return;
    node.levels[i].text = t.innerText;
    t.dataset.sync = t.innerText;
    if (i === 0) node.note = t.innerText;
    markDirty();
  });
  box.addEventListener('keydown', (e) => {
    const t = e.target.closest('.n-note');
    if (!t) return;
    if (e.key === 'Escape') { t.blur(); e.stopPropagation(); return; }
    if (handleNoteKey(e, node)) {
      const i = (+t.dataset.lvl || 1) - 1;
      if (node.levels[i]) node.levels[i].text = '';
      t.innerText = '';
      t.dataset.sync = '';
      placeCaretAtEnd(t);
      markDirty();
    } else if (e.key === 'Enter') {
      e.preventDefault();
    }
    e.stopPropagation();
  });
}

import { handleNoteKey } from './quick.js';

function wireImageDrop(el, node) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('drop-hover'); });
  el.addEventListener('dragleave', () => el.classList.remove('drop-hover'));
  async function setImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    el.classList.add('uploading');
    try {
      const url = await uploadImage(file);
      updateNode(node.id, { image: url });
      markDirty();
    } catch (err) {
      banner('Не удалось загрузить картинку: ' + err.message);
    } finally {
      el.classList.remove('uploading');
    }
  }
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drop-hover');
    setImage(e.dataTransfer.files[0]);
  });
}

export function renderImage(el, url) {
  const wrap = el.querySelector('.n-img-wrap');
  const img = el.querySelector('.n-img');
  if (url) {
    if (img.dataset.src !== url) {
      img.dataset.src = url;
      el.classList.remove('img-broken');
      img.onload = () => el.classList.remove('img-broken');
      img.onerror = () => {
        el.classList.add('img-broken');
        img.removeAttribute('src');
      };
      img.src = url;
    }
    wrap.classList.remove('hidden');
  } else {
    img.removeAttribute('src');
    delete img.dataset.src;
    img.onload = img.onerror = null;
    el.classList.remove('img-broken');
    wrap.classList.add('hidden');
  }
}
