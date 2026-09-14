# -*- coding: utf-8 -*-
"""Тесты HTTP-импорта Markdown (кнопка «Импорт MD») через /api/import-md."""
import base64
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = server.app
client = TestClient(app)
mdlib = server.mdlib

PNG = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
)


def _doc(fname, text, monkeypatch, tmp_path):
    monkeypatch.setattr(server, 'IMAGES_DIR', tmp_path)
    return client.post('/api/import-md',
                       files={'file': (fname, text.encode(), 'text/markdown')})


def _map(d):
    return {'version': 1, 'meta': {}, 'nodes': d['nodes'], 'edges': d['edges'],
            'strokes': [], 'shapes': []}


def test_tasks_become_task_nodes(monkeypatch, tmp_path):
    text = '# Док\n\n## Секция\n\nтекст.\n\n- [ ] сделать\n- [x] готово\n'
    r = _doc('tasks.md', text, monkeypatch, tmp_path)
    assert r.status_code == 200
    d = r.json()
    tasks = [n for n in d['nodes'] if n['isTask']]
    assert len(tasks) == 2
    assert {n['done'] for n in tasks} == {True, False}
    assert mdlib.validate(_map(d)) == []


def test_long_note_split_into_details(monkeypatch, tmp_path):
    p1 = 'Предложение ' * 25 + '.'
    p2 = 'Дополнительный текст о деталях. ' * 20
    text = f'# Док\n\n## Большая секция\n\n{p1}\n\n{p2}\n'
    r = _doc('details.md', text, monkeypatch, tmp_path)
    assert r.status_code == 200
    d = r.json()
    assert d['details'] >= 1
    assert any(n['title'] == 'Детали' for n in d['nodes'])
    assert mdlib.validate(_map(d)) == []


def test_data_image_saved_into_project(monkeypatch, tmp_path):
    uri = 'data:image/png;base64,' + base64.b64encode(PNG).decode()
    text = f'# Док\n\n## Раздел с картинкой\n\nописание\n\n![схема]({uri})\n'
    r = _doc('img.md', text, monkeypatch, tmp_path)
    assert r.status_code == 200
    d = r.json()
    img_nodes = [n for n in d['nodes'] if n.get('image')]
    assert len(img_nodes) == 1
    n = img_nodes[0]
    assert n['image'].startswith('/images/')
    assert (tmp_path / n['image'].removeprefix('/images/')).exists()
    assert '![схема]' not in n['note']
    assert mdlib.validate(_map(d)) == []


def test_local_path_returns_warning_and_keeps_text(monkeypatch, tmp_path):
    text = '# Док\n\n## Раздел\n\n![локальная](C:/nope/x.png)\n'
    r = _doc('local.md', text, monkeypatch, tmp_path)
    assert r.status_code == 200
    d = r.json()
    assert d['warnings'], 'ожидалось предупреждение о локальном пути'
    assert not any(n.get('image') for n in d['nodes'])
    assert all('![локальная]' in n['note'] for n in d['nodes'] if 'локальная' in n['note'])


def test_import_well_formed_no_overlaps(monkeypatch, tmp_path):
    text = ('# Проект\n\n## Раздел А\n\nтекст.\n\n### Подраздел А.1\n\n'
            'детали подраздела\n\n## Раздел Б\n\n### Подраздел Б.1\n\nсодержимое\n')
    r = _doc('ok.md', text, monkeypatch, tmp_path)
    assert r.status_code == 200
    d = r.json()
    assert len(d['nodes']) >= 4
    assert mdlib.validate(_map(d)) == []
    assert d['warnings'] == []


def test_import_expands_tree(monkeypatch, tmp_path):
    text = '# Проект\n\n## Раздел А\n\n### Подраздел А.1\n\nдетали\n'
    r = _doc('exp.md', text, monkeypatch, tmp_path)
    assert r.status_code == 200
    d = r.json()
    ids = {n['id'] for n in d['nodes']}
    kids = set()
    for e in d['edges']:
        assert e['from'] in ids and e['to'] in ids
        kids.add(e['from'])
    with_children = [n for n in d['nodes'] if n['id'] in kids]
    assert with_children, 'ожидались ноды с детьми'
    assert all(not n['collapsed'] for n in with_children)