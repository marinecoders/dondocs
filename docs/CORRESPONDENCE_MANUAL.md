# Searchable correspondence manual

Open **Document tools → Document type guide → Manual** to read or search the
bundled SECNAV M-5216.5. Search matches literal phrases without regard to case
and treats line breaks as spaces. Results identify both the printed page and
the physical PDF page. Chapter and appendix navigation covers all 159 pages,
including the source index. Searches show at most 50 matching pages; refine a
broad phrase to narrow them.

The reading view contains extracted source text. It does not reproduce the
layout of figures or tables. **View original PDF page** opens the corresponding
page of the unchanged source inside the guide. **Back to reference text** and
the guide's Close button remain available while that page loads. Escape closes
the guide. **Download original PDF** saves the complete source file.

**Proofread** findings with a manual citation open that source in this reader.
The personal checklist's **Read the manual checklist** button opens chapter 2,
paragraph 19. Opening a source closes Proofread before opening the guide.

## Source and edition

The source is the Department of the Navy's *Correspondence Manual*, June 2015,
Change 1 dated 16 May 2018. Its existing record is in
[reference-sources.json](reference-sources.json), and the maintained authority
and currentness notes remain in the [reference inventory](REFERENCES.md).
The reader identifies this as a bundled reference edition. Availability of
the bundled file does not establish that it is the current governing edition.

The source PDF SHA-256 is
`7be9f75d12956bb08a7777a21e3e8447a9c61e37a214075822870df9c3340ad6`.
The reader's **Issuing-site source PDF** link retains the issuing authority URL.
Existing notices for government materials remain in the project's
[third-party notices](../THIRD_PARTY_LICENSES.md). The application does not
rewrite extracted text as new guidance or certify a document by displaying it.

Paragraph links carry a chapter, optional numeric paragraph and optional search
phrase. The reader resolves a matching paragraph heading in that chapter. If
the heading is absent, it says so and opens the chapter for inspection rather
than claiming an exact match. For example, chapter 2, paragraph 19 opens
physical PDF page 28 (printed page 2-12); the paragraph continues on page 29.

## Loading and offline availability

The manual reader, text resource and original PDF are loaded when requested.
Opening the application alone does not fetch the full manual. The 361,732-byte
text resource is separate from the 2,118,392-byte PDF, which is fetched only when
the original is requested.

The reader verifies each resource's byte count and SHA-256 before use. Verified
resources are saved in a dedicated browser cache with content-based keys, so
an application release can reuse the same reference. The cache retains at most
four resources. It contains public reference files, never draft contents.
An invalid cached copy is removed and fetched again. Offline reading works
after the text has been saved and the application is available; the PDF must
also have been opened for its bytes to be saved. Viewing PDF pages offline also
requires the application's viewer assets to be available. Browser storage
eviction, clearing site data or disabled persistent storage can remove this
availability. The reader reports whether the text was saved or is only
available in the current session.

## Updating the bundled source

The generator uses the checked-in PDF and the existing reference registry; it
does not download a replacement. Review the edition, authority record,
physical chapter page map and representative rendered pages before adopting a
different source. The resource and metadata paths contain content checksums.

With Poppler's `pdftotext` installed:

```sh
python3 scripts/build-correspondence-manual.py
python3 scripts/build-correspondence-manual.py --check
```

The check verifies the original PDF, all extracted pages, metadata and public
copies byte for byte. Unit tests also verify the pinned PDF, extraction,
chapter identities, paragraph 19, search limits, integrity failures and cache
fallback. Browser tests exercise the real source PDF, original-file download,
offline text reopen, narrow layouts and dismissal.
