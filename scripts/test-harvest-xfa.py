#!/usr/bin/env python3
"""Exercise the XFA-template harvest path with a synthetic template.

The AcroForm path runs against hundreds of real forms every import, but the XFA
fallback (`parse_xfa_template`) only fires on dynamic/XFA-only PDFs — the very
forms the flattener refuses and parks in docs/xfa-manual-queue.tsv. So it never
runs in the pipeline and could rot undetected. This drives it directly with a
hand-built <template>, asserting widget-type mapping, the bottom-left→top-left
coordinate flip, content-area offset, and the button / zero-size skips.

Run: python3 scripts/test-harvest-xfa.py   (no PDF, no poppler needed)
"""
import importlib.util
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("harvest_fields", HERE / "harvest-fields.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
parse_xfa_template = mod.parse_xfa_template

# A minimal but realistic LiveCycle template: content area inset half an inch,
# one page subform, and one field per widget class plus the two that must be
# dropped (a print button and a collapsed zero-size field).
TEMPLATE = """<?xml version="1.0"?>
<template xmlns="http://www.xfa.org/schema/xfa-template/3.0/">
  <subform name="form1" layout="tb">
    <pageSet>
      <pageArea name="Page1">
        <contentArea x="0.5in" y="0.5in" w="7.5in" h="10in"/>
      </pageArea>
    </pageSet>
    <subform name="page1" x="0in" y="0in">
      <field name="rankName" x="1in" y="1in" w="2in" h="0.25in">
        <ui><textEdit/></ui>
        <caption><value><text>Rank/Name</text></value></caption>
      </field>
      <field name="onLeave" x="1in" y="2in" w="0.2in" h="0.2in">
        <ui><checkButton/></ui>
        <caption><value><text>On Leave</text></value></caption>
      </field>
      <field name="reportDate" x="4in" y="1in" w="1.5in" h="0.25in">
        <ui><dateTimeEdit/></ui>
      </field>
      <field name="unit" x="1in" y="3in" w="2in" h="0.25in">
        <ui><choiceList/></ui>
      </field>
      <field name="printBtn" x="6in" y="9in" w="1in" h="0.3in">
        <ui><button/></ui>
      </field>
      <field name="collapsed" x="1in" y="4in" w="0in" h="0in">
        <ui><textEdit/></ui>
      </field>
    </subform>
  </subform>
</template>"""

PAGE_H = 792.0  # US Letter, points

failures: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        failures.append(msg)


pages = parse_xfa_template(TEMPLATE, PAGE_H)

check(list(pages) == [1], f"expected exactly page 1, got {list(pages)}")
fields = {f["name"]: f for f in pages.get(1, [])}

# The button and the zero-size field are dropped; the four real widgets remain.
check(set(fields) == {"rankName", "onLeave", "reportDate", "unit"},
      f"unexpected field set: {sorted(fields)}")

# Widget class -> field type mapping.
check(fields["rankName"]["type"] == "text", "textEdit should map to text")
check(fields["onLeave"]["type"] == "checkbox", "checkButton should map to checkbox")
check(fields["reportDate"]["type"] == "date", "dateTimeEdit should map to date")
check(fields["unit"]["type"] == "choice", "choiceList should map to choice")

# Geometry: content area (0.5in = 36pt) offsets x; y is flipped from XFA's
# top-down origin into the app's bottom-left page space.
#   rankName at 1in,1in -> left 36+72=108, top 792-(36+72)=684, w 144, h 18.
r = fields["rankName"]
check(r["left"] == 108.0, f"rankName left {r['left']} != 108.0")
check(r["top"] == 684.0, f"rankName top {r['top']} != 684.0")
check(r["width"] == 144.0 and r["height"] == 18.0, f"rankName size {r['width']}x{r['height']}")
check(r["description"] == "Rank/Name", f"rankName caption {r['description']!r}")

# reportDate at 4in,1in shares the same row -> same top, x shifted right.
d = fields["reportDate"]
check(d["left"] == 324.0 and d["top"] == 684.0, f"reportDate pos {d['left']},{d['top']}")

# A field with no caption yields an empty description, not a crash.
check(fields["unit"]["description"] == "", "captionless field should be empty-described")

# Empty template and non-template roots degrade to {} rather than raising.
check(parse_xfa_template("<template></template>", PAGE_H) == {},
      "template with no form subform should return {}")

if failures:
    print(f"FAIL — {len(failures)} assertion(s):")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print(f"OK — XFA harvest path parsed {len(fields)} fields, all assertions passed")
