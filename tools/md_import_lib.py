# -*- coding: utf-8 -*-
"""Общая логика импорта Markdown-документа в карту InkMap.

Ядро используется двумя точками входа:
  * CLI  — tools/mindmap_export.py (ARCHITECTURE.md + overlay MINDMAP.md,
           --sync, --dry-run);
  * HTTP — POST /api/import-md в server.py (кнопка «Импорт MD»).

Иерархия: H1 -> корень, H2/H3/H4 -> дерево. Статусные маркеры в заголовках
(✅/🔨/📌/💡) задают цвет ноды; строки «- [ ] / - [x]» -> дочерние таск-ноды;
длинные заметки режутся: «кратко на ноде + дочерняя нода „Детали"».
Лейаут — горизонтальный tidy-tree по развёрнутому дереву (никаких наслоений
при fold/unfold).
"""
import base64
import hashlib
import json
import math
import re
import urllib.error
import urllib.request
from pathlib import Path

NODE_W = 220
H_GAP = 130
V_GAP = 30
MAX_NOTE_CHARS = 6000
COLLAPSED_UI_H = 38

CHARS_PER_LINE = 27
TITLE_CHARS_PER_LINE = 24
NOTE_LINE_H = 18.9
TITLE_LINE_H = 19.5
BASE_H = 84

SPLIT_MIN = 450
KEEP_MAX = 280
DETAIL_MIN_REST = 80

STATUS_COLORS = [
    ('✅', '#d9f5ce'), ('✔', '#d9f5ce'), ('☑', '#d9f5ce'),
    ('🔨', '#ffe9b8'), ('🔧', '#ffe9b8'),
    ('📌', '#cfe4ff'), ('📍', '#cfe4ff'),
    ('💡', '#e4dbff'), ('❓', '#e4dbff'),
]
COLOR_FACT = '#d9f5ce'
COLOR_PIN = '#cfe4ff'
SKIP_SECTIONS = {'содержание', 'contents', 'toc'}
TASK_RE = re.compile(r'^\s*-\s*\[([ xX])\]\s+(.+?)\s*$')
IMAGE_RE = re.compile(r'!\[([^\]]*)\]\(([^)]+)\)')
MAX_IMAGE_BYTES = 10 * 1024 * 1024


def norm_task_text(s):
    return ' '.join(s.split()).lower()


class Node:
    __slots__ = ('title', 'note', 'color', 'children', 'id', 'depth',
                 'x', 'y', 'h', 'collapsed', 'detail', 'isTask', 'done',
                 'raw_tasks', 'image', 'block')

    def __init__(self, title, depth):
        self.title = title.strip()
        self.note = []
        self.color = ''
        self.children = []
        self.id = ''
        self.depth = depth
        self.x = 0.0
        self.y = 0.0
        self.h = BASE_H
        self.collapsed = False
        self.detail = False
        self.isTask = False
        self.done = False
        self.raw_tasks = []
        self.image = None


class ImageRef:
    """Картинка из заметки. kind: data | http | local."""
    __slots__ = ('node', 'url', 'kind', 'chunk')

    def __init__(self, node, url, kind, chunk):
        self.node = node
        self.url = url
        self.kind = kind
        self.chunk = chunk


def marker_color(title):
    for m, c in STATUS_COLORS:
        if title.startswith(m) or m in title[:3]:
            return c
    return None


def section_color(title):
    t = title.lower()
    if re.match(r'^\s*11[\s.\-]', t) or 'ограничени' in t or 'нюанс' in t:
        return COLOR_PIN
    return COLOR_FACT


def color_for(title):
    return marker_color(title) or section_color(title)


def slug(text):
    s = re.sub(r'[^\wа-яё]+', '-', text.lower().strip(), flags=re.UNICODE).strip('-')
    return s[:80] or 'node'


def parse_text(text):
    """Markdown-текст -> дерево Node. Потокозащищён, не зависит от файловой системы."""
    lines = text.splitlines()
    root = Node('Карта', 0)
    stack = [(0, root)]
    preamble = []
    current = None
    saw_h1 = False
    in_fence = False
    for ln in lines:
        if ln.lstrip().startswith('```'):
            in_fence = not in_fence
            if current is not None:
                current.note.append(ln)
            continue
        m = re.match(r'^(#{1,4})\s+(.+?)\s*#*$', ln)
        if m and not in_fence:
            level = len(m.group(1))
            title = m.group(2).strip()
            if level == 1 and not saw_h1:
                saw_h1 = True
                root.title = title
                current = root
                continue
            while len(stack) > 1 and stack[-1][0] >= level:
                stack.pop()
            parent = stack[-1][1]
            node = Node(title, parent.depth + 1)
            node.color = color_for(title)
            parent.children.append(node)
            stack.append((level, node))
            current = node
            continue
        tm = TASK_RE.match(ln)
        if tm and not in_fence and current is not None:
            current.raw_tasks.append((tm.group(1) in 'xX', tm.group(2).strip()))
            continue
        if ln.strip() == '---':
            continue
        if current is None:
            preamble.append(ln)
        else:
            current.note.append(ln)

    def clean(n):
        text_in = '\n'.join(n.note).strip()
        n.note = re.sub(r'\n{3,}', '\n\n', text_in)[:MAX_NOTE_CHARS]
        for c in n.children:
            clean(c)

    clean(root)
    root.note = re.sub(r'\n{3,}', '\n\n', '\n'.join(preamble).strip())[:MAX_NOTE_CHARS]
    root.color = ''
    root.children = [c for c in root.children if c.title.lower() not in SKIP_SECTIONS]
    return root


