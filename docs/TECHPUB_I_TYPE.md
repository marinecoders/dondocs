# I-Type technical publications — build plan

Scoping notes for the first MIL-STD-38784C document type, from the templates
MARCORSYSCOM sent. Branch: `feat/techpub-i-type`, local only.

Status: **planned, nothing built**.

---

## What an I-Type is

"Instructional-Type" — how the Marine Corps pushes a change out to fielded
equipment. Four flavors share one template: **MI** (Modification), **SI**
(Supply), **TI** (Technical), **LI** (Lubrication) Instruction.

Unlike a TM, which tells you how to operate and maintain equipment, an I-Type
tells you to *change* it, by a date, and record that you did. It carries a Time
Compliance Period — URGENT requires a completion date under one year, NORMAL
defaults to one year — which makes it a directive, not reference material.

It is the smallest **complete** publication in the set. A cover page is a
fragment; an SL-3 is a parts catalogue whose value is in data we do not have; a
full TM is hundreds of pages. An MI is a whole document someone executes.

## Output is PDF, not DOCX

The `.docx` files we were given are MARCORSYSCOM's *authoring* tool. The
standard names two delivery mediums — paper and PDF (§3.2.22, §4.1) — and Word
is not among them.

PDF is also the easier target, because the paper-only rules drop away:

> §4.7.4.1.2 PDF output: "Blank page numbers shall not be assigned as there
> shall be no blank pages."

That removes the `7/(8 blank)` pagination rule, volumes, binding edges,
left/right-hand pages and foldout aprons (all §3.2.22.1). What PDF adds instead
— hyperlinked cross-references (§4.5), bookmarks (§4.10), bold page numbers
lower-right, TM identification number upper-right — is native LaTeX.

This matters for build cost: it puts the work on the SwiftLaTeX path, which is
the strongest part of this codebase, instead of the LaTeX→pandoc→DOCX path,
which is the weakest.

**Open question for MARCORSYSCOM:** is the authenticated deliverable a PDF, with
Word only the drafting/review medium? If review coordination (RDC stage) needs
an editable file, that is a separate conversation.

---

## How this codebase already builds a document type

Read before writing anything — a new document type is an established pattern
here, not new architecture:

| Piece | Where |
|---|---|
| Type registration | `DOC_TYPE_CONFIG` / `DOC_TYPE_LABELS` / `DOC_TYPE_CHIP` in `src/types/document.ts` |
| Format module | `tex/templates/<doc_type>.tex` — 20 exist, ~120–150 lines each |
| Shared preamble | `tex/main.tex` — already loads `fancyhdr`, `hyperref`, `tabularx`, `array`, `graphicx`, `enumitem` |
| Generated content | `src/services/latex/generator.ts` emits named `.tex` files that `main.tex` `\input`s |
| Editor panels | `getEditorSections(config, docType)` in `src/components/layout/editorSections.tsx` |

So the shape of the work is: **one new format module, one config entry, a few
new generator functions, and editor wiring.** Not a new subsystem.

## Reuse map

Free, already written — use these rather than writing new ones:

| Need | Existing |
|---|---|
| CUI banners, top and bottom | `generateClassificationTex()` + `tex/classification.tex` |
| Signature / authentication block | `generateSignatoryTex()` |
| References, enclosures | `generateReferencesTex()`, `generateEnclosuresTex()` |
| Paragraph numbering | `calculateLabels()` |
| Underlined paragraph headings | `underlineWords()`, `toTitleCase()` |
| PDF bookmarks and links | `hyperref`, already in `main.tex` |
| Tables | `tabularx` / `array`, already in `main.tex` |
| Date entry, selects, inputs | existing `ui/` primitives |

The cover page dropdowns (Service, Entity, Address, Publication Type, Signing
Authority, Controlling Office) are shared verbatim with the standalone
TM/IETM cover template, so building them here serves that document too.

## What is genuinely new

1. `tex/templates/i_type.tex` — the format module, same shape as its siblings.
2. **Applicability table** — `NSN · TAMCN · ID · MODEL`, the end items this
   instruction applies to.
3. **Parts and materials table** — `Item · Description · NSN · PN · Qty`.
4. **WARNING / CAUTION / NOTE environments.** MIL-STD mandates a WARNING carry
   four parts: icon, concise hazard statement, minimum precautions, and possible
   results if disregarded. WARNING means injury or death; CAUTION means damage
   to equipment. Worth its own LaTeX environment and its own test.
5. **Time Compliance Period** — a validation rule (URGENT ⇒ completion date
   under one year), not just a field.
6. Doc type registration and editor wiring.

## The dependency that shapes the sequencing

The repeating-row grid editor (`RowGroupGrid`) and the whole config-form system
live in **uncommitted work on `feat/issue-28-letter-templates`. None of it is on
`main`**, so this branch cannot import it.

That is mostly fine — the two are less alike than they look. Config-form rows
are overlaid onto a scanned PDF with `pdf-lib`; I-Type tables are `tabularx` in
LaTeX. They share the *idea* of typing rows into a grid and nothing else.

So: **do not duplicate `RowGroupGrid`, and do not block on issue-28.** The
I-Type tables are small (3–6 rows typically). Build the minimum row entry the
document needs. When issue-28 lands and there are two real callers, extract the
shared grid then — that is when the repo's own rule ("no abstractions for a
single caller") is actually satisfied.

## Phases

**1 — Skeleton.** Register the doc type, add `tex/templates/i_type.tex`, wire
`getEditorSections`. Renders a cover + authentication page reusing the existing
classification and signatory generators. Proves the pattern end to end.

**2 — Body.** Purpose/applicability paragraph, Time Compliance Period with its
validation, numbered procedures.

**3 — Tables.** Applicability and parts tables, and the row entry for them.

**4 — Safety callouts.** WARNING / CAUTION / NOTE environments with the
four-part WARNING structure.

Ship MI first. SI/TI/LI are the same skeleton with different conditional
paragraphs (the Recording Instruction is MI-only) — configuration, not new work.

## Deliberately not in scope yet

- **LEP, TOC, List of Illustrations, List of Tables.** These are the real prize
  — derived content nobody should hand-maintain, and largely free in LaTeX — but
  they belong to the TM, not to a single I-Type. Next slice.
- **SI / TI / LI**, until MI is proven.
- **The SL family and full TMs.**
- **MIL-STD-40051 procedure format.** The template supports two procedure
  layouts (38784 and 40051, the latter switching the font to Arial 11). Pick one
  for v1; supporting both is a real fork and should be a deliberate decision.

## Verification

Per the repo's own rule, prove it by rendering a PDF, not by asserting on
generated LaTeX source. A compile-matrix entry for the new type, and a real
compile whose output is checked for the things that actually matter: CUI
markings top and bottom, the authentication paragraph, the applicability table,
and a WARNING rendered with all four required parts.
