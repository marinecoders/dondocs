#!/usr/bin/env python3
"""Harvest form-field boxes from an official NAVMC PDF into a boxes.json draft.

    python3 scripts/harvest-fields.py <original.pdf> "<Form Folder Name>"

Reads the ORIGINAL (EF) PDF — not the flattened pages — because that is where
the field geometry lives, and writes:

    public/templates/<folder>/boxes.draft.json   (review, rename keys, promote)
    <tmp>/overlay-pageN.png                      (harvested boxes drawn on the
                                                  flattened pages — EYEBALL THIS)

Two sources, in trust order:
  1. AcroForm widget annotations — exact rectangles, exact page mapping
     (e.g. NAVMC 10132). Descriptions come from each widget's tooltip (/TU),
     which LiveCycle fills with the field's caption.
  2. XFA template XML — for XFA-only originals: field x/y/w/h accumulated down
     the subform tree, units converted, y flipped into PDF space. Computed, not
     exact — the overlay review is mandatory.

The draft matches the committed boxes.json schema: PDF points, origin at
bottom-left, `top` = Y of the box's TOP edge. Keys are camelCased from the
source field names; rename them to semantic keys when building the editor.

Requires: pypdf, Pillow (both present), poppler's pdftoppm for overlays.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from pypdf import PdfReader
    from pypdf.generic import IndirectObject
except ImportError:
    sys.exit("harvest-fields: pip install pypdf")
try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("harvest-fields: pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent


# --- shared helpers ---------------------------------------------------------

def camel(name: str) -> str:
    """LiveCycle name -> draft key: last meaningful segment, camelCased.
    'form1[0].Page1[0].Accused_Name[0]' -> 'accusedName'.
    XFA escapes literal dots inside a segment as '\\.' (the 10359's
    'Date\\.0'); those are part of the name, not a hierarchy split — fold
    them into the segment before splitting so the key keeps its word
    ('date0'), instead of collapsing to the bare digit."""
    seg = re.split(r"(?<!\\)[.]", name.replace("\\.", "\x00"))[-1].replace("\x00", "_")
    seg = re.sub(r"\[\d+\]", "", seg)
    words = re.split(r"[^0-9A-Za-z]+", seg)
    words = [w for w in words if w]
    if not words:
        return "field"
    # An all-caps first word ('ARTICLES', 'MANUF') camelizes by lowercasing
    # wholesale — 'articles', not the smooshed 'aRTICLES'.
    if words[0].isupper() and len(words[0]) > 1:
        words[0] = words[0].lower()
    out = words[0][0].lower() + words[0][1:]
    for w in words[1:]:
        out += w[0].upper() + w[1:]
    return out


def humanize(key: str) -> str:
    """Draft key -> readable fallback label: 'scorePullUpOrFAH' ->
    'Score Pull Up Or FAH'. Only used when the widget has no tooltip."""
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=\d)", " ", key)
    return (spaced[:1].upper() + spaced[1:]) if spaced else key


def dedupe(key: str, used: set[str]) -> str:
    if key not in used:
        used.add(key)
        return key
    i = 2
    while f"{key}{i}" in used:
        i += 1
    used.add(f"{key}{i}")
    return f"{key}{i}"


FIELD_TYPES = {"/Tx": "text", "/Ch": "choice", "/Sig": "signature"}


# --- source 1: AcroForm widgets --------------------------------------------

def resolve(obj):
    return obj.get_object() if isinstance(obj, IndirectObject) else obj


def inherited(widget, key):
    node = widget
    for _ in range(16):
        if key in node:
            return node[key]
        parent = node.get("/Parent")
        if parent is None:
            return None
        node = resolve(parent)
    return None


def qualified_name(widget) -> str:
    parts, node = [], widget
    for _ in range(16):
        t = node.get("/T")
        if t:
            parts.append(str(t))
        parent = node.get("/Parent")
        if parent is None:
            break
        node = resolve(parent)
    return ".".join(reversed(parts)) or "field"


def choice_options(widget) -> list[str] | None:
    """A /Ch field's dropdown list (/Opt): either bare strings or
    [export, display] pairs — we keep the display text a person reads."""
    opt = inherited(widget, "/Opt")
    if opt is None:
        return None
    out = []
    for o in resolve(opt):
        o = resolve(o)
        out.append(str(resolve(o[-1]) if isinstance(o, list) and o else o))
    return [s for s in out if s] or None


def radio_export(widget) -> str | None:
    """A radio kid's export value = the non-/Off appearance state in /AP /N.
    That is the option's real value ('Male', 'Yes', '1'), a better label than
    the group tooltip shared by every kid."""
    ap = resolve(widget.get("/AP")) if "/AP" in widget else None
    n = resolve(ap.get("/N")) if ap and "/N" in ap else None
    if not n:
        return None
    for k in n.keys():
        if str(k) != "/Off":
            return str(k).lstrip("/")
    return None


# --- smart labels: the printed caption nearest a field ----------------------

def page_words(page_pdf: Path) -> tuple[list[dict], float]:
    """Every printed word on a page with its box, via `pdftotext -bbox`.
    Boxes are top-left origin, points. Returns (words, page_height)."""
    try:
        xml = subprocess.run(
            ["pdftotext", "-bbox", str(page_pdf), "-"],
            capture_output=True, text=True, timeout=30,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return [], 0.0
    ph = float(m.group(1)) if (m := re.search(r'<page width="[\d.]+" height="([\d.]+)"', xml)) else 0.0
    words = []
    for wm in re.finditer(
        r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', xml
    ):
        x0, y0, x1, y1, text = wm.groups()
        text = text.strip()
        if text:
            words.append({"x0": float(x0), "y0": float(y0), "x1": float(x1), "y1": float(y1), "text": text})
    return words, ph


def caption_for(field: dict, words: list[dict], page_h: float) -> str | None:
    """The printed caption for a field with no tooltip: the run of words
    immediately to its left on the same line, else the words just above it.
    Field geometry is bottom-left origin; words are top-left, so flip Y."""
    if not words or page_h <= 0:
        return None
    top = page_h - field["top"]                      # field top edge, top-left origin
    bot = page_h - (field["top"] - field["height"])  # field bottom edge
    left, right = field["left"], field["left"] + field["width"]
    mid = (top + bot) / 2

    def clean(ws: list[dict]) -> str | None:
        s = re.sub(r"[\s:._]+$", "", " ".join(w["text"] for w in ws)).strip()
        return s if s and re.search(r"[A-Za-z]", s) and 2 <= len(s) <= 60 else None

    # Same-line words ending before the field (a "Name:" to the left).
    row = [w for w in words if w["y0"] <= mid <= w["y1"] and w["x1"] <= left + 2]
    if row:
        row.sort(key=lambda w: w["x0"])
        # keep only the trailing contiguous run (skip a big gap to the left).
        run = [row[-1]]
        for w in reversed(row[:-1]):
            if run[0]["x0"] - w["x1"] > 25:
                break
            run.insert(0, w)
        if (c := clean(run)):
            return c

    # Otherwise the nearest line of words above, horizontally overlapping.
    above = [w for w in words if w["y1"] <= top + 1 and w["x1"] > left and w["x0"] < right]
    if above:
        anchor = max(above, key=lambda w: w["y1"])
        line = [w for w in above if abs(w["y1"] - anchor["y1"]) <= 3]
        line.sort(key=lambda w: w["x0"])
        return clean(line)
    return None


def harvest_acroform(reader: PdfReader) -> dict[int, list[dict]]:
    pages: dict[int, list[dict]] = {}
    for idx, page in enumerate(reader.pages, start=1):
        for ref in page.get("/Annots") or []:
            w = resolve(ref)
            if w.get("/Subtype") != "/Widget":
                continue
            ft = inherited(w, "/FT")
            flags = int(inherited(w, "/Ff") or 0)
            if ft == "/Btn":
                if flags & (1 << 16):  # pushbutton (Reset/Print) — not data
                    continue
                ftype = "radio" if flags & (1 << 15) else "checkbox"
            else:
                ftype = FIELD_TYPES.get(str(ft), "text")
            rect = [float(v) for v in w["/Rect"]]
            llx, urx = sorted((rect[0], rect[2]))
            lly, ury = sorted((rect[1], rect[3]))
            if urx - llx < 1 or ury - lly < 1:
                continue
            name = qualified_name(w)
            tooltip = str(inherited(w, "/TU") or "")
            # Radio kids of one group share a qualified name; that becomes the
            # `group` so the editor makes them mutually exclusive, and the kid's
            # export value labels the option.
            export = radio_export(w) if ftype == "radio" else None
            pages.setdefault(idx, []).append({
                "name": name,
                "type": ftype,
                "left": round(llx, 1),
                "top": round(ury, 1),
                "width": round(urx - llx, 1),
                "height": round(ury - lly, 1),
                "description": export or tooltip,
                "options": choice_options(w) if ftype == "choice" else None,
                "group": name if ftype == "radio" else None,
                # /Ff bit 2 (value 2) marks a field the form author made
                # mandatory — feeds the app's readiness meter.
                "required": bool(flags & (1 << 1)),
            })
    return pages


# --- source 2: XFA template XML --------------------------------------------

UNIT = {"mm": 72 / 25.4, "cm": 72 / 2.54, "in": 72.0, "pt": 1.0}


def measure(value: str | None) -> float:
    if not value:
        return 0.0
    m = re.fullmatch(r"(-?[\d.]+)\s*(mm|cm|in|pt)?", value.strip())
    if not m:
        return 0.0
    return float(m.group(1)) * UNIT.get(m.group(2) or "pt", 1.0)


def xfa_template_xml(reader: PdfReader) -> str | None:
    acro = resolve(reader.trailer["/Root"]).get("/AcroForm")
    if acro is None:
        return None
    xfa = resolve(acro).get("/XFA")
    if xfa is None:
        return None
    xfa = resolve(xfa)
    if hasattr(xfa, "get_data"):
        return xfa.get_data().decode("utf-8", "replace")
    chunks, take = [], False
    for item in xfa:
        item = resolve(item)
        if isinstance(item, str):
            take = item == "template"
        elif take:
            chunks.append(item.get_data().decode("utf-8", "replace"))
            take = False
    return "".join(chunks) or None


def harvest_xfa(reader: PdfReader, page_height: float) -> dict[int, list[dict]]:
    xml = xfa_template_xml(reader)
    if not xml:
        return {}
    return parse_xfa_template(xml, page_height)


def parse_xfa_template(xml: str, page_height: float) -> dict[int, list[dict]]:
    """Field geometry from an XFA <template> string. Split out from the reader
    so the XFA path can be exercised on synthetic XML without an Acrobat-only
    PDF — the real-world sources (dynamic NAVMCs) live in the manual queue."""
    import xml.etree.ElementTree as ET

    xml = re.sub(r'\sxmlns="[^"]+"', "", xml, count=1)
    root = ET.fromstring(xml)

    # Content margins: the first contentArea places the form on the page.
    ca = root.find(".//contentArea")
    off_x = measure(ca.get("x")) if ca is not None else 0.0
    off_y = measure(ca.get("y")) if ca is not None else 0.0

    # Page assignment: each top-level positioned subform under the root form
    # subform is one page, in document order (the layout NAVMC forms use).
    form = root.find("subform")
    if form is None:
        return {}
    page_roots = [sf for sf in form.findall("subform")] or [form]

    pages: dict[int, list[dict]] = {}

    def walk(node, base_x: float, base_y: float, page: int):
        for child in node:
            if child.tag == "field":
                x = base_x + measure(child.get("x"))
                y = base_y + measure(child.get("y"))
                w = measure(child.get("w"))
                h = measure(child.get("h"))
                if w < 1 or h < 1:
                    continue
                ui = child.find("ui")
                widget = list(ui)[0].tag if ui is not None and len(ui) else "textEdit"
                ftype = {
                    "checkButton": "checkbox", "dateTimeEdit": "date",
                    "signature": "signature", "choiceList": "choice",
                }.get(widget, "text")
                if widget == "button":
                    continue
                cap = child.find("caption/value/text")
                pages.setdefault(page, []).append({
                    "name": child.get("name") or "field",
                    "type": ftype,
                    "left": round(off_x + x, 1),
                    "top": round(page_height - (off_y + y), 1),
                    "width": round(w, 1),
                    "height": round(h, 1),
                    "description": (cap.text or "").strip() if cap is not None else "",
                })
            elif child.tag in ("subform", "exclGroup", "area"):
                walk(child, base_x + measure(child.get("x")), base_y + measure(child.get("y")), page)

    for i, pr in enumerate(page_roots, start=1):
        walk(pr, measure(pr.get("x")), measure(pr.get("y")), i)
    return pages


# --- output + overlay proof --------------------------------------------------

def main() -> None:
    if len(sys.argv) < 3:
        sys.exit('usage: harvest-fields.py <original.pdf> "<Form Folder Name>"')
    src = Path(sys.argv[1]).expanduser()
    folder = ROOT / "public" / "templates" / sys.argv[2]
    if not src.is_file():
        sys.exit(f"harvest-fields: source not found: {src}")
    if not folder.is_dir():
        sys.exit(f"harvest-fields: template folder not found: {folder} (run import-navmc.sh first)")

    page_pdfs = sorted(folder.glob("page*.pdf"), key=lambda p: int(re.search(r"\d+", p.stem).group()))
    with Image.open(io_render(page_pdfs[0])) as im:
        pass  # warm nothing; sizes come from pdfinfo below

    reader = PdfReader(str(src))
    first = reader.pages[0].mediabox
    page_w, page_h = float(first.width), float(first.height)

    # Revision guard: the source PDF and the committed template pages must be
    # the SAME document, or every harvested coordinate silently lies (we caught
    # a 612pt-tall web 11622 against 684pt-tall committed pages). Page size is
    # the cheap tell; the overlay review is the thorough one.
    tmpl = PdfReader(str(page_pdfs[0])).pages[0].mediabox
    tw, th = float(tmpl.width), float(tmpl.height)
    if abs(tw - page_w) > 1 or abs(th - page_h) > 1:
        sys.exit(
            f"harvest-fields: REFUSED — source pages are {page_w:g}x{page_h:g} pt but the "
            f"committed template pages are {tw:g}x{th:g} pt. Different revisions: harvest "
            f"from the SAME original the template pages were flattened from."
        )

    fields = harvest_acroform(reader)
    source = "acroform"
    if not any(fields.values()):
        fields = harvest_xfa(reader, page_h)
        source = "xfa"
    if not any(fields.values()):
        sys.exit("harvest-fields: no fields found in AcroForm widgets or XFA template")

    # Smart labels: a field with no authored tooltip inherits the printed
    # caption nearest it on the flattened page — far better than the smooshed
    # key. Best-effort; the key humanization is still the final fallback.
    for page_no, flist in fields.items():
        if page_no > len(page_pdfs) or not any(not f["description"] for f in flist):
            continue
        words, ph = page_words(page_pdfs[page_no - 1])
        for f in flist:
            if not f["description"] and (cap := caption_for(f, words, ph)):
                f["description"] = cap

    used: set[str] = set()
    draft_pages: dict[str, dict] = {}
    orig_names: dict[str, dict[str, str]] = {}
    warnings: list[str] = []
    total = 0
    for page_no in sorted(fields):
        if page_no > len(page_pdfs):
            warnings.append(f"fields mapped to page {page_no} but only {len(page_pdfs)} template pages exist")
            continue
        boxes: dict[str, dict] = {}
        orig_names.setdefault(f"page{page_no}", {})
        for f in sorted(fields[page_no], key=lambda f: (-f["top"], f["left"])):
            key = dedupe(camel(f["name"]), used)
            orig_names[f"page{page_no}"][key] = f["name"]
            if not (0 <= f["left"] <= page_w and 0 <= f["top"] <= page_h):
                warnings.append(f"page{page_no}.{key} out of bounds: left={f['left']} top={f['top']}")
            boxes[key] = {
                "left": f["left"], "top": f["top"],
                "width": f["width"], "height": f["height"],
                "type": f["type"], "description": f["description"],
                "options": f.get("options"), "group": f.get("group"),
                "required": f.get("required"),
            }
            total += 1
        draft_pages[f"page{page_no}"] = boxes

    draft = {
        "template": f"page{min(fields)}.pdf",
        "source": source,
        "pageSize": {"width": round(page_w), "height": round(page_h)},
        "notes": [
            "DRAFT — harvested by scripts/harvest-fields.py; review the overlay PNGs,",
            "rename keys to semantic names, then promote to boxes.json.",
            "Coordinates are in PDF points (72 points = 1 inch)",
            "Origin is at bottom-left of page; top is the Y of the box's TOP edge",
        ],
        "pages": draft_pages,
    }
    out = folder / "boxes.draft.json"
    out.write_text(json.dumps(draft, indent=2) + "\n")

    # Detect repeated-row families (roster forms). Two encodings exist in the
    # wild: a RowN suffix on the field name (lastNameRow1..RowN), and a varying
    # index on a repeating parent subform (Subform1[0].FirstName ..
    # Subform1[29].FirstName — the 11622). A family qualifies when >=3
    # consecutive rows share one left edge and a constant vertical stride;
    # its columns collapse into a rowGroup whose boxes describe row 1 and
    # leave the flat field list. Anything irregular stays a plain field.
    row_groups: dict[str, dict] = {}
    grouped_keys: set[str] = set()
    for page_name, boxes in draft_pages.items():
        families: dict[str, list[tuple[str, dict]]] = {}
        for key, b in boxes.items():
            # Radio-group members carry a shared AcroForm parent name (b["group"])
            # and stack at a constant vertical stride — geometry indistinguishable
            # from a roster. But a radio group is ONE pick-one field, not a table:
            # collapsing it into a grid destroys mutual exclusion and drops the
            # group/options/required that field_config attaches (the grid renders
            # each option as a free-text cell). Keep radio kids out of the family
            # builder so they stay flat radio fields the editor groups correctly.
            if b.get("group"):
                continue
            name = orig_names.get(page_name, {}).get(key, key)
            # Encoding 1: numeric row suffix on the key — lastNameRow1..RowN,
            # but also bare trailing digits (the 10561's Model1..Model5) and
            # dot-indices that camelize to digits (the 10359's Date.0 ->
            # date0). Any trailing number is only a CANDIDATE; the geometry
            # gates below (shared left edge, constant stride, >=3 rows)
            # decide whether it is actually a table.
            m = re.fullmatch(r"(.*?)(?:Row|ROW)?(\d+)", key)
            if m and m.group(1):
                families.setdefault(f"suffix:{m.group(1)}", []).append((key, b))
            # Encoding 2: wildcard each bracket index in the qualified name in
            # turn; the position whose index varies across fields is the row.
            for wm in re.finditer(r"\[(\d+)\]", name):
                wildcard = name[: wm.start()] + "[*]" + name[wm.end():]
                families.setdefault(f"index:{wildcard}", []).append((key, b))
        col_used: set[str] = set()
        candidates: list[dict] = []
        for base, members in sorted(families.items()):
            avail = [e for e in members if e[0] not in grouped_keys]
            if len(avail) < 3:
                continue
            # One qualified name can span several visual columns (the 11622's
            # EDIPI[*] covers both the PFT and CFT tables), so cluster the
            # family by left edge first; each aligned cluster is a column
            # candidate in its own right.
            clusters: list[list] = []
            for e in sorted(avail, key=lambda e: e[1]["left"]):
                if clusters and abs(e[1]["left"] - clusters[-1][-1][1]["left"]) <= 1.0:
                    clusters[-1].append(e)
                else:
                    clusters.append([e])
            for cluster in clusters:
                if len(cluster) < 3:
                    continue
                # LiveCycle instance indices are NOT visual order (the 11622
                # puts instance 0 at the table top and appends 1..29 bottom-
                # up), so row order comes from geometry: sort by top.
                entries = sorted(cluster, key=lambda e: -e[1]["top"])
                if any(e[0] in grouped_keys for e in entries):
                    continue
                tops = [e[1]["top"] for e in entries]
                diffs = [tops[i] - tops[i + 1] for i in range(len(tops) - 1)]
                if not diffs or max(diffs) - min(diffs) > 1.0 or min(diffs) <= 0:
                    continue  # rows repeat at one constant positive stride
                first_key, first_box = entries[0]
                if base.startswith("suffix:"):
                    col_name = base.split(":", 1)[1]
                else:
                    col_name = camel(orig_names.get(page_name, {}).get(first_key, first_key))
                candidates.append({
                    "name": col_name,
                    "box": first_box,
                    "stride": sum(diffs) / len(diffs),
                    "count": len(entries),
                    "keys": [e[0] for e in entries],
                })
                grouped_keys.update(e[0] for e in entries)
        # One page can hold several independent tables (the 11643 has a
        # 4-row block and a 10-row remarks stack on the same page). A single
        # merged group stamps every column with one shared row count and
        # loses the taller stacks' extra rows, so bucket the candidates into
        # coherent tables first: columns of one table share a row count, a
        # stride, and (nearly) the top edge of row 1. Every bucket becomes
        # its own rowGroup — a one-column bucket is a legitimate vertical
        # stack.
        candidates.sort(key=lambda c: (c["count"], c["box"]["top"]))
        buckets: list[list[dict]] = []
        for c in candidates:
            b = buckets[-1] if buckets else None
            if (
                b
                and b[0]["count"] == c["count"]
                and abs(b[0]["stride"] - c["stride"]) <= 1.5
                and abs(b[0]["box"]["top"] - c["box"]["top"]) <= max(6.0, 0.75 * b[0]["stride"])
            ):
                b.append(c)
            else:
                buckets.append([c])
        for kept in buckets:
            counts = [c["count"] for c in kept]
            columns: dict[str, dict] = {}
            for c in sorted(kept, key=lambda c: c["box"]["left"]):
                col_name = dedupe(c["name"] or "col", col_used)
                columns[col_name] = {
                    "type": c["box"]["type"],
                    "label": c["box"]["description"] or humanize(col_name),
                    "page": int(re.search(r"\d+", page_name).group()),
                    "box": {k: c["box"][k] for k in ("left", "top", "width", "height")},
                }
            row_groups["rows" if len(row_groups) == 0 else f"rows{len(row_groups) + 1}"] = {
                "title": "Rows",
                "page": int(re.search(r"\d+", page_name).group()),
                "count": max(set(counts), key=counts.count),
                "rowStride": round(sum(c["stride"] for c in kept) / len(kept), 2),
                # A roster reads as a spreadsheet; the grid editor is the module
                # for it (src/components/editor/RowGroupGrid.tsx).
                "editor": "grid",
                "columns": columns,
            }

    # Also emit a FormConfig draft (src/types/formConfig.ts) — the file that,
    # once reviewed and renamed form.json, makes the form fillable in the app
    # with zero TypeScript. Sections start as one-per-page; humans regroup.
    form_id = re.sub(r"[^a-z0-9]", "", folder.name.split(" - ")[0].lower())
    all_boxes = {k: b for boxes in draft_pages.values() for k, b in boxes.items()}

    # A section that is mostly checkboxes reads as a checklist, not a stack of
    # labeled fields — tag it so the editor uses the compact checklist module.
    def section_editor(keys: list[str]) -> str | None:
        cbs = sum(1 for k in keys if all_boxes[k]["type"] == "checkbox")
        return "checklist" if len(keys) >= 4 and cbs / len(keys) >= 0.6 else None

    def field_config(key: str, b: dict, page: str) -> dict:
        cfg = {
            "type": b["type"],
            "label": b["description"] or humanize(key),
            "page": int(re.search(r"\d+", page).group()),
            "box": {k: b[k] for k in ("left", "top", "width", "height")},
        }
        if b["type"] == "text" and b["height"] > 30:
            cfg["multiline"] = True
        if b.get("options"):
            cfg["options"] = b["options"]
        if b.get("group"):
            # Slug of the FULL qualified name — radio kids of one group share it,
            # while distinct groups keep distinct parent names. camel() of the
            # last segment alone collapsed every group to one id.
            cfg["group"] = re.sub(r"[^0-9A-Za-z]+", "_", b["group"]).strip("_")
        if b.get("required"):
            cfg["required"] = True
        return cfg

    config = {
        "id": form_id,
        "label": folder.name,
        "directory": folder.name,
        "pages": [p.name for p in page_pdfs],
        "sections": [
            {"title": f"Page {re.search(r'[0-9]+', name).group()}",
             "fields": keys,
             **({"editor": ed} if (ed := section_editor(keys)) else {})}
            for name, boxes in draft_pages.items()
            if (keys := [k for k in boxes if k not in grouped_keys])
        ],
        "fields": {
            key: field_config(key, b, name)
            for name, boxes in draft_pages.items()
            for key, b in boxes.items()
            if key not in grouped_keys
        },
        **({"rowGroups": row_groups} if row_groups else {}),
    }
    (folder / "form.draft.json").write_text(json.dumps(config, indent=2) + "\n")

    sheet = Path(tempfile.mkdtemp()) / "overlay"
    sheet.mkdir()
    for page_no in sorted(fields):
        if page_no > len(page_pdfs):
            continue
        png = io_render(page_pdfs[page_no - 1])
        im = Image.open(png).convert("RGB")
        scale = im.width / page_w
        d = ImageDraw.Draw(im)
        for key, b in draft_pages[f"page{page_no}"].items():
            x0 = b["left"] * scale
            y0 = (page_h - b["top"]) * scale
            d.rectangle([x0, y0, x0 + b["width"] * scale, y0 + b["height"] * scale], outline=(220, 30, 30), width=2)
            d.text((x0 + 2, y0 + 1), key[:22], fill=(180, 20, 20))
        im.save(sheet / f"overlay-page{page_no}.png")

    print(f"[harvest] source: {source} | {total} fields across {len(draft_pages)} page(s)")
    for name, boxes in draft_pages.items():
        print(f"  {name}: {len(boxes)} fields")
    for w in warnings:
        print(f"  WARN: {w}")
    print(f"[harvest] draft:   {out}")
    print(f"[harvest] overlay: {sheet}/  — verify every box sits on its blank before promoting")


def io_render(page_pdf: Path) -> Path:
    """Render a template page to PNG at 100dpi (cached per temp run)."""
    out = Path(tempfile.gettempdir()) / f"harvest-{page_pdf.parent.name}-{page_pdf.stem}"
    png = out.with_suffix(".png")
    if not png.exists():
        subprocess.run(
            ["pdftoppm", "-png", "-r", "100", "-singlefile", str(page_pdf), str(out)],
            check=True, capture_output=True,
        )
    return png


if __name__ == "__main__":
    main()
