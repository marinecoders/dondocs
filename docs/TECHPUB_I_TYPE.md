# I-Type technical publications — build plan

Scoping notes for the first MIL-STD-38784C document type, from the templates
MARCORSYSCOM sent. Branch: `feat/techpub-i-type`, local only.

Status: **planned, nothing built.** Written against a full read of
`1. I-Type Template.docx` and MIL-STD-38784C.

---

## What an I-Type is

"Instructional-Type" — how the Marine Corps pushes a change out to fielded
equipment. Four flavors share one template: **MI** (Modification), **SI**
(Supply), **TI** (Technical), **LI** (Lubrication) Instruction.

A TM tells you how to operate and maintain equipment. An I-Type tells you to
*change* it, by a date, and record that you did. It carries a Time Compliance
Period — URGENT requires a completion date under one year, NORMAL defaults to
one year — which makes it a directive, not reference material.

It is the smallest **complete** publication in the set: a cover page is a
fragment, an SL-3 is a parts catalogue whose value is data we do not have, and a
full TM is hundreds of pages.

## Why this is worth generating

The template ships with roughly forty lines of instructions telling the author
what not to break: *do not change paragraph titles · do not change the height or
width of cells · ensure two blank lines remain between the paragraph and
OFFICIAL · ensure four blank lines between OFFICIAL and the printed name · after
removing a page break add one above the heading so it stays with its content ·
paragraph numbers must be bold when using automatic numbering.*

Every one of those is a manual rule that a generator makes structurally
impossible to violate. That is the pitch, and it is stronger than "saves typing".

## Output is PDF, not DOCX

The `.docx` files are MARCORSYSCOM's *authoring* tool. The standard names two
delivery mediums — paper and PDF (§3.2.22, §4.1) — and Word is not among them.

PDF is also the easier target, because the paper-only rules drop away:

> §4.7.4.1.2 PDF output: "Blank page numbers shall not be assigned as there
> shall be no blank pages."

That removes the `7/(8 blank)` pagination rule, volumes, binding edges,
left/right-hand pages and foldout aprons (all §3.2.22.1). What PDF adds —
hyperlinked cross-references (§4.5), bookmarks (§4.10) — is native LaTeX.

**Open question for MARCORSYSCOM:** is the authenticated deliverable a PDF, with
Word only the drafting/review (RDC) medium?

**Conflict to resolve:** MIL-STD PDF output puts page numbers bold at lower
right (§4.7.2.2.1); the Marine Corps template says centered in the footer, Times
New Roman 12. The template is the customer's own implementation, so it likely
wins, but ask.

---

## How this codebase already builds a document type

A new document type is an established pattern here, not new architecture:

| Piece | Where |
|---|---|
| Type registration | `DOC_TYPE_CONFIG` / `DOC_TYPE_LABELS` / `DOC_TYPE_CHIP` in `src/types/document.ts` |
| Format module | `tex/templates/<doc_type>.tex` — 20 exist, ~120–150 lines each |
| Shared preamble | `tex/main.tex` — already loads `fancyhdr`, `hyperref`, `tabularx`, `array`, `graphicx`, `enumitem` |
| Generated content | `src/services/latex/generator.ts` emits named `.tex` files that `main.tex` `\input`s |
| Editor panels | `getEditorSections(config, docType)` in `src/components/layout/editorSections.tsx` |

### Reuse — use these, do not rewrite them

| Need | Existing |
|---|---|
| CUI banners top and bottom | `generateClassificationTex()` + `tex/classification.tex` |
| Signature / authentication block | `generateSignatoryTex()` |
| References, enclosures | `generateReferencesTex()`, `generateEnclosuresTex()` |
| Paragraph numbering | `calculateLabels()` |
| Underlined paragraph headings | `underlineWords()`, `toTitleCase()` |
| PDF bookmarks and links | `hyperref`, already in `main.tex` |
| Tables | `tabularx` / `array`, already in `main.tex` |
| Date entry, selects, inputs | existing `ui/` primitives |

The cover dropdowns (Service, Entity, Address, Publication Type, Signing
Authority, Controlling Office) are shared verbatim with the standalone TM/IETM
cover template, so building them here serves that document too.

---

## The document, accurately

### Cover page

