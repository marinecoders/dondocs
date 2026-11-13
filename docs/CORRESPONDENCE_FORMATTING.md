# Correspondence formatting

These notes describe selected rendering behavior for letters, memoranda and endorsements. Use the [capability matrix](CAPABILITIES.md) to check which controls and outputs a format offers. Governing editions are recorded in the [reference inventory](REFERENCES.md); review the applicable publication and the finished document before signing or distribution.

## Addresses and routing

Enter action addressees and Via recipients on separate lines. PDF and Word preserve explicit address rows and wrap long text within each row. The PDF opening address block checks whether the letterhead, date and routing text fit together. If that check stops export, review the address text and use the appropriate correspondence format.

The standalone TeX interface retains its four-argument Via setter for existing sources. The browser's routing list is not limited to four recipients; available page space still applies.

## References and enclosures

Supported formal lists use hanging indents, with wrapped text aligned under the entry description. PDF list entries can continue across pages. Headquarters memorandum references use the format's Reference/Reference(s) captions; a single reference has no letter designator.

In **References**, choose **Review first-citation order** to preview the source list in body appearance order (SECNAV M-5216.5, Ch 7 ¶10a). Paragraph headings participate; Via, Copy to and distribution annotations do not determine order. Uncited sources remain at the end in their existing relative order. Endorsements retain their starting letter and inherited references (Ch 9 ¶3).

Dragging or removing a reference also opens a preview. Apply updates the list and supported explicit `reference (a)`, `ref (a)` and parenthesized multi-reference clauses together. One Undo restores the previous revision. Via, Copy to and distribution annotations are included. Source titles and URLs stay attached to their sources. Typing or replacing the active draft invalidates an open preview.

Ranges, quoted citations, unknown labels and affected citations outside supported fields require manual correction before a change can be applied. Bare `(a)` markers are not rewritten: the preview requires confirmation that these are not shorthand reference citations. A cited source cannot be removed until its citation is removed or replaced. Changing an endorsement's starting letter or switching document types also preserves supported citation targets, and stops with an explanation when a safe relabel cannot be made.

Word reference titles link to their saved URLs when valid. Missing or unsafe URLs leave plain titles. PDF reference links require the separate hyperlink option; that checkbox does not disable Word links. Word caption-column widths account for the selected font and size.

Attached enclosure PDFs are appended to PDF output. Word output retains supported enclosure-list text and requires those files to be transferred separately. See [output limits](OUTPUT_LIMITS.md).

## Reviewed formatting corrections

In **Body**, choose the date audience before selecting **Review body date formatting**. Military body dates use a full month and four-digit year, such as **5 November 2026**; civilian body dates use **November 5, 2026** (SECNAV M-5216.5, Ch 2 ¶16). Known historical years, such as **10 November 1775**, retain their exact year. The choice is not inferred from an addressee or the header date. Quoted text, code, links and placeholders remain unchanged. Numeric dates are not rewritten, and short years or invalid named dates require manual review.

In **References**, **Review NOTAL formatting** formats an existing terminal marker such as `( notal )` as `(NOTAL)` (Ch 7 ¶10b). This does not assign NOTAL status or change the source URL, letter, order, or body citations.

Each preview identifies the affected occurrence and shows Current and Proposed text. Select the corrections to apply together; one Undo restores the previous revision. Editing or switching drafts invalidates the preview. These tools cover ordinary single-signer correspondence; forms, technical publications and dual-signature formats remain outside this correction scope.

## Type size and spacing

Correspondence rendering supports the offered 10-, 11- and 12-point sizes. Use the sizes permitted by the selected format. Technical publications have separate [format profiles](TECHNICAL_PUBLICATIONS.md).

Word single-line spacing uses its automatic spacing rule independently of the selected type size. Font size is stored separately in the text runs. PDF and Word use different layout engines, so review pagination and placement in the final file.

## Subject and paragraph headings

Where a format uses title case, PDF and Word use the same helper. It preserves acronyms, mixed-case names such as eCASS, identifiers and whitespace. All-capital input is retained for author review. Rendering does not rewrite the saved draft.

## Headquarters memoranda

Standard and executive memorandum layouts align address continuation lines and the ATTN block using the addressee text's font metrics. Word applies paragraph indents during post-processing. In Compliant mode, main body paragraphs remain unnumbered while nested paragraphs retain their identifiers. Custom-mode controls are listed in the [capability matrix](CAPABILITIES.md#correspondence-content-controls).

## Closings and signatures

Correspondence formats with bottom signatures use keep-together and widow controls to help keep the final written paragraphs with the close and signature block. Blank trailing input rows do not select the closing paragraphs. Long groups may split to fit the page; review the resulting page breaks.

Word keep rules end before copy/distribution blocks. Action/information memoranda and technical publications use their own signing layouts. Supported single-signer correspondence embeds an uploaded PNG signature image above the typed name in Word, preserving its aspect ratio within 1.5 by 0.5 inches. This is a visual signature image; PDF signing fields and other signing layouts have the [documented Word limitations](OUTPUT_LIMITS.md#word-output).

## Business-letter figures

In a Custom business letter, choose **Figure** from a paragraph's block menu, enter its caption and upload a PNG or JPEG. PDF and Word retain the image, graphic portion marking and numbered caption. Existing figures remain part of the letter when switching modes. Word fits each image within 6.5 by 5 inches while preserving its aspect ratio and embeds the bytes and caption as alternative text. Missing or unreadable images stop Word export rather than producing an incomplete file. Other publication figures retain their existing PDF-only output boundary.

## Endorsement continuation

Use the endorsement controls to continue the basic letter's page, reference and enclosure sequences. Other correspondence formats use their own starting values. The new-page endorsement's opening footer accounts for its continuation-header reserve as subject height changes.

## Maintaining these behaviors

Check both PDF and Word when changing shared layout code. Existing checks cover [address rows](../tests/unit/correspondenceAddressRender.test.ts), [headquarters layout](../tests/integration/headquarters-memo-layout.test.ts), [closing pagination](../tests/integration/correspondence-closing.test.ts) and [endorsement footers](../tests/integration/endorsement-footer.test.ts). Follow the [contributor testing guidance](CONTRIBUTING.md#testing) and review rendered output in addition to generated text.

## Document and field comments

Use **Comments** above the correspondence editor to discuss the whole draft or an available text field. Add a reviewer name and comment, then reply, edit, resolve, reopen, or delete a thread. Names are self-entered labels, not verified identities. Each saved comment action supports Undo and Redo.

Field comments retain the field's value when the comment was added. If that field or document format changes, the thread shows the captured and current values; unavailable fields keep their original context. A pending comment cannot save against a changed draft until the author deliberately chooses the current draft. Resetting or opening another document does not carry unrelated comments into it. Replacing content within the same draft retains existing feedback and its context.

Comments are included in draft files, encrypted shared copies, and workspace backups. Shared copies are snapshots; this release does not merge returned discussions or provide live collaboration. Reusable templates exclude review comments. Clean PDF and Word exports omit comments, and batch substitutions do not rewrite review text. Comments on forms and technical publications, text-range review, proposed edits, and authenticated approval records are outside this release.
