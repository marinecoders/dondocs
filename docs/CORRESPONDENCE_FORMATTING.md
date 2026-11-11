# Correspondence formatting

These notes describe selected rendering behavior for letters, memoranda and endorsements. Use the [capability matrix](CAPABILITIES.md) to check which controls and outputs a format offers. Governing editions are recorded in the [reference inventory](REFERENCES.md); review the applicable publication and the finished document before signing or distribution.

## Addresses and routing

Enter action addressees and Via recipients on separate lines. PDF and Word preserve explicit address rows and wrap long text within each row. The PDF opening address block checks whether the letterhead, date and routing text fit together. If that check stops export, review the address text and use the appropriate correspondence format.

The standalone TeX interface retains its four-argument Via setter for existing sources. The browser's routing list is not limited to four recipients; available page space still applies.

## References and enclosures

Supported formal lists use hanging indents, with wrapped text aligned under the entry description. PDF list entries can continue across pages. Headquarters memorandum references use the format's Reference/Reference(s) captions; a single reference has no letter designator.

PDF reference links require a valid URL and the hyperlink option. Word retains reference titles; the reference-link annotation control applies to PDF. Word caption-column widths account for the selected font and size.

Attached enclosure PDFs are appended to PDF output. Word output retains supported enclosure-list text and requires those files to be transferred separately. See [output limits](OUTPUT_LIMITS.md).

## Type size and spacing

Correspondence rendering supports the offered 10-, 11- and 12-point sizes. Use the sizes permitted by the selected format. Technical publications have separate [format profiles](TECHNICAL_PUBLICATIONS.md).

Word single-line spacing uses its automatic spacing rule independently of the selected type size. Font size is stored separately in the text runs. PDF and Word use different layout engines, so review pagination and placement in the final file.

## Subject and paragraph headings

Where a format uses title case, PDF and Word use the same helper. It preserves acronyms, mixed-case names such as eCASS, identifiers and whitespace. All-capital input is retained for author review. Rendering does not rewrite the saved draft.

## Headquarters memoranda

Standard and executive memorandum layouts align address continuation lines and the ATTN block using the addressee text's font metrics. Word applies paragraph indents during post-processing. In Compliant mode, main body paragraphs remain unnumbered while nested paragraphs retain their identifiers. Custom-mode controls are listed in the [capability matrix](CAPABILITIES.md#correspondence-content-controls).

## Closings and signatures

Correspondence formats with bottom signatures use keep-together and widow controls to help keep the final written paragraphs with the close and signature block. Blank trailing input rows do not select the closing paragraphs. Long groups may split to fit the page; review the resulting page breaks.

Word keep rules end before copy/distribution blocks. Action/information memoranda and technical publications use their own signing layouts. PDF signing fields and uploaded signature images have the [documented Word limitations](OUTPUT_LIMITS.md#word-output).

## Endorsement continuation

Use the endorsement controls to continue the basic letter's page, reference and enclosure sequences. Other correspondence formats use their own starting values. The new-page endorsement's opening footer accounts for its continuation-header reserve as subject height changes.

## Maintaining these behaviors

Check both PDF and Word when changing shared layout code. Existing checks cover [address rows](../tests/unit/correspondenceAddressRender.test.ts), [headquarters layout](../tests/integration/headquarters-memo-layout.test.ts), [closing pagination](../tests/integration/correspondence-closing.test.ts) and [endorsement footers](../tests/integration/endorsement-footer.test.ts). Follow the [contributor testing guidance](CONTRIBUTING.md#testing) and review rendered output in addition to generated text.