Fixed 2×2 inch Marine Corps seal. **Nomenclature: max two lines. Long Title: max
four lines, all caps, centred, no acronyms** — both are validation rules, not
hints. Short Title right aligned; Date left aligned and set to the **last working
day of the anticipated month**.

**End Item table** — `NSN · TAMCN · ID · MODEL`, defaulted to exactly six rows,
unused rows kept. Seven or more items switches the cell to "See Next Page" and
moves the whole list to the back of the cover page. That conditional overflow
page is a real branch.

Header/footer carry: CUI markings, Short Title, Date, Publication Type, the CUI
Designation Indicator box (Times New Roman 10), an optional Supersedure Notice,
the Distribution Statement (per DoDI 5230.24), an optional export-control
**WARNING** (Arms Export Control Act — inserted between the Distribution
Statement and the Destruction Notice with one blank line above and below), the
Destruction Notice (never altered), and the **PCN in the footer of page one
only**.

### Distribution Statement drives the CUI label

Table 1 of the template is a lookup, and it is a derivation rule worth encoding:

| Distribution Statement | Sensitivity Label |
|---|---|
| A — Approved for Public Release | Uncontrolled / General |
| B, C, D, E, F | Controlled / CUI |

The template warns that the wrong label breaks document transmission, since the
label drives encryption in Word metadata. In our PDF path that specific failure
does not exist, but the *marking* must still be right, and deriving it beats
asking twice.

### Body — a fixed, ordered list of optional paragraphs

This is the core insight my first pass missed. The titles are **canonical and
must not be changed**; paragraphs that do not apply are **removed**; numbering
renumbers around the gaps. That is an include/omit model with a fixed
vocabulary, which is exactly what a generator is good at.

| # | Paragraph | Shape |
|---|---|---|
| 1 | Purpose | prose; applicability folded in |
| 2 | Administrative Instructions | prose, optional |
| 3 | Time Compliance Period | prose + **validation** |
| 4 | Information | prose |
| 5 | Technical Manuals Affected | **sentence format — explicitly not a table** |
| 6 | Major Items Affected | table: `Description · NSN · TAMCN · I.D. No.` |
| 7 | Components Affected | table: `Item · Description · NSN · PN` |
| 8 | Materiel Affected | **four** tables: Required / Discarded / Retained / Bulk and Consumable |
| 9 | Special Tools, Jigs and Fixtures | **two** tables: Special Tools / Jigs and Fixtures |
| 10 | Special Instructions | prose, optional |
| 11 | Supply Action | prose, optional |
| 12 | Skill and Time Required | prose; MOS and hours, per NAVMC 1008-A |
| 13 | Procedures | steps — MIL-STD-38784 layout |
| 14 | Procedures | steps — MIL-STD-40051 layout (alternative to 13) |

So the body carries **about nine tables**, not two. Most share one shape
(`Item · Description · NSN · PN · Qty`), which means one table component with a
column set, not nine components.

### Nested "Consisting of" inventory

Parts tables nest, with exact typography:

| Level | Indent | Hanging |
|---|---|---|
| Parent item | 0″ | 0.1″ |
| First level c/o | 0.1″ | 0.18″ |
| Second level c/o | 0.28″ | 0.18″ |

Rules: "Consisting of" items must start on the same page as their parent, may
continue to the next inventory sheet, and the parent must never be the last item
on a sheet. If item numbers are unused, the column is removed entirely.

### WARNING / CAUTION / NOTE

Precise, and shared by every publication in the family:

- **WARNING** — risk of long-term health hazard, injury or death. **Entirely
  uppercase.** Header uppercase and bold, body text not bold. Four required
  parts: icon, concise hazard statement, minimum precautions, and possible
  results if disregarded (unless obvious). A hazardous-material icon is required
  when hazardous materials are involved.
- **CAUTION** — risk of damage to equipment or loss of mission effectiveness.
  Header uppercase bold, text sentence case. Same four-part structure.
- **NOTE** — essential information. Header uppercase bold, text sentence case.
  May precede or follow what it refers to.

All three: margins **0.25″ both sides**, left justified, **centred if a single
line**. WARNINGs and CAUTIONs **must never fall at the bottom of a page** —
that is a page-breaking constraint, not a style preference, and it is the one
typographic requirement here that needs real thought in LaTeX.

### Procedures

