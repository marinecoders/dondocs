# Form templates

Generic static forms use a reviewed v2 definition plus immutable PDF page assets.
See [the model and its limits](FORM_MODEL_ANALYSIS.md) and the generated
[JSON Schema](form-definition.schema.json). The two built-in forms keep their
existing implementation, documented below.

## Prepare an official source

Use the official [DoD forms catalog](https://forms.documentservices.dla.mil) or
[Navy Forms Online](https://www.mynavyhr.navy.mil/References/Forms/). Install the
Node dependencies (`npm ci`), Python `pypdf` and `Pillow`, and `qpdf`/Poppler. The optional legacy `extract-pdf-boxes.py` tool additionally imports `pdfplumber`.

The acquisition command defaults to a dry run. Add `--yes` to fetch, flatten,
harvest and prepare candidates. It does not publish them.

```bash
scripts/acquire-form.sh "NAVMC 11675"
scripts/acquire-form.sh --active --family NAVMC --limit 20
```

For a downloaded source:

```bash
scripts/import-navmc.sh /path/to/official.pdf "NUMBER - Title"
python3 scripts/harvest-fields.py /path/to/official.pdf "NUMBER - Title"
npm run form-package -- prepare "NUMBER - Title"
```

Flattening removes interactive layers and writes one PDF per page. The source
and flattened page hashes are recorded in `.source.json`. Harvest the original
PDF against those exact pages. A changed source or page requires flattening again.
AcroForm widget geometry is preferred; the limited positioned-XFA fallback
rejects scripts, calculations and flowed layout. Pure dynamic XFA placeholders
are refused and recorded in `docs/xfa-manual-queue.tsv` for manual handling.

Preparation writes `form.candidate.json`, `changes.json` and
`placement-report.json`, alongside `extraction.json` and the draft files.
`promote_form.py` is a compatibility wrapper for **prepare** only. Reharvesting
creates a new candidate; it never overwrites a published revision or preserves
editorial decisions by guessing. Compare the proposed changes and carry forward
reviewed labels, groups and rules deliberately.

## Review and publish

1. Compare the extraction overlays with the official blank, including every page
   and the first/last roster row. Review the recorded omissions and warnings.
2. Edit `form.candidate.json`: labels, semantic IDs, sections, choice values,
   required stages, geometry, print formats and overflow policies. Do not edit
   published revision folders.
3. Run `npm run form-package -- check "NUMBER - Title"` after editing. Compare
   the generated `review-fill-*.pdf` files with the source. Automated bounds checks test that
   output lands inside the declared boxes; they cannot establish that those boxes
   represent the correct official blanks.
4. Record the review and publish:

```bash
npm run form-package -- review "NUMBER - Title" \
  --reviewer "Maintainer name" --notes "Source revision and checks performed"
# Add --accept-warnings only after examining the extraction warnings.
npm run form-package -- publish "NUMBER - Title"
```

Review reruns all placement checks on the edited candidate. Publication checks
the review digest, copies the complete package into `revisions/<digest>/`, and
atomically updates the catalog. Changing the candidate or evidence invalidates
the review. Only published generic forms appear in the editor's catalog.

To stop new use while retaining saved instances:

```bash
npm run form-package -- retire "NUMBER - Title"
```

Keep old revision assets in the deployment. Drafts pin their definitions and
page checksums; replacing an asset in place makes verification fail.

## Verification commands

```bash
npm run form-package -- validate public/templates/"NUMBER - Title"/form.candidate.json
npm run form-package -- schema docs/form-definition.schema.json
npm run form-coverage
npm run test:integration -- tests/integration/form-definition-render.test.ts tests/integration/form-publication.test.ts
for test in scripts/test-*.py; do python3 "$test" || exit 1; done
```

`form-coverage` checks all published generic packages and exits unsuccessfully
when there is nothing to measure or a placement fails. It exercises every row
and choice option. `stamp-quality` is an alias for this check; it no longer marks
catalog entries verified. Keep review evidence separate from automated metrics.

## Revision updates

Use **Apply revision update** in the editor with a JSON file of this shape:

```json
{
  "definition": "<complete new v2 definition object>",
  "migration": {
    "from": "old-definition-digest",
    "to": "new-definition-digest",
    "fields": { "oldName": "name", "decision": "decision" },
    "options": { "decision": { "oldYes": "yes", "oldNo": "no" } },
    "rowGroups": {
      "oldRoster": { "to": "roster", "columns": { "oldGrade": "grade" } }
    }
  }
}
```

Replace the illustrative `definition` string with the actual published object.
Every stored answer and populated row group needs a mapping, including unchanged
IDs. Updates open as a new copy after confirmation. Missing mappings, invalid
options or a smaller roster fail without changing the original.

## The legacy path — for the two hand-built forms only

NAVMC 10274 and NAVMC 118(11) predate config-driven forms. Their geometry lives
in `boxes.json` plus a generator in `src/services/pdf/`, and the import pipeline
above deliberately refuses to touch them (a `boxes.json` in the folder). **Do not use this path for a new form** — it exists
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
python3 scripts/extract-pdf-boxes.py template.pdf

# Save annotated image showing detected boxes
python3 scripts/extract-pdf-boxes.py template.pdf --save-image

# Adjust detection sensitivity
python3 scripts/extract-pdf-boxes.py template.pdf --min-size 5 --max-size 300

# Interactive mode for manual box definition
python3 scripts/extract-pdf-boxes.py template.pdf --interactive

# Save detected boxes as JSON config for manual editing
python3 scripts/extract-pdf-boxes.py template.pdf --save-config

# Load boxes from a JSON config file
python3 scripts/extract-pdf-boxes.py --config "public/templates/NAVMC11811 - Administrative Remarks/boxes.json"
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
- `public/templates/NAVMC11811 - Administrative Remarks/boxes.json` - NAVMC 118(11) Administrative Remarks
- `public/templates/NAVMC10274 - Administrative Action/boxes.json` - NAVMC 10274 Administrative Action

**Maintaining the two existing built-in forms:**
1. Run auto-detection: `python3 scripts/extract-pdf-boxes.py template.pdf --save-config`
2. Edit the generated `template.boxes.json` to fix field names and coordinates
3. Verify with: `python3 scripts/extract-pdf-boxes.py --config template.boxes.json`
4. Copy the TypeScript output into your generator file

---

The developer box editor loads pdf.js and its worker from cdnjs. It needs network access unless you stage and point it to local copies. This optional developer tool is outside the built application's no-CDN guard. Install `pdfplumber` for the legacy extractor (`python3 -m pip install pdfplumber`).

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

## Geometry gate

Run `npm run test:form-geometry` before publishing template changes. It checks
published `form.json` definitions against the actual single-page PDF assets,
including every repeated-row placement and irregular row override. A box uses
bottom-left coordinates: its vertical range is `top - height` through `top`.
Positive dimensions alone do not prove that a field fits on its page.

Template assets must be flattened to unrotated, zero-origin full pages before
publication. Cropped or rotated sources must go through normalization first;
the renderer refuses an incompatible coordinate space rather than silently
placing an answer in the wrong location. Definition dimensions must match the
actual asset. Geometry is checked even when a field has no answer.

CI rejects new failures and stale entries in `data/form-geometry-baseline.json`.
Its empty inventory describes the current published source tree, which contains
only the two built-in NAVMC template sets and no generic `form.json` files. It is
not a geometry certification of the separate, unmerged form-library corpus.
Passing bounds checks also does not prove alignment with printed labels; retain
rendered placement review when publishing a form.

## Placement rotation

The v2 definition supports optional `rotation: 270` on ordinary and repeated-row text placements. This rotates a placement's text, not the template page. Page/source normalization is a separate import step. Regenerate the [schema](form-definition.schema.json) after model changes; `npm run docs:check` detects schema drift.
