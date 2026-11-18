# Scanned package evidence

In a package's Overview, open **Scanned evidence**. Choose a captured PDF, PNG or JPEG and select **Recognize captured source**. Recognition uses the existing local OCR engine; it never uploads the source or rewrites its bytes.

Compare each page beside its captured source. Edit the corrected text, then review and acknowledge the complete extraction before saving. Original recognized words, confidence, corrections and exact file association remain together in the new saved package revision. Recognition and correction do not create shared package values automatically.

To use an excerpt, reopen a saved extraction, expand **Adopt a corrected excerpt as a package value**, and enter an exact excerpt from the corrected page. Review and acknowledge that separate change. Its provenance records the source label, physical page and digest. Existing mapped fields are not guessed or changed automatically.

Saved extractions survive membership edits, portable transfer and recovery because their source files remain retained. An extraction from a replaced or removed member is labeled as belonging to an earlier source. It can be inspected, but cannot supply a current package value. Captured search indexes corrected words only when their source member and bytes still match.

The existing OCR limits apply: PDFs up to 20 MB and 12 pages; images up to 10 MB; bounded raster dimensions and local preview memory. A revision retains up to 20 extractions and 2 MB of extraction metadata; all retained extraction history is limited to 8 MB. Recognition may misread words. Confidence is an engine estimate, not verification. Review the source before using an excerpt.

Correction writes require the current owning package, unchanged storage, fresh deployment settings and a new acknowledgement. Historical and reviewer views can inspect saved extractions. Source and extraction text are included in portable/share disclosure checks; recipient delivery does not silently attach editable OCR history.
