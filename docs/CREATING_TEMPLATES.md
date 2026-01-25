# Creating New Document Templates

This guide explains how to add new content templates to DonDocs.

---

## Overview

DonDocs uses TypeScript template files to define pre-filled document content. When users select a template, the app populates the document with predefined subject lines, paragraphs, and references. You define templates in `src/data/templates/` - no LaTeX knowledge required.

### How It Works

1. You create a TypeScript file defining the template content
2. The template specifies which document format to use (naval letter, MFR, etc.)
3. When a user selects your template, it fills the form with your predefined content
4. The LaTeX backend handles all formatting automatically

---

## Template Structure

Templates are located in `src/data/templates/` organized by category:

```
src/data/templates/
├── types.ts                    # TypeScript interfaces
├── index.ts                    # Exports all templates
├── awards/                     # Award-related templates
│   ├── index.ts
│   ├── meritorious-mast.ts
│   ├── award-nam.ts
│   └── ...
├── personnel/                  # Personnel actions
│   ├── index.ts
│   ├── leave-request.ts
│   └── ...
├── leadership/                 # Counseling, LOIs, etc.
├── endorsements/               # Endorsement templates
├── administrative/             # Administrative templates
├── training/                   # Training-related
├── investigations/             # Investigation templates
├── legal/                      # Legal templates
├── memoranda/                  # MFR templates
└── operations/                 # Operational templates
```

---

## Creating a New Template

### Step 1: Create the Template File

Create a new `.ts` file in the appropriate category folder. Use kebab-case for the filename.

```typescript
// src/data/templates/awards/my-new-template.ts
import type { LetterTemplate } from '../types';

export const myNewTemplate: LetterTemplate = {
  id: 'my-new-template',
  name: 'My New Template',
  category: 'Awards',
  description: 'Brief description of what this template is for',
  docType: 'naval_letter',
  ssic: '1650',
  subject: 'SUBJECT LINE IN ALL CAPS',
  paragraphs: [
    { text: 'First paragraph content.', level: 0 },
    { text: 'Second paragraph content.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO 1234.5' },
  ],
};
```

### Step 2: Export from Category Index

Add your template to the category's `index.ts`:

```typescript
// src/data/templates/awards/index.ts
export { awardNam } from './award-nam';
export { meritoriousMast } from './meritorious-mast';
export { myNewTemplate } from './my-new-template';  // Add this
```

### Step 3: Register in Main Index

Add your template to `src/data/templates/index.ts`:

```typescript
// Import section - add to the appropriate category
import {
  awardNam,
  meritoriousMast,
  myNewTemplate,  // Add this
} from './awards';

// LETTER_TEMPLATES array - add in the appropriate section
export const LETTER_TEMPLATES: LetterTemplate[] = [
  // Awards
  awardNam,
  meritoriousMast,
  myNewTemplate,  // Add this
  // ...
];
```

---

## Template Fields

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (kebab-case, matches filename) |
| `name` | string | Display name shown in template picker |
| `category` | string | Category for grouping (Awards, Personnel, etc.) |
| `description` | string | Brief description of the template's purpose |
| `docType` | string | Document format to use (see below) |
| `subject` | string | Pre-filled subject line |
| `paragraphs` | array | Array of paragraph objects |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `ssic` | string | Default SSIC code |
| `references` | array | Pre-filled references |

### Document Types

The `docType` field determines the document format:

| docType | Description |
|---------|-------------|
| `naval_letter` | Naval Letter (on letterhead) |
| `standard_letter` | Standard Letter (plain paper) |
| `business_letter` | Business Letter |
| `multiple_address_letter` | Multiple Address Letter |
| `joint_letter` | Joint Letter (dual signatures) |
| `same_page_endorsement` | Same-Page Endorsement |
| `new_page_endorsement` | New-Page Endorsement |
| `mfr` | Memorandum for the Record (MFR) |
| `mf` | Memorandum For (USMC format) |
| `plain_paper_memorandum` | Plain Paper Memorandum |
| `letterhead_memorandum` | Letterhead Memorandum |
| `decision_memorandum` | Decision Memorandum |
| `executive_memorandum` | Executive Memorandum |
| `joint_memorandum` | Joint Memorandum (dual signatures) |
| `moa` | Memorandum of Agreement (MOA) |
| `mou` | Memorandum of Understanding (MOU) |
| `executive_correspondence` | Executive Correspondence |

---

## Paragraph Structure

### Basic Paragraphs

```typescript
paragraphs: [
  { text: 'First paragraph at top level.', level: 0 },
  { text: 'Second paragraph at top level.', level: 0 },
]
```

### Nested Paragraphs (Subparagraphs)

Use the `level` field for indentation:
- `level: 0` - Top level (1., 2., 3.)
- `level: 1` - First indent (a., b., c.)
- `level: 2` - Second indent ((1), (2), (3))

