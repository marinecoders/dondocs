# DonDocs for MCP

This bundle is the DonDocs companion: an MCP server that renders SECNAV
M-5216.5 naval correspondence to PDF or DOCX. Install it in a client that
takes `.mcpb` bundles by opening the file. It is on straight away, writing
letters to `Documents/DonDocs` until you change the Output folder setting,
and the assistant gains the `dondocs_letter`, `dondocs_unit_lookup`,
`dondocs_template_list` and `dondocs_template_get` tools, the bundled
templates as resources, and a `draft_letter` prompt.

PDF output needs nothing else. DOCX output needs `pandoc` on PATH.

Machine defaults (your unit, signer, SSIC, originator code) can be set once in
the file named under "Machine defaults file"; see `docs/COMPANION.md` in the
repository for its shape. Set it first: without it every letter starts with a
unit lookup, and the signer has to be given each time.

A finished letter appears in the chat as a card: the first page, the
size, and a Download button. The file is also kept in the output folder.

Source and issues: https://github.com/marinecoders/dondocs
