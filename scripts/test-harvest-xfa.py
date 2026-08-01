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

# The mixed shape: page subforms AND fields hanging off the root subform, which
# is how a form-wide date, a hidden version stamp or a root exclGroup is
# normally authored. Only the page subforms were walked, so that whole level
# vanished with nothing said — and the `or [form]` fallback hid it whenever the
# root had no page subforms at all, which is why it never showed up alone.
MIXED = """<?xml version="1.0"?>
<template xmlns="http://www.xfa.org/schema/xfa-template/3.0/">
  <subform name="form1">
    <subform name="page1" x="0in" y="0in">
      <field name="onPage" x="1in" y="1in" w="2in" h="0.25in"><ui><textEdit/></ui></field>
    </subform>
    <field name="formWideDate" x="5in" y="0.5in" w="1.5in" h="0.25in">
      <ui><dateTimeEdit/></ui>
    </field>
    <exclGroup name="scope" x="1in" y="6in">
      <field name="scopeAll" x="0in" y="0in" w="0.2in" h="0.2in"><ui><checkButton/></ui></field>
      <field name="scopeSome" x="1in" y="0in" w="0.2in" h="0.2in"><ui><checkButton/></ui></field>
    </exclGroup>
  </subform>
</template>"""

mixed = {f["name"]: f for f in parse_xfa_template(MIXED, PAGE_H).get(1, [])}
check(set(mixed) == {"onPage", "formWideDate", "scopeAll", "scopeSome"},
      f"root-level fields were dropped: harvested {sorted(mixed)}")
check(mixed.get("formWideDate", {}).get("type") == "date",
      "a root-level field lost its widget type")
# The exclGroup contributes its own offset the same way a subform does:
# 1in group + 1in field = 144pt.
check(mixed.get("scopeSome", {}).get("left") == 144.0,
      f"root exclGroup offset not applied: {mixed.get('scopeSome', {}).get('left')}")

# The fields-only root still yields each field exactly once — the fallback path
# must not double-count now that the root level is walked as well.
ONLY_ROOT = """<?xml version="1.0"?>
<template xmlns="http://www.xfa.org/schema/xfa-template/3.0/">
  <subform name="form1">
    <field name="solo" x="1in" y="1in" w="2in" h="0.25in"><ui><textEdit/></ui></field>
  </subform>
</template>"""
solo = parse_xfa_template(ONLY_ROOT, PAGE_H).get(1, [])
check([f["name"] for f in solo] == ["solo"],
      f"a root-only template harvested {[f['name'] for f in solo]}")

# An exclGroup is XFA's radio group and a choiceList carries its own option
# list. Neither was read: every exclGroup member came out an independent
# checkbox, so the editor let a Marine tick all three at once, and every
# dropdown shipped as a free-text box. Two groups share a name here because
# real templates reuse one across pages — fusing them would make picking a
# rank clear the pay grade.
PICKERS = """<?xml version="1.0"?>
<template xmlns="http://www.xfa.org/schema/xfa-template/3.0/">
  <subform name="form1">
    <subform name="page1" x="0in" y="0in">
      <exclGroup name="component" x="1in" y="1in">
        <field name="active" x="0in" y="0in" w="0.2in" h="0.2in">
          <ui><checkButton/></ui>
          <caption><value><text>Active</text></value></caption>
        </field>
        <field name="reserve" x="1in" y="0in" w="0.2in" h="0.2in"><ui><checkButton/></ui></field>
        <field name="retired" x="2in" y="0in" w="0.2in" h="0.2in"><ui><checkButton/></ui></field>
      </exclGroup>
      <exclGroup name="component" x="1in" y="2in">
        <field name="yes" x="0in" y="0in" w="0.2in" h="0.2in"><ui><checkButton/></ui></field>
        <field name="no" x="1in" y="0in" w="0.2in" h="0.2in"><ui><checkButton/></ui></field>
      </exclGroup>
      <field name="grade" x="1in" y="3in" w="1.5in" h="0.25in">
        <ui><choiceList/></ui>
        <items><text>Sergeant</text><text>Staff Sergeant</text></items>
        <items save="1" presence="hidden"><text>E5</text><text>E6</text></items>
      </field>
      <field name="remarks" x="1in" y="4in" w="5in" h="0.25in">
        <ui><textEdit multiLine="1"/></ui>
      </field>
      <field name="tallName" x="1in" y="5in" w="5in" h="1in">
        <ui><textEdit/></ui>
      </field>
    </subform>
  </subform>
</template>"""

picked = {f["name"]: f for f in parse_xfa_template(PICKERS, PAGE_H).get(1, [])}

# Mutual exclusion: every member is a radio, and the two same-named groups do
# not fuse into one.
for name in ("active", "reserve", "retired", "yes", "no"):
    check(picked.get(name, {}).get("type") == "radio",
          f"exclGroup member {name!r} came out as "
          f"{picked.get(name, {}).get('type')!r}, not a radio")
first = {picked[k]["group"] for k in ("active", "reserve", "retired")}
second = {picked[k]["group"] for k in ("yes", "no")}
check(len(first) == 1 and len(second) == 1,
      f"one exclGroup produced several group ids: {first} / {second}")
check(first != second,
      f"two same-named exclGroups fused into one pick-one ({first}) — picking in "
      "either would clear the other")

# The dropdown offers what the form prints, not the export codes.
check(picked.get("grade", {}).get("type") == "choice", "choiceList should map to choice")
check(picked.get("grade", {}).get("options") == ["Sergeant", "Staff Sergeant"],
      f"choiceList options harvested as {picked.get('grade', {}).get('options')}")

# Wrapping comes from the template, not from how tall the box happens to be.
check(picked.get("remarks", {}).get("multiline") is True,
      'a field the template marks multiLine="1" was not marked multiline')
check(picked.get("tallName", {}).get("multiline") is False,
      "a 72pt-tall single-line field was marked multiline anyway")

if failures:
    print(f"FAIL — {len(failures)} assertion(s):")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print(f"OK — XFA harvest path parsed {len(fields)} fields, all assertions passed")
