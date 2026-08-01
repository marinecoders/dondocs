# Form Templates

DonDocs supports official military forms (NAVMC 10274, NAVMC 118(11), etc.) by overlaying text onto official PDF templates. This document covers how to add a new form template.

---

## Official Form Sources

**All form templates must be obtained from official sources:**

- **DoD Forms Management Program**: https://forms.documentservices.dla.mil
- **Navy Forms Online**: https://www.mynavyhr.navy.mil/References/Forms/

> ⚠️ **Important**: Do not create new form templates from scratch. Only official, pre-approved forms should be used to ensure compliance with regulations.

---

## XFA Forms and Flattening

Official military PDF forms are typically encoded using **XFA (XML Forms Architecture)**, an Adobe technology for dynamic forms. XFA forms have special characteristics:

- They contain embedded XML data structures
- They support dynamic form features (calculations, validations)
- They are **not compatible** with most PDF libraries (including pdf-lib)

**Before using a form template, it must be "flattened":**

1. **What is flattening?** Converting dynamic XFA form elements into static PDF content (text, lines, rectangles)
2. **Why flatten?** pdf-lib and most JavaScript PDF libraries cannot read or modify XFA content
3. **How to flatten?**
   - Command line (verified on the NAVMC XFA hybrids — poppler, `brew install poppler`):
     ```bash
     pdftocairo -pdf official_form.pdf flat.pdf   # strips XFA/AcroForm, keeps vector text
     pdfseparate flat.pdf page%d.pdf              # one file per page, as the registry expects
     ```
     Verify with `pdfinfo page1.pdf` — it must report `Form: none`.
   - Adobe Acrobat Pro: Print to PDF or use "Flatten Form Fields" (the Jan 2026
     10274/11811 pages were made this way; either pipeline is acceptable)
   - **Do NOT use `pdftk ... flatten` for these forms** — it only flattens
     AcroForm appearances and passes the XFA layer through untouched
     (`pdfinfo` still reports `Form: XFA`), which pdf-lib can't consume.

---

## Adding New Form Templates

**The short way.** `scripts/acquire-form.sh` runs every step below for you,
straight from the DON Forms registry. It defaults to a dry run; add `--yes` to
import.

```bash
scripts/acquire-form.sh "NAVMC 11675"          # one form, by number
scripts/acquire-form.sh --active --family NAVMC # every Active NAVMC
scripts/acquire-form.sh --active --limit 20     # a trial slice, any family
```

`--active` pages through the registry's whole catalog — an empty `SearchQuery`
returns all 13,859 rows — and keeps every Active form, so **no list of forms is
kept in the repo**: the importable set is derived on each run. Of ~10,000 Active
rows, about 9,600 are distinct importable forms across 449 families; the rest
are dropped and counted in the summary:

| dropped | why |
|---|---|
| ~113 | no digit in the number — the registry has 39 rows named `LITHO`, plus `N/A` and blanks |
| ~61 | the number or title says `***CANCELLED BY USMC***` / `***INACTIVE***` while `status` still claims Active |
| ~12 | no title at all — rerun with `--folder "NUMBER - Real Title"`, reading the name off the page |

Because the set is derived, the count drifts as forms are cancelled and added,
and whether a form survives the flattener is only knowable by trying it. Expect
*about* that many, not exactly. Dynamic-XFA refusals are appended to
`docs/xfa-manual-queue.tsv` rather than lost.

Folder and id derivation is shared by both front doors in
`scripts/form-names.py`, tested by `scripts/test-form-names.py` against the
shapes the registry really contains — titles with `/` in them (1,224 of them,
which would otherwise create a nested directory), titles that are HTML, numbers
with stray whitespace, revision stamps that must not fragment one form into
several catalog rows, and `NAVMC 118(11)`, whose number really does end in
parentheses.

To do it by hand instead:

1. **Obtain the official form** from https://forms.documentservices.dla.mil

2. **Flatten and register it**, headless, with one command. It lifts the
   owner-password, flattens, splits into per-page files, names the form from its
   own pages, and adds its row to `public/templates/index.json`. It **refuses if
   the form is pure dynamic XFA** (see the trap below) so a placeholder can never
   be staged:
   ```bash
   scripts/import-navmc.sh ~/Desktop/"NAVMC 11621 (EF).pdf"
   ```
   It says so when it had to guess the number rather than read it off a
   `NAVMC …` footer. A guess usually means you should pass the registry's own
   string as argument 4 (`"" "" "OPNAV 1650/3"`) or the folder name outright as
   argument 2 — left alone, a guessed number becomes the folder name.

   Registering is not optional: step 5 refuses to promote a form that has no
   catalog row, because a `form.json` with no row is a folder nothing can reach.
   `scripts/flatten-navmc-form.sh` is the flatten-only piece this calls, useful
   on its own for making template pages out of a print-only PDF, but it does not
   register anything. The rawest form of all, for reference:
   ```bash
   pdftocairo -pdf official_form.pdf flat.pdf && pdfseparate flat.pdf page%d.pdf
   ```

   **The pure-XFA trap.** Some NAVMCs (e.g. 11296 Request Mast) are *pure
   dynamic XFA* — `Form: XFA`, one page, zero AcroForm fields. Their static
   layer is only Adobe's "Please wait…" placeholder; poppler renders that, not
   the form. `flatten-navmc-form.sh` detects it and exits 3. Flatten these in
   Acrobat: open the decrypted copy (`qpdf --decrypt in.pdf out.pdf`), then
   **File > Print > "Save as PDF"** (Print, not "Save As > PostScript" — the
   latter often skips the XFA render), then `pdfseparate` the result.

