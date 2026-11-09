# Correspondence formatting fixes

## Routing and address rows

SECNAV M-5216.5 Chapter 7 paragraphs 5–8 and Chapter 8 Figure 8-1 require
complete routing and distinct action-addressee rows. PDF and Word preserve
explicit address rows and wrap within each row. The PDF Via list no longer
stops after four recipients. The legacy four-argument TeX setter remains
available for existing standalone sources.

An opening address table that cannot fit below the letterhead and date stops
PDF export with an instruction to shorten the address or routing text. It cannot
silently lose recipients or move the complete address block onto a later page.

Regression coverage includes the packaged PDF engine, native PDF and Word
conversion, route counts through ten, LF/CRLF address input, and rejection of
oversized wrapped routing blocks in both PDF engines.

## Reference and enclosure pagination

Lists use flowing hanging-indent entries so long lists and individual titles
can continue across pages. Captions remain aligned with the first entry;
numbering and links survive. Headquarters memorandums permit references when
needed and use Reference/Reference(s) captions, with no letter for a single
reference (SECNAV Chapter 12 paragraph 2m). Page-bound checks exercise long
lists and an individual entry longer than a page in the packaged engine.
