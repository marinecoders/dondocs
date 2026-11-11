# DonDocs for MCP

Install the `.mcpb` file in a client that accepts MCP bundles. The companion renders supported naval correspondence to PDF/Word and technical publications to PDF. PDF rendering uses bundled resources; Word additionally requires `pandoc` on PATH. Source/build tooling has separate requirements from the bundle's declared Node runtime.

The assistant receives these tools:

- `dondocs_letter`: render a supported document to a local file.
- `dondocs_unit_lookup`: search the bundled unit directory.
- `dondocs_template_list` / `dondocs_template_get`: find and read content templates.
- `dondocs_save_defaults`: save unit/signer/SSIC/originator defaults after collecting the necessary values.

Templates/defaults are also available as resources, with the `draft_letter` prompt. Ask to set up DonDocs defaults before drafting, or provide the needed values for each request. The [companion guide](https://github.com/marinecoders/dondocs/blob/main/docs/COMPANION.md) describes the schemas, formats and validation; [publication examples](https://github.com/marinecoders/dondocs/blob/main/docs/TECHNICAL_PUBLICATIONS.md) cover the PDF-only families.

## Files and host support

Final documents go to the configured **Output folder** (normally `Documents/DonDocs`). Choose a folder the host's file tools may read. Machine defaults are written separately, normally to `~/.dondocs/companion.config.json` or the selected **Machine defaults file**. Rendering also uses system temporary directories; the output folder is not the only location the process writes.

A host supporting MCP Apps can display the companion's document card with preview/download controls. Other hosts may show a text result or file link and need their own file-presentation tool. Card rendering, file access and permission prompts depend on the client; installing the bundle does not guarantee all of them.

**Web editor address** controls the optional Edit in browser handoff. It opens the configured deployment with a supported text snapshot; files/signature images are not transferred through that link, and unsupported or above-CUI content is not offered as a handoff. Review output/transfer scope before using it. After updating a bundle, restart the host if it retains the old card resource.

## License and source

DonDocs is GNU AGPL version 3 only (`AGPL-3.0-only`). See bundled `LICENSE.txt`, `THIRD_PARTY_LICENSES.txt`, `LICENSING.txt` and `SOURCE.txt`. [Source and issues](https://github.com/marinecoders/dondocs).
