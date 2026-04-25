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
   - Adobe Acrobat Pro: Print to PDF or use "Flatten Form Fields"
   - Online tools: Various PDF flattening services (ensure no sensitive data)
   - Command line: `pdftk input.pdf output output.pdf flatten`

---

## Adding New Form Templates

1. **Obtain the official form** from https://forms.documentservices.dla.mil

2. **Flatten the PDF** to remove XFA encoding:
   ```bash
   pdftk official_form.pdf output flattened_form.pdf flatten
   ```

3. **Extract box boundaries** using the provided script:
   ```bash
   pip install pdfplumber
   python scripts/extract-pdf-boxes.py public/templates/your_form.pdf --save-image
   ```

4. **Review the annotated image** to verify detected boxes

5. **Create a generator** in `src/services/pdf/` using the smart box positioning system:
   ```typescript
   import { calculateTextPosition, type BoxBoundary } from './extractFormFields';

   const BOX_PADDING = { left: 3, top: 3 };

   const PAGE_BOXES: Record<string, BoxBoundary> = {
     fieldName: { name: 'fieldName', left: 100, top: 500, width: 200, height: 30 },
     // ... boxes from extract script
   };

   function getFieldPosition(boxName: keyof typeof PAGE_BOXES) {
     return calculateTextPosition(PAGE_BOXES[boxName], BOX_PADDING, FONT_SIZE);
   }
   ```

---

## Visual Box Editor (Recommended)

The easiest way to define box coordinates is with the visual editor:

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

## Box Detection Script (Alternative)

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

## JSON Box Configuration

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