```typescript
paragraphs: [
  { text: 'Background. This section provides context.', level: 0 },
  { text: 'First sub-point under background.', level: 1 },
  { text: 'Second sub-point under background.', level: 1 },
  { text: 'Recommendation. Approve this request.', level: 0 },
]
```

### Using Placeholders

Use brackets to indicate fields the user should fill in:

```typescript
paragraphs: [
  { text: 'Recommendation. [RANK FULL NAME, USMC] is recommended for [AWARD NAME].', level: 0 },
  { text: 'Accomplishments. [DESCRIBE SPECIFIC ACCOMPLISHMENTS]', level: 0 },
]
```

---

## References

Add pre-filled references that apply to the template:

```typescript
references: [
  { letter: 'a', title: 'MCO 1650.19J' },
  { letter: 'b', title: 'SECNAV M-5216.5' },
  { letter: 'c', title: 'Local SOP dated 1 Jan 2024', url: 'https://example.com/sop' },
]
```

The `url` field is optional and used for linking to online references.

---

## Example: Complete Template

Here's a complete example of a TAD request template:

```typescript
// src/data/templates/personnel/tad-request.ts
import type { LetterTemplate } from '../types';

export const tadRequest: LetterTemplate = {
  id: 'tad-request',
  name: 'TAD Request',
  category: 'Personnel',
  description: 'Request Temporary Additional Duty orders',
  docType: 'naval_letter',
  ssic: '1320',
  subject: 'REQUEST FOR TEMPORARY ADDITIONAL DUTY (TAD) ORDERS',
  paragraphs: [
    { text: 'Request. Request TAD orders for [RANK NAME] to [DESTINATION COMMAND/LOCATION] from [START DATE] to [END DATE] for [PURPOSE OF TAD].', level: 0 },
    { text: 'Justification. [EXPLAIN WHY THIS TAD IS NECESSARY AND HOW IT SUPPORTS THE MISSION]', level: 0 },
    { text: 'Funding. TAD will be funded by [FUNDING SOURCE/OPTAR LINE].', level: 0 },
    { text: 'Impact. [DESCRIBE IMPACT ON CURRENT DUTIES AND MITIGATION PLAN]', level: 0 },
    { text: 'Point of Contact. The point of contact for this matter is [NAME] at [PHONE/EMAIL].', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'JTR' },
    { letter: 'b', title: 'MCO 4650.39A' },
  ],
};
```

---

## Adding a New Category

Categories are **auto-discovered** from the `category` field in templates. When you use a new category name, it automatically appears in the template picker UI.

To add a new category:

1. Create the category folder:
   ```
   src/data/templates/newcategory/
   ```

2. Create your template file with the new category name:
   ```typescript
   // src/data/templates/newcategory/my-template.ts
   export const myTemplate: LetterTemplate = {
     id: 'my-template',
     category: 'New Category',  // This creates the category
     // ...
   };
   ```

3. Create an `index.ts` to export templates:
   ```typescript
   // src/data/templates/newcategory/index.ts
   export { myTemplate } from './my-template';
   ```

4. Import in main index:
   ```typescript
   // src/data/templates/index.ts
   import { myTemplate } from './newcategory';

   export const LETTER_TEMPLATES: LetterTemplate[] = [
     // ...existing templates
     myTemplate,
   ];
   ```

The template picker UI will automatically show the new category as a filter badge.

---

## Testing Your Template

1. Start the dev server: `npm run dev`
2. Open the template picker (Templates button)
3. Find your template in the appropriate category
4. Select it and verify:
   - Correct document type is selected
   - Subject line is populated
   - Paragraphs appear correctly
   - References are listed
   - SSIC is filled (if specified)
5. Generate a PDF to verify formatting

---

## Tips

- **Keep subjects concise** - They appear in the PDF header
- **Use standard placeholders** - `[RANK NAME]`, `[DATE]`, `[COMMAND]` are common conventions
- **Include relevant references** - Users can remove what they don't need
- **Test with the PDF preview** - Ensure your content looks correct when rendered
- **Follow existing patterns** - Look at similar templates for guidance

---

## Advanced: LaTeX Document Formats

The document formats (naval letter, MFR, etc.) are defined in LaTeX files under `tex/templates/`. These control how documents are rendered - things like date placement, signature blocks, and page layouts.

Creating new document *formats* requires LaTeX knowledge and is a more advanced topic. If you need a new format:

1. Check if an existing format can be adapted
2. Review the existing LaTeX templates in `tex/templates/`
3. See `src/lib/latex-templates.js` for how formats are loaded
4. Open an issue to discuss the new format before implementing

Most contributors will only need to create content templates as described in this guide.

---

## Questions?

- Check existing templates in `src/data/templates/` for examples
- Open an issue on GitHub if you need help