3. **Harvest the field boxes** from the ORIGINAL (EF) PDF — not the flattened
   pages — into a reviewable draft:
   ```bash
   python3 scripts/harvest-fields.py ~/Desktop/"NAVMC 10132 (EF).pdf" \
     "NAVMC10132 - Unit Punishment Book"
   ```
   It reads AcroForm widget rectangles when present (exact — every NAVMC tested
   so far has them) and falls back to computing geometry from the XFA template
   XML. It writes two files into the template folder: `boxes.draft.json`, a flat
   list of every box for reading, and `form.draft.json`, the config the app will
   actually load. Plus overlay PNGs of the boxes drawn on their own pages.

   It refuses outright when page 1 of the source is a different size from page 1
   of the committed template — different revisions produce silently-wrong
   coordinates — and warns when a later page disagrees, since a genuine
   mixed-size form exists. Anything it drops or cannot place is a `WARN:` line
   that `import-batch.sh` counts, never a silent omission.

4. **Review the overlays.** Every harvested box is drawn on the page it belongs
   to, at that page's own size. Check that each one sits on its blank before you
   trust the form; this is the step the whole pipeline is built around.

5. **Promote the draft** to the live config and flip the catalog row:
   ```bash
   python3 scripts/promote_form.py "NAVMC10132 - Unit Punishment Book"
   ```
   That writes `form.json` — **and there is no step 6.** No TypeScript, no
   generator, no registry edit: the form is fillable, previewable and
   exportable from that file alone.

   Rename keys to semantic names and correct labels directly in `form.json`.
   Those edits are safe: re-running the harvester later (`REHARVEST=1
   scripts/import-batch.sh …`) takes only `box` and `page` from the fresh draft
   and leaves every label, `required`, `options` and section arrangement alone.
   A field the new harvest no longer sees is kept and warned about, not deleted.
   To start over from scratch, delete `form.json` and import again.

---

## The legacy path — for the two hand-built forms only

NAVMC 10274 and NAVMC 118(11) predate config-driven forms. Their geometry lives
in `boxes.json` plus a generator in `src/services/pdf/`, and the import pipeline
above deliberately refuses to touch them (`verified: true` in the catalog, and a
`boxes.json` in the folder). **Do not use this path for a new form** — it exists
so those two keep working, and everything below documents them.

### Visual box editor

The easiest way to define box coordinates by hand:

```bash
# Open in browser
open tools/box-editor.html
```

1. Load your PDF template
2. Click "Draw Mode" and drag to create boxes
3. Name each box (e.g., `name`, `edipi`, `remarks`)
4. Copy the TypeScript code or export as JSON

This is a one-time setup per form template.

---

### Writing the generator

With the boxes in hand, a legacy form gets a generator in `src/services/pdf/`:

```typescript
import { calculateTextPosition, type BoxBoundary } from './extractFormFields';

const BOX_PADDING = { left: 3, top: 3 };

const PAGE_BOXES: Record<string, BoxBoundary> = {
  fieldName: { name: 'fieldName', left: 100, top: 500, width: 200, height: 30 },
};

function getFieldPosition(boxName: keyof typeof PAGE_BOXES) {
  return calculateTextPosition(PAGE_BOXES[boxName], BOX_PADDING, FONT_SIZE);
}
```

### Box detection script

The `scripts/extract-pdf-boxes.py` script can auto-detect boxes, but works best for forms with clear rectangles:

```bash
# Basic usage - auto-detect boxes
python scripts/extract-pdf-boxes.py template.pdf

# Save annotated image showing detected boxes
python scripts/extract-pdf-boxes.py template.pdf --save-image

# Adjust detection sensitivity
python scripts/extract-pdf-boxes.py template.pdf --min-size 5 --max-size 300

# Interactive mode for manual box definition
python scripts/extract-pdf-boxes.py template.pdf --interactive

# Save detected boxes as JSON config for manual editing
python scripts/extract-pdf-boxes.py template.pdf --save-config

# Load boxes from a JSON config file
python scripts/extract-pdf-boxes.py --config public/templates/NAVMC118.boxes.json
```

**Output includes:**
- Visual ASCII map of detected boxes
- JSON data with coordinates
- TypeScript code ready to paste into generators

---

### JSON box configuration

For forms where auto-detection doesn't work well (forms drawn with lines instead of rectangles), use a JSON config file:

```json
{
  "template": "NAVMC118_template.pdf",
  "description": "NAVMC 118(11) Administrative Remarks",
  "pageSize": { "width": 612, "height": 792 },
  "boxes": {
    "name": {
      "left": 148,
      "top": 142,
      "width": 206,
      "height": 16,
      "description": "Marine's name (LAST, FIRST MI)"
    },
    "edipi": {
      "left": 465,
      "top": 142,
      "width": 106,
      "height": 16,
      "description": "DOD ID Number / EDIPI"
    }
  }
}
```

**Existing configs:**
- `public/templates/NAVMC118.boxes.json` - NAVMC 118(11) Administrative Remarks
- `public/templates/NAVMC10274.boxes.json` - NAVMC 10274 Administrative Action

**Workflow for new forms:**
1. Run auto-detection: `python scripts/extract-pdf-boxes.py template.pdf --save-config`
2. Edit the generated `template.boxes.json` to fix field names and coordinates
3. Verify with: `python scripts/extract-pdf-boxes.py --config template.boxes.json`
4. Copy the TypeScript output into your generator file

---

## PDF Coordinate System

Understanding PDF coordinates is essential for accurate form filling:

- **Origin**: Bottom-left corner of the page (0, 0)
- **X-axis**: Increases to the right
- **Y-axis**: Increases upward
- **Units**: Points (72 points = 1 inch)
- **Letter size**: 612 × 792 points

```
(0, 792) -------- (612, 792)  ← Top of page
    |                |
    |                |
    |                |
(0, 0) ---------- (612, 0)    ← Bottom of page
```
