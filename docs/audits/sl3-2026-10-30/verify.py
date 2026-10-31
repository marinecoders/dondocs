"""Inspect synthetic audit exports. Outputs observations, not a compliance pass."""
import collections
import json
from pathlib import Path
import subprocess
import sys

import pdfplumber
from pypdf import PdfReader

root = Path(sys.argv[1])
cases = [
    "portrait", "landscape", "continuation", "controlled", "raster-text",
    "restricted-unclassified", "export-controlled", "searchable-labels",
]
rows = []
for name in cases:
    path = root / (name + ".pdf")
    if not path.exists():
        validation = json.loads((root / 'fixture-validation.json').read_text())
        rows.append({'fixture': name, 'export_rejected': True, 'errors': next(r['errors'] for r in validation if r['name'] == name)})
        continue
    pages = subprocess.check_output(
        ["pdftotext", "-layout", str(path), "-"], text=True,
    ).split("\f")
    pages = [page for page in pages if page.strip()]
    text = "\n".join(pages)
    toc = next(i for i, page in enumerate(pages) if "TABLE OF CONTENTS" in page)
    preface = next(
        i for i, page in enumerate(pages)
        if "PREFACE" in page and "1. Scope." in page
    )
    abbreviations = next(
        page for page in pages
        if "ABBREVIATIONS" in page and "CAGE" in page and "Commercial" in page
    )
    reader = PdfReader(path)
    annotations = [a.get_object() for a in reader.pages[toc].get("/Annots", [])]
    with pdfplumber.open(path) as pdf:
        rules = [
            {"left": round(line["x0"], 2), "right": round(line["x1"], 2)}
            for line in pdf.pages[toc].lines
        ]
        auth_sizes = collections.Counter(
            round(char["size"], 2) for char in pdf.pages[1].chars
            if 120 < char["top"] < 600
        )
    rows.append({
        "fixture": name,
        "pages": len(pages),
        "NOFORN_in_pdf": "NOFORN" in text,
        "raster_label_searchable": "VALVE INLET" in text,
        "preface_header_has_date": "30 OCTOBER 2026" in pages[preface],
        "encrypted": reader.is_encrypted,
        "xmp_present": reader.xmp_metadata is not None,
        "toc_link_annotations": sum(a.get("/Subtype") == "/Link" for a in annotations),
        "toc_rule_x_ranges": rules,
        "authentication_size_counts": auth_sizes.most_common(3),
        "toc_title_underline_count": sum(rule['left'] < 200 and rule['right'] - rule['left'] > 20 for rule in rules),
        "CUI_control_on_every_page": all('CUI//NOFORN' in page for page in pages) if name in ('controlled', 'export-controlled') else None,
        "missing_static_glossary_terms": [
            term for term in ["PAE", "PPO", "DCI"]
            if term in text and term not in abbreviations
        ],
    })
(root / "observations.json").write_text(json.dumps(rows, indent=2) + "\n")
print(json.dumps(rows, indent=2))
