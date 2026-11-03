#!/usr/bin/env python3
"""Triage the auto-generated forms by field-label quality (READ-ONLY).

Walks every committed public/templates/*/form.json and flags fields whose label
is unhelpful to a Marine: a bare number ("237"), a widget stub ("textField2"),
or a mechanical camel-split of the field key (no printed caption was found).
Writes a sorted docs/label-quality.tsv — the same triage shape as
docs/xfa-manual-queue.tsv — so the worst forms are easy to prioritize for a
label backfill. Writes NO form.json and changes no data.

Run: python3 scripts/label-quality.py
"""
from __future__ import annotations

import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATES = os.path.join(ROOT, 'public', 'templates')
OUT = os.path.join(ROOT, 'docs', 'label-quality.tsv')

NUMERIC = re.compile(r'^\d+$')
WIDGET_STUB = re.compile(r'^(text|date|check|radio|button|numeric|dropdown|choice|cell)[A-Za-z]*\d+$', re.I)


def humanize_key(key: str) -> str:
    """Mirror the harvester's humanize(): a label equal to this means no real
    printed caption was found and the key was split as a last resort."""
    spaced = re.sub(r'(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=\d)', ' ', key)
    return (spaced[:1].upper() + spaced[1:]) if spaced else key


def flag(key: str, label: str) -> str | None:
    if not label or NUMERIC.match(label):
        return 'numeric'
    if WIDGET_STUB.match(label):
        return 'widget-stub'
    if label == humanize_key(key):
        return 'key-derived'
    return None


def main() -> None:
    idx = json.load(open(os.path.join(TEMPLATES, 'index.json')))
    rows = []
    for t in idx['templates']:
        if not t.get('config'):
            continue
        d = t['directory']
        try:
            cfg = json.load(open(os.path.join(TEMPLATES, d, 'form.json')))
        except (OSError, json.JSONDecodeError):
            continue
        fields = cfg.get('fields', {})
        # rowGroup columns are labelled too — count them alongside flat fields.
        cols = [(ck, c.get('label', '')) for g in cfg.get('rowGroups', {}).values()
                for ck, c in g.get('columns', {}).items()]
        items = [(k, f.get('label', '')) for k, f in fields.items()] + cols
        if not items:
            continue
        flagged = sum(1 for k, lbl in items if flag(k, lbl))
        if flagged:
            rows.append((d, flagged, len(items), flagged / len(items)))

    rows.sort(key=lambda r: (-r[3], -r[1]))
    with open(OUT, 'w') as fh:
        fh.write('form\tflagged\ttotal\tfraction\n')
        for d, flagged, total, frac in rows:
            fh.write(f'{d}\t{flagged}\t{total}\t{frac:.2f}\n')

    worst = rows[:10]
    print(f'label-quality: {len(rows)} of {sum(1 for t in idx["templates"] if t.get("config"))} '
          f'config forms have >=1 weak label -> {OUT}')
    print('worst 10 (fraction weak):')
    for d, flagged, total, frac in worst:
        print(f'  {frac:5.0%}  {flagged:>3}/{total:<3}  {d}')


if __name__ == '__main__':
    main()