def parse_doc(path):
    return parse_text(Path(path).read_text(encoding='utf-8'))


def apply_overlay(root, path):
    p = Path(path)
    if not p.exists():
        return 0
    overlay_root = parse_doc(p)
    index = {}

    def walk(n):
        index.setdefault(n.title.lower(), []).append(n)
        for c in n.children:
            walk(c)

    walk(root)
    applied = 0

    def merge(on):
        nonlocal applied
        targets = index.get(on.title.lower())
        extra = on.note.strip()
        if targets:
            tgt = targets[0]
            if extra.startswith('!replace'):
                tgt.note = extra[len('!replace'):].strip()[:MAX_NOTE_CHARS]
            elif extra:
                tgt.note = (tgt.note + '\n\n' + extra)[:MAX_NOTE_CHARS]
            st = marker_color(on.title)
            if st:
                tgt.color = st
            tgt.raw_tasks.extend(on.raw_tasks)
            applied += 1
        for c in on.children:
            merge(c)

    merge(overlay_root)
    return applied


def make_task_nodes(root):
    """Строки «- [ ] / - [x]» из тел разделов -> дочерние таск-ноды."""
    made = 0

    def walk(n):
        nonlocal made
        for done, text in n.raw_tasks:
            t = Node(text, n.depth + 1)
            t.isTask = True
            t.done = done
            t.color = n.color if not n.isTask else ''
            n.children.append(t)
            made += 1
        for c in list(n.children):
            walk(c)

    walk(root)
    return made


def split_details(node):
    """Длинная заметка -> краткое описание + дочерняя нода «Детали»."""
    made = 0
    for c in list(node.children):
        made += split_details(c)
    if node.depth == 0 or node.detail or len(node.note) < SPLIT_MIN:
        return made
    text = node.note
    brk = text.find('\n\n')
    if brk != -1:
        head, rest = text[:brk].strip(), text[brk + 2:].strip()
    else:
        head, rest = text.strip(), ''
    if len(head) > KEEP_MAX:
        cut = head[:KEEP_MAX]
        best = -1
        for sep in ('. ', '.\n', '.'):
            i = cut.rfind(sep)
            if i > 120:
                best = max(best, i + len(sep))
        if best == -1:
            sp = cut.rfind(' ')
            best = sp + 1 if sp > 60 else KEEP_MAX
        rest = (head[best:].strip() + ('\n\n' + rest if rest else '')).strip()
        head = head[:best].strip()
    if len(rest) < DETAIL_MIN_REST:
        return made
    d = Node('Детали', node.depth + 1)
    d.note = rest[:MAX_NOTE_CHARS]
    d.color = node.color
    d.detail = True
    node.children.append(d)
    node.note = head
    return made + 1


def scan_images(root):
    """Находит в заметках «![...](url)». Обход не мутирует ноды."""
    refs = []

    def walk(n):
        if n.note:
            for m in IMAGE_RE.finditer(n.note):
                url = m.group(2).strip()
                if url.startswith('data:'):
                    kind = 'data'
                elif re.match(r'https?://', url, re.IGNORECASE):
                    kind = 'http'
                else:
                    kind = 'local'
                refs.append(ImageRef(n, url, kind, m.group(0)))
        for c in n.children:
            walk(c)

    walk(root)
    return refs


def decode_data_uri(url):
    """'data:image/png;base64,XXXX' -> (bytes, mime)."""
    m = re.match(r'data:([^;,]+)(?:;base64)?,(.+)$', url, re.IGNORECASE | re.DOTALL)
    if not m:
        raise ValueError('неверный data-URI')
    mime, payload = m.group(1).strip(), m.group(2).strip()
    data = base64.b64decode(payload, validate=True)
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError('картинка больше 10 МБ')
    return data, mime


def ext_for_mime(mime):
    m = (mime or '').lower().split(';')[0].strip()
    return {'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg',
            'image/gif': '.gif', 'image/webp': '.webp'}.get(m, '.png')


def fetch_url(url):
    """(bytes, mime) — GET с таймаутом и лимитом размера."""
    with urllib.request.urlopen(url, timeout=8) as r:
        data = r.read(MAX_IMAGE_BYTES + 1)
        if len(data) > MAX_IMAGE_BYTES:
            raise ValueError('картинка больше 10 МБ')
        mime = r.headers.get('Content-Type', '').split(';')[0].strip().lower()
    return data, mime


def attach_image(ref, images_dir):
    """Сохраняет картинку из ImageRef в images_dir и вешает на ноду.
    Возвращает True. Локальные пути (kind='local') обрабатывает вызывающий код."""
    images_dir = Path(images_dir)
    images_dir.mkdir(parents=True, exist_ok=True)
    data, mime = None, None
    url = ref.url
    if url.startswith('data:'):
        data, mime = decode_data_uri(url)
    else:
        data, mime = fetch_url(url)
    ext = ext_for_mime(mime)
    fname = hashlib.md5(data).hexdigest()[:16] + ext
    path = images_dir / fname
    if not path.exists():
        path.write_bytes(data)
    node = ref.node
    node.image = f'/images/{fname}'
    node.note = (node.note or '').replace(ref.chunk, '', 1)
    return True


def assign_ids(root):
    used = {}

    def walk(n, parent_slug):
        full = f'{parent_slug}/{slug(n.title)}'
        h = hashlib.md5(full.encode('utf-8')).hexdigest()[:8]
        base_id = f'n_{h}'
        k = used.get(base_id, 0)
        used[base_id] = k + 1
        n.id = base_id if k == 0 else f'{base_id}-{k}'
        for c in n.children:
            walk(c, full)

    walk(root, '')


def set_collapse(root, expand_n, no_collapse):
    def walk(n):
        if no_collapse:
            n.collapsed = False
        else:
            n.collapsed = bool(n.children) and n.depth >= expand_n
        for c in n.children:
            walk(c)

    walk(root)


def est_height(node):
    tl = max(1, math.ceil(len(node.title) / TITLE_CHARS_PER_LINE)) if node.title else 0
    nl = 0
    if node.note:
        for seg in node.note.split('\n'):
            nl += max(1, math.ceil(len(seg) / CHARS_PER_LINE))
    h = 42 + tl * TITLE_LINE_H + (4 + nl * NOTE_LINE_H if nl else 0)
    return max(BASE_H, h)


def layout(root):
    def measure(n):
        n.h = est_height(n)
        if n.children:
            total = sum(measure(c) for c in n.children)
            total += V_GAP * (len(n.children) - 1)
            n.block = max(n.h, total)
        else:
            n.block = n.h
        return n.block

    def place(n, top):
        n.x = n.depth * (NODE_W + H_GAP)
        if n.children:
            n.y = top + (n.block - n.h) / 2.0
        else:
            n.y = top
        cur = top
        for c in n.children:
            place(c, cur)
            cur += c.block + V_GAP

    measure(root)
    place(root, 0.0)


def check_overlaps(root):
    rects = []

    def walk(n):
        rects.append((n.x, n.y, n.x + NODE_W, n.y + n.h, n.title))
        for c in n.children:
            walk(c)

    walk(root)
    bad = []
    M = 6
    for i in range(len(rects)):
        for j in range(i + 1, len(rects)):
            a, b = rects[i], rects[j]
            if a[0] < b[2] - M and b[0] < a[2] - M and a[1] < b[3] - M and b[1] < a[3] - M:
                bad.append((a[4][:24], b[4][:24]))
    return bad


def build_json(root, name):
    nodes, edges = [], []

    def add_edge(a, b):
        eid = 'e_' + hashlib.md5((a.id + '>' + b.id).encode('utf-8')).hexdigest()[:8]
        edges.append({'id': eid, 'from': a.id, 'to': b.id})

    def add_node(n):
        d = {
            'id': n.id,
            'x': round(n.x, 1),
            'y': round(n.y, 1),
            'title': n.title,
            'note': n.note,
            'levels': [{'text': n.note}] if n.note else [],
            'color': n.color,
            'collapsed': bool(n.collapsed),
            'tags': [],
            'isTask': bool(n.isTask),
            'done': bool(n.done),
            'w': NODE_W,
            'font': 'plain',
        }
        if n.image:
            d['image'] = n.image
        nodes.append(d)
        for c in n.children:
            add_edge(n, c)
            add_node(c)

    add_node(root)
    return {
        'version': 1,
        'meta': {'source': name, 'generator': 'mindmap_export.py'},
        'nodes': nodes,
        'edges': edges,
        'strokes': [],
        'shapes': [],
        'reveal': 1,
    }


def validate(data):
    errs = []
    try:
        rt = json.loads(json.dumps(data, ensure_ascii=False))
        assert rt['version'] == data['version']
    except Exception as e:
        errs.append(f'round-trip JSON: {e}')
        return errs
    ids = [n['id'] for n in data['nodes']]
    if not all(ids):
        errs.append('пустые id узлов (assign_ids не вызван?)')
        return errs
    if len(ids) != len(set(ids)):
        errs.append('дубликаты id узлов')
    idset = set(ids)
    seen_pairs = set()
    for e in data['edges']:
        if e['from'] not in idset or e['to'] not in idset:
            errs.append(f"ребро {e['id']} ссылается на несуществующий узел")
        if e['from'] == e['to']:
            errs.append(f"ребро {e['id']} замкнуто на себя")
        pair = frozenset((e['from'], e['to']))
        if pair in seen_pairs:
            errs.append(f"дубль ребра {'~'.join(sorted(pair))}")
        seen_pairs.add(pair)
    for n in data['nodes']:
        if not isinstance(n['x'], (int, float)) or not isinstance(n['y'], (int, float)):
            errs.append(f"{n['id']}: нечисловые координаты")
        if not isinstance(n['collapsed'], bool):
            errs.append(f"{n['id']}: collapsed не bool")
        if not isinstance(n.get('isTask'), bool) or not isinstance(n.get('done'), bool):
            errs.append(f"{n['id']}: isTask/done не bool")
        if not isinstance(n.get('tags'), list):
            errs.append(f"{n['id']}: tags не список")
        lv = n.get('levels') or []
        if lv:
            if not isinstance(lv[0].get('text'), str):
                errs.append(f"{n['id']}: levels битый")
            elif lv[0]['text'] != n['note']:
                errs.append(f"{n['id']}: note != levels[0].text")
        if not str(n['title']).strip():
            errs.append(f"{n['id']}: пустой title")
    kids = {}
    for e in data['edges']:
        kids.setdefault(e['from'], []).append(e['to'])
    root_id = data['nodes'][0]['id']
    seen, stack = {root_id}, [root_id]
    while stack:
        for c in kids.get(stack.pop(), []):
            if c not in seen:
                seen.add(c)
                stack.append(c)
    lost = idset - seen
    if lost:
        errs.append(f'недостижимые от корня: {sorted(lost)[:5]}')
    return errs


def chain_depth(data):
    kids = {}
    for e in data['edges']:
        kids.setdefault(e['from'], []).append(e['to'])
    best = 1
    stack = [(data['nodes'][0]['id'], 1)]
    while stack:
        nid, d = stack.pop()
        best = max(best, d)
        for c in kids.get(nid, []):
            stack.append((c, d + 1))
    return best


def json_task_states(data):
    kids = {}
    for e in data['edges']:
        kids.setdefault(e['from'], []).append(e['to'])
    info = {n['id']: n for n in data['nodes']}
    out = {}

    def dfs(nid, depth, chain):
        n = info[nid]
        if n.get('isTask'):
            key = (tuple(chain), norm_task_text(n['title']))
            out.setdefault(key, bool(n.get('done')))
            return
        nxt = chain + ([n['title']] if depth > 0 else [])
        for cid in kids.get(nid, []):
            dfs(cid, depth + 1, nxt)

    dfs(data['nodes'][0]['id'], 0, [])
    return out


def apply_states(root, desired):
    cnt = 0

    def walk(n, chain):
        nonlocal cnt
        if n.isTask:
            key = (tuple(chain), norm_task_text(n.title))
            if key in desired and n.done != desired[key]:
                n.done = desired[key]
                cnt += 1
            return
        nxt = chain + ([n.title] if n.depth > 0 else [])
        for c in n.children:
            walk(c, nxt)

    walk(root, [])
    return cnt


def sync_md_file(path, desired):
    p = Path(path)
    if not p.exists():
        return 0, set()
    lines = p.read_text(encoding='utf-8').splitlines()
    stack = []
    out = []
    flips = 0
    seen = set()
    for ln in lines:
        m = re.match(r'^(#{1,4})\s+(.+?)\s*#*$', ln)
        if m and not ln.lstrip().startswith('```'):
            lvl = len(m.group(1))
            while stack and stack[-1][0] >= lvl:
                stack.pop()
            stack.append((lvl, m.group(2).strip()))
            out.append(ln)
            continue
        tm = TASK_RE.match(ln)
        if tm:
            chain = tuple(t for l, t in stack if l != 1)
            key = (chain, norm_task_text(tm.group(2)))
            seen.add(key)
            if key in desired:
                want = desired[key]
                have = tm.group(1) in 'xX'
                if want != have:
                    indent = ln[:len(ln) - len(ln.lstrip())]
                    ln = f'{indent}- [{"x" if want else " "}] {tm.group(2)}'
                    flips += 1
        out.append(ln)
    p.write_text('\n'.join(out) + '\n', encoding='utf-8')
    return flips, seen