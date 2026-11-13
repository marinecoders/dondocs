# DonDocs

[![AGPL v3 License](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

Write naval correspondence, prepare technical publications and fill service forms in your browser. DonDocs handles the layout and produces PDFs, with Word export for correspondence. Layouts are based on SECNAV M-5216.5 and the applicable Marine Corps guidance listed in the [reference guide](docs/REFERENCES.md).

[Open DonDocs](https://dondocs.marines.dev) · [User guide](docs/USER_GUIDE.md) · [Documentation](docs/README.md)

## Getting started

1. Choose **Correspondence** or **Forms**, then select a format. Technical publications are in the correspondence picker.
2. Start with a blank draft or open **Templates** in the sidebar. Apply a saved profile to fill in your unit and signer details.
3. Fill in the document and review the PDF preview. Replace any prompts left by a template.
4. Choose **Download** and an output format. Review the completed document before signing or sending it.
5. Wait for **Saved** before closing the page. Download an external backup from **Settings → Backup & restore**.

On mobile, open the workspace menu to reach the sidebar tools.

## Document types

| Family | Examples | Output |
|---|---|---|
| Correspondence | Naval and business letters, memoranda, endorsements, MOA/MOU and executive formats | PDF, Word |
| Technical publications | I-Type MI/TI/SI/LI, SL-3, SL-4 and TM/IETM front matter | PDF |
| Built-in forms | NAVMC 10274 and NAVMC 118(11) | PDF |

TM/IETM output provides front matter, including cover and authentication pages. For publication fields and examples, see the [technical-publication guide](docs/TECHNICAL_PUBLICATIONS.md). Additional static forms can be added through [reviewed form packages](docs/FORM_TEMPLATES.md).

The [capability matrix](docs/CAPABILITIES.md) lists available operations for each format. Word exports omit uploaded images, appended PDF pages, PDF signing fields and reference-link annotations. PDF and Word pagination can differ. See [output limits](docs/OUTPUT_LIMITS.md) for details.

## Features

- Edit paragraphs with nested numbering, formatting, reordering and cross-references.
- Preview PDFs while you work, with zoom, page navigation and fullscreen viewing.
- Reuse unit and signer profiles, document templates and text snippets.
- Look up units, SSICs, office codes and references without leaving the editor.
- Generate a batch of PDFs from a template and an uploaded Excel roster or pasted spreadsheet rows. Preview the first worksheet, choose its headers, map variables and review data warnings before generation.
- Add enclosures and PDF signature fields in supported formats. Sign the downloaded PDF in your signing application.

Use `Ctrl/Cmd+K` to find commands. **Help → Keyboard shortcuts** lists the other shortcuts. The [user guide](docs/USER_GUIDE.md) covers the editing and export workflows.

## Document management

Drafts autosave in this browser and appear in **Recents**. Search, pin, rename or duplicate a draft, and use **History** to compare or restore earlier revisions. Removed drafts go to **Trash** until you restore or permanently delete them.

**Save checkpoint** keeps a manual local copy. Export a draft JSON file to move an editable document to another browser, or create a password-protected share link for a text snapshot. Share links omit attachments and signature images, cannot be revoked, and do not change when you edit the original.

Workspace backups include saved documents, Trash, history, profiles, snippets, user templates and referenced assets. Batch jobs/results, UI preferences and blank form PDFs are excluded. Draft and backup JSON files are unencrypted. Before restoring, read the [merge and replacement rules](docs/STORAGE.md#backups).

Browser storage can be cleared or evicted. Keep an external backup of work you need to retain.

## Offline use

You can install DonDocs as a browser app. While connected, try the exports you will need. For configured forms, choose **Save for offline use** to cache the exact template revision. Check that the documents reopen and export before disconnecting.

See [offline preparation](docs/DEPLOYMENT.md#offline-preparation) for deployment and asset requirements.

## Companion

The optional [HTTP/MCP companion](docs/COMPANION.md) creates documents locally from other applications and chat clients. It supports correspondence PDFs and Word files, plus technical-publication PDFs. Word conversion requires system Pandoc.

Use the [MCP bundle instructions](companion/mcpb/README.md) for installation and machine defaults. File access, previews and download controls depend on the host application.

## Development

Use Node **22.13+ on the Node 22 line** and the checked-in npm lockfile. Initial setup needs network access for dependencies and vendor assets.

```sh
npm ci
npm run dev
```

The development server runs at `http://localhost:5173`. To check changes and build the site:

```sh
npm test
npm run docs:check
npm run lint
npm run build
```

The build writes to `dist/`. [Contributing](docs/CONTRIBUTING.md) covers generated assets and checks for specific changes. [Deployment](docs/DEPLOYMENT.md) covers hosting, Docker and release delivery.

## Security and privacy

Document editing and browser exports run locally; editor contents are not automatically uploaded. The public site uses Cloudflare Web Analytics. Unmodified self-hosted builds do not include that analytics script.

DonDocs checks supported text for possible PII/PHI before rendered exports and sharing. The check does not inspect attached PDFs or images, and draft/backup JSON bypasses it. Keep exported files in a location appropriate for their contents.

DonDocs is community software, not an official USMC, DON or DoD system. It has no Authority to Operate for classified processing. Printed markings and classification selectors do not enforce access controls or authorize sensitive-data processing.

Use [private vulnerability reporting](https://github.com/marinecoders/dondocs/security/advisories/new) for security findings. [SECURITY.md](SECURITY.md) explains reporting, response and document handling.

## Documentation

- [User guide](docs/USER_GUIDE.md): editing, imports, profiles, sharing, backups and batches.
- [Technical publications](docs/TECHNICAL_PUBLICATIONS.md): publication workflows and sample requests.
- [Architecture](docs/ARCHITECTURE.md): rendering, storage and source entry points.
- [Test suites](tests/README.md): unit, native, browser and upgrade checks.
- [Project inventory](docs/PROJECT_INVENTORY.md): generated format, template and fixture counts.
- [Documentation index](docs/README.md): form authoring, classification configuration, deployment and other guides.

## License

DonDocs is licensed under [GNU AGPL version 3 only](LICENSE) (`AGPL-3.0-only`). See [distribution guidance](docs/LICENSING.md) and [third-party notices](THIRD_PARTY_LICENSES.md) for included components and source requirements.
