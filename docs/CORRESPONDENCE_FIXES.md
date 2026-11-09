# Correspondence formatting fixes

## Routing and address rows

SECNAV M-5216.5 Chapter 7 paragraphs 5–8 and Chapter 8 Figure 8-1 require
complete routing and distinct action-addressee rows. PDF and Word preserve
explicit address rows and wrap within each row. The PDF Via list no longer
stops after four recipients. The legacy four-argument TeX setter remains
available for existing standalone sources.

Regression coverage includes the packaged PDF engine, native PDF and Word
conversion, route counts through ten, and LF/CRLF address input.