Steps are **blocked text** — carry-over lines start under the first letter of
the step, the opposite of every other paragraph, which returns to the left
margin. §4.7.11.5.3 caps nesting at **four levels**, requires at least two of
each subdivision (a step a. needs a step b.), and gives steps no titles. The
five levels the MARCORSYSCOM template shows belong to its MIL-STD-40051
example, which is the other standard.

The MIL-STD-40051 variant instead opens with a structured **INITIAL SETUP**
block — Test Equipment, Tools, Special Tools, Material/Parts, Mandatory
Replacement Parts, Personnel Required, References, Equipment Condition, Special
Environmental Conditions, Drawings Required, Time to Complete — then the
maintenance task, then steps, closing with **END OF TASK** and **END OF WORK
PACKAGE**. Choosing 40051 also switches the font to Arial 11.

### Signature page

Fixed authentication sentence, safety reporting boilerplate (MCO 5100.34 routing
and MCO 5100.29 hazard reports), the TDM-Publications portal block, an
MI-only Recording Instruction paragraph, then OFFICIAL / name / signing
authority / controlling office / DISTRIBUTION. Spacing is mandated: **two blank
lines** before OFFICIAL, **four** between OFFICIAL and the printed name, **two**
between the organisation title and DISTRIBUTION.

I-Types **must be digitally signed**.

### Appendices and enclosures

Appendices paginate `A-1`, with short title and date centred in the header.
Modelled as an **Appendix** block kind on the paragraph editor: the heading is
the title, pages number `A-1`, `A-2`, and paragraph numbers restart.
Enclosures put "Enclosure 1" in the footer above the page number. Both follow
MIL-DTL-28999 for examples.

### Other rules worth encoding

- Body paragraphs from 1 onward: **12pt above and below**.
- Paragraph numbers are **bold**.
- NSN dash formatting is optional but must be **consistent throughout** — a
  document-level validation.
- When a table has no NSN, the CAGE code goes under PN.

---

## The dependency that shapes sequencing

The repeating-row grid editor (`RowGroupGrid`) and the whole config-form system
are **uncommitted work on `feat/issue-28-letter-templates`; none of it is on
`main`**, so this branch cannot import it.

That is mostly fine — the two are less alike than they look. Config-form rows
are overlaid onto a scanned PDF with `pdf-lib`; I-Type tables are `tabularx` in
LaTeX. They share the idea of typing rows into a grid and nothing else.

So: **do not duplicate `RowGroupGrid`, and do not block on issue-28.** Build one
table component here, driven by a column set, and reuse it across all nine
tables. When issue-28 lands and there are two real callers, extract the shared
grid then — that is when the repo's "no abstractions for a single caller" rule
is actually satisfied.

## Phases

**1 — Skeleton.** Register the doc type, add `tex/templates/i_type.tex`, wire
`getEditorSections`. Cover + signature page, reusing the existing classification
and signatory generators. Proves the pattern end to end.

**2 — Paragraph model.** The fixed ordered list with include/omit and
renumbering; Time Compliance validation; the Distribution → CUI label
derivation.

**3 — Tables.** One table component with a column set, serving all nine, plus
the nested "consisting of" indentation and the End Item overflow page.

**4 — Safety callouts.** WARNING / CAUTION / NOTE environments, including
single-line centring and the never-at-page-bottom constraint.

**5 — Procedures.** Blocked text, four nesting levels, MIL-STD-38784 layout.

Ship MI first. SI/TI/LI are the same skeleton — the Recording Instruction is
MI-only — so they are configuration, not new work.

## Deliberately not in scope

- **LEP, TOC, List of Illustrations, List of Tables** — the real prize, largely
  free in LaTeX, but they belong to the TM. Next slice.
- **MIL-STD-40051 procedure layout**, including the INITIAL SETUP block and the
  Arial 11 switch. Pick 38784 for v1; supporting both is a real fork.
- **SI / TI / LI**, until MI is proven. **The SL family and full TMs.**

## Verification

Prove it by rendering a PDF, not by asserting on generated LaTeX. A
compile-matrix entry for the new type, and a real compile checked for the things
that actually matter: CUI markings top and bottom, the derived sensitivity label
matching the Distribution Statement, the authentication paragraph, the End Item
table at six rows, a WARNING rendered uppercase with all four parts and not at a
page bottom, and paragraph renumbering after an omitted optional paragraph.
