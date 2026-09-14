# -*- coding: utf-8 -*-
"""Экспорт ARCHITECTURE.md (+ overlay MINDMAP.md) в карту InkMap.

Вся логика парсинга/лейаута/валидации живёт в md_import_lib.py; этот файл —
консольная обвязка: фиксированные пути TwitchBot, overlay, --sync, --dry-run.
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from md_import_lib import (MAX_NOTE_CHARS, apply_overlay, apply_states,
                           assign_ids, build_json, chain_depth,
                           json_task_states, layout, make_task_nodes,
                           parse_doc, set_collapse, split_details,
                           sync_md_file, check_overlaps, validate)


def main():
    ap = argparse.ArgumentParser(description='ARCHITECTURE.md -> карта InkMap')
    ap.add_argument('--doc', default=r'D:\twichbot\ARCHITECTURE.md')
    ap.add_argument('--overlay', default=r'D:\twichbot\MINDMAP.md')
    ap.add_argument('--name', default='TwitchBot')
    ap.add_argument('--out', default=None)
    ap.add_argument('--expand', type=int, default=None,
                    help='глубина разворота при открытии: узлы с depth < N раскрыты '
                         '(по умолчанию дерево раскрыто полностью)')
    ap.add_argument('--no-collapse', action='store_true')
    ap.add_argument('--sync', action='store_true',
                    help='перенести статусы тасков из существующей карты обратно в MD')
    ap.add_argument('--json', default=None, help='путь к карте для --sync (по умолчанию = --out)')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

    root = parse_doc(args.doc)
    if 'twitchbot' in root.title.lower():
        root.title = re.sub(r'(?is)^.*?(twitchbot)\s*$', r'\1 · Архитектура', root.title)
    merged = apply_overlay(root, args.overlay)
    tasks_made = make_task_nodes(root)
    details = split_details(root)

    sync_flips = sync_missing = 0
    if args.sync:
        jp = Path(args.json) if args.json else (
            Path(args.out) if args.out else Path(r'D:\inkmap\data') / 'twitchbot.json')
        if jp.exists():
            old = json.loads(jp.read_text(encoding='utf-8'))
            desired = json_task_states(old)
            applied = apply_states(root, desired)
            f1, s1 = sync_md_file(args.doc, desired)
            f2, s2 = (0, set())
            if Path(args.overlay).exists():
                f2, s2 = sync_md_file(args.overlay, desired)
            sync_flips = f1 + f2
            sync_missing = len([k for k in desired if k not in s1 | s2])
            print(f'sync: состояний из карты {len(desired)}, применено на ноды {applied}, '
                  f'флипов чекбоксов {sync_flips}, не найдено в MD: {sync_missing}')
        else:
            print(f'sync: карта {jp} не найдена — пропущено')

    assign_ids(root)
    if args.expand is None:
        set_collapse(root, 0, True)
    else:
        set_collapse(root, max(0, args.expand), args.no_collapse)
    layout(root)

    overlaps = check_overlaps(root)
    data = build_json(root, args.name)

    print(f'источник: {args.doc}')
    if Path(args.overlay).exists():
        print(f'overlay: {args.overlay} (правок применено: {merged})')
    else:
        print('overlay: отсутствует (пропущен)')
    print(f"узлов: {len(data['nodes'])} (+{details} «Детали», +{tasks_made} тасков), "
          f"рёбер: {len(data['edges'])}, глубина цепочки: {chain_depth(data)}")
    collapsed = sum(1 for n in data['nodes'] if n['collapsed'])
    tasks_open = sum(1 for n in data['nodes'] if n.get('isTask') and not n['done'])
    print(f"свёрнуто при открытии: {collapsed}, тасков открыто: {tasks_open}, "
          f"символов в notes: {sum(len(n['note']) for n in data['nodes'])}")
    by_color = {}
    for n in data['nodes']:
        by_color[n['color'] or '(default)'] = by_color.get(n['color'] or '(default)', 0) + 1
    print('цвета:', ', '.join(f'{k}={v}' for k, v in sorted(by_color.items())))

    errs = validate(data)
    if overlaps:
        errs.append(f'наслоение нод: {len(overlaps)} пар, например: '
                    + '; '.join(f'{a} ~ {b}' for a, b in overlaps[:3]))
    if errs:
        print('ОШИБКИ ВАЛИДАЦИИ:')
        for e in errs:
            print('  -', e)
        sys.exit(1)
    print('валидация: ok (round-trip, id, рёбра, связность, схема, без наслоений)')

    if args.dry_run:
        print('dry-run: файл не записан')
        return

    out = Path(args.out) if args.out else Path(r'D:\inkmap\data') / 'twitchbot.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'записано: {out} ({out.stat().st_size} байт)')


if __name__ == '__main__':
    main()