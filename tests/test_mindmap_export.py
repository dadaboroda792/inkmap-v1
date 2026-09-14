# -*- coding: utf-8 -*-
"""Тесты mindmap_export.py: таск-ноды, стабильные id, --sync."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
import mindmap_export as mx  # noqa: E402

DOC = '''# Документ проекта

## Раздел А

Вводный абзац.

- [ ] сделать шаг один
- [x] шаг два готов

### А.1 Деталь

тело подраздела
'''


def _doc(tmp_path):
    p = tmp_path / 'doc.md'
    p.write_text(DOC, encoding='utf-8')
    return str(p)


def test_checkbox_extraction(tmp_path):
    root = mx.parse_doc(_doc(tmp_path))
    sec = root.children[0]
    assert sec.title == 'Раздел А'
    assert len(sec.raw_tasks) == 2
    assert sec.raw_tasks[0] == (False, 'сделать шаг один')
    assert 'шаг один' not in sec.note and '[ ]' not in sec.note


def test_make_task_nodes_and_fields(tmp_path):
    root = mx.parse_doc(_doc(tmp_path))
    made = mx.make_task_nodes(root)
    assert made == 2
    tasks = [c for c in root.children[0].children if c.isTask]
    assert [(t.title, t.done) for t in tasks] == [
        ('сделать шаг один', False), ('шаг два готов', True)]
    mx.assign_ids(root)
    data = mx.build_json(root, 'T')
    tj = next(n for n in data['nodes'] if n['isTask'] and n['done'])
    assert tj['tags'] == [] and isinstance(tj['done'], bool)
    assert mx.validate(data) == []


def test_stable_ids_across_parses(tmp_path):
    p = _doc(tmp_path)
    ids = []
    for _ in range(2):
        r = mx.parse_doc(p)
        mx.make_task_nodes(r)
        mx.assign_ids(r)
        ids.append([n.id for n in r.children[0].children if n.isTask])
    assert ids[0] == ids[1]


def test_layout_parent_centered_over_children(tmp_path):
    root = mx.parse_doc(_doc(tmp_path))
    mx.make_task_nodes(root)
    mx.split_details(root)
    mx.assign_ids(root)
    mx.set_collapse(root, 0, True)
    mx.layout(root)
    assert mx.check_overlaps(root) == []

    checked = 0

    def walk(n):
        nonlocal checked
        for c in n.children:
            if c.children:
                checked += 1
                top = min(x.y for x in c.children)
                bot = max(x.y + x.h for x in c.children)
                assert top - 1e-6 <= c.y + c.h / 2 <= bot + 1e-6, c.title
            walk(c)

    walk(root)
    assert checked == 1  # только «Раздел А» имеет детей


def test_sync_flip_roundtrip(tmp_path):
    doc = _doc(tmp_path)
    root = mx.parse_doc(doc)
    mx.make_task_nodes(root)
    mx.split_details(root)
    mx.assign_ids(root)
    data = mx.build_json(root, 'T')
    for n in data['nodes']:
        if n['isTask'] and not n['done']:
            n['done'] = True
            break
    desired = mx.json_task_states(data)
    assert desired
    flips, seen = mx.sync_md_file(doc, desired)
    assert flips >= 1
    text = Path(doc).read_text(encoding='utf-8')
    assert '- [x] сделать шаг один' in text
    flips2, _ = mx.sync_md_file(doc, desired)
    assert flips2 == 0


def test_sync_missing_keys_counted_once(tmp_path):
    doc = _doc(tmp_path)
    desired = {(('другая секция',), 'нет такой задачи'): True}
    flips, seen = mx.sync_md_file(doc, desired)
    assert flips == 0
    missing = [k for k in desired if k not in seen]
    assert len(missing) == 1
