# The DonDocs companion

The companion creates documents locally through HTTP or MCP. It uses the application's document generators and packaged PDF engine; Word conversion uses system Pandoc. Correspondence supports PDF and Word. Technical publications support PDF only.

Choose HTTP for scripts and clients that can send requests, or MCP for a host that launches local tool servers. Examples below use fictional training content.

## Start the HTTP server

From a source checkout, use the [development toolchain](CONTRIBUTING.md#local-setup):

```sh
npm ci
npm run vendor-assets
npm run companion
```

The server listens on `http://127.0.0.1:7712` and writes final files under your home directory's `Documents/DonDocs` folder by default. It binds to loopback, not a network interface. The calling client must run on the same machine or have access to that loopback address; in a container, loopback belongs to the container.

Check the running service before rendering:

```sh
curl --fail-with-body http://127.0.0.1:7712/health
```

Send a document:

```sh
curl --fail-with-body http://127.0.0.1:7712/generate \
  -H 'content-type: application/json' -d '{
  "docType": "naval_letter",
  "format": "pdf",
  "subject": "TRAINING EXAMPLE",
  "from": "Training Unit",
  "to": "Training Coordinator",
  "paragraphs": [{ "text": "This is a fictional example for local testing." }]
}'
```

A successful response has `ok: true`, contract version `v`, and a `files` array containing the output's `format`, local `path`, filename `out` and byte count. HTTP returns file metadata, not PDF/Word bytes. Open the reported path or use the client's file-presentation tool.

Install `pandoc` on PATH for Word output. `/health` reports its version, the browser-vendored version and whether they match. Different versions can produce different Word output. PDF does not require system Pandoc or a native TeX installation.

## Using it from an MCP client

### Install a bundle

Download `dondocs-<version>.mcpb` and its checksum from [releases](https://github.com/marinecoders/dondocs/releases). Install it in a client that supports MCP bundles, then review its Output folder, Machine defaults file and Web editor address settings. See the [bundle guide](../companion/mcpb/README.md).

Host support and permission prompts vary. The bundle includes the PDF resources; Word still requires system Pandoc.

### Register a built server

Build from the checkout:

```sh
npm ci
npm run build:companion
```

Register the built entry with the MCP client:

```json
{
  "mcpServers": {
    "dondocs": {
      "command": "node",
      "args": ["/absolute/path/to/dondocs/dist-companion/companion/mcp.mjs"],
      "env": { "DONDOCS_OUT_ROOT": "/absolute/path/to/output" }
    }
  }
}
```

Replace both paths with actual locations. Keep the full `dist-companion/` directory with its render assets. The built server targets Node 20 or later and does not require `node_modules`. Source/build tooling has the separate Node requirement in the contributor guide.

The built HTTP entry is `dist-companion/companion/server.mjs`. To package an MCP bundle after building, run `npm run build:mcpb`; it writes to `dist-mcpb/`.

### Register a source checkout

For development, install dependencies and stage vendor assets as in the HTTP setup, then register:

```json
{
  "mcpServers": {
    "dondocs": {
      "command": "node",
      "args": [
        "/absolute/path/to/dondocs/node_modules/vite-node/dist/cli.mjs",
        "--root", "/absolute/path/to/dondocs",
        "/absolute/path/to/dondocs/companion/mcp.ts"
      ],
      "env": { "DONDOCS_OUT_ROOT": "/absolute/path/to/output" }
    }
  }
}
```

The explicit `--root` makes module resolution independent of the client's working directory. Configure the registration in your host's MCP settings. The host starts the stdio process; you do not also need the HTTP server.

Stdout is reserved for MCP messages. Launch the entry directly as above, or use `npm --prefix /absolute/path/to/dondocs run --silent companion:mcp`. Keep diagnostics on stderr.

## Configuration

Set these variables on the server process or in the MCP registration's `env`:

| Variable | Purpose / default |
|---|---|
| `DONDOCS_PORT` | HTTP listener port; `7712`. |
| `DONDOCS_OUT_ROOT` | Final output directory; `Documents/DonDocs` under the user's home directory. |
| `DONDOCS_CONFIG` | Defaults file; `~/.dondocs/companion.config.json`. |
| `DONDOCS_RENDER_TIMEOUT_MS` | Positive finite render deadline in milliseconds; `45000`. Invalid values fall back to the default with a diagnostic. |
| `DONDOCS_APP_URL` | Optional HTTP(S) editor address for MCP browser handoff. Unset in a source launch; the bundle defaults to `https://dondocs.marines.dev`. Clear the bundle setting to disable handoff. |

Final documents stay inside the output root. Machine defaults use their configured file, and rendering/conversion also uses system temporary directories. Output paths escaping the root or traversing a symlink are refused. Resolve host placeholders such as `${DOCUMENTS}` before passing a path; an unresolved output-root placeholder falls back to the default with a diagnostic.

### Machine defaults

Set unit, signer, SSIC and originator defaults once, then omit those fields from later requests. Over MCP, ask to set up DonDocs defaults or call `dondocs_save_defaults`. Its patch merges supplied values; `null` clears a value. Saving through that tool updates the running MCP server immediately.

You can also edit the defaults file directly:

```json
{
  "unit": {
    "name": "TRAINING UNIT",
    "line2": "EXAMPLE ORGANIZATION",
    "address": "100 SAMPLE ROAD, EXAMPLE CITY VA 00000",
    "department": "dod",
    "seal": "dod"
  },
  "signature": { "first": "A", "middle": "B", "last": "SMITH", "rank": "Training Officer", "title": "Training Coordinator" },
  "ssic": "5216",
  "originatorCode": "S-6"
}
```

Restart each running server after editing the file directly. A missing file uses built-in defaults. An unreadable file, invalid JSON or unsupported fields stop startup with a diagnostic naming the path or field.

Request fields take precedence over saved defaults. With neither, the built-in letterhead is used and the signer is left blank. `originatorCode` maps to the app's `officeCode`. HTTP health reports the loaded unit/signer; MCP exposes the complete loaded defaults and file path through `dondocs://defaults`.

## HTTP API

| Route | Result |
|---|---|
| `GET /` or `GET /health` | Contract version, formats by document type, accepted fields, output root, loaded unit/signer and Pandoc status. |
| `POST /generate` | Validate and render one request; return local file metadata. |
| `GET /units?query=...&limit=20` | Unit matches and source/date metadata. Query is required, 1–200 trimmed characters; limit is an integer from 1–50, default 20. |
| `GET /templates` | Template IDs, names, categories and descriptions. |
| `GET /templates/{id}` | Complete registered template. Unknown IDs return 404. |

For unit matches, pass the returned `unit` object into the render request. Search uses recorded names, abbreviations, MCCs and locations. MCCs are not necessarily unique. Narrow truncated or ambiguous results; an empty result is not a reason to invent an address. Restart after changing the template registry.

Requests have a **16,000,000-byte** body limit. Unknown fields, invalid content, invalid output paths and oversized bodies return HTTP 400. Render failures return 500; a render deadline returns 504. Error responses contain `ok: false`, `v` and an `errors` array. Route lookup failures return 404.

HTTP responses use fixed messages for caught exceptions. Internal diagnostics, including unexpected rendering, unit lookup and publication-validation failures, are logged to the companion's stderr. Input validation still names fields and missing attachments so callers can correct their requests.

With `out` omitted, the server chooses a subject-based filename and adds a numeric suffix if needed. Supplying `out` replaces an existing file at that name inside the output root. Save the returned `out` value when you intend to revise that file.

## Document types

Use `docTypes` and `formatsByDocType` from `GET /health` for the running server's supported inputs. The families below cover correspondence and technical
publications; built-in and configured forms use the browser's form workflow.

| Family | Types | Extra fields |
|---|---|---|
| Letters | `naval_letter`, `standard_letter`, `multiple_address_letter` | none |
| Business | `business_letter`, `executive_correspondence` | `salutation`, `complimentaryClose` |
| Memoranda | `mfr`, `mf`, `plain_paper_memorandum`, `letterhead_memorandum`, `decision_memorandum`, `executive_memorandum` | none |
| Executive | `standard_memorandum` (alias `memorandum`), `action_memorandum`, `information_memorandum` | standard memo: `attnLine`, `throughLine`; info/action memo: `coordination`, `preparedBy` (supported PDF and DOCX layouts) |
| Endorsements | `same_page_endorsement`, `new_page_endorsement` | `endorsement: { ordinal, basicLetterId }` |
| Two-party | `joint_letter`, `joint_memorandum`, `moa`, `mou` | `parties: { senior, junior }` |
| I-Type / stock lists | `i_type`, `sl3`, `sl4` | `publication`, structured paragraphs/tables, optional `attachments`; PDF only |
| Manual front matter | `tm_ietm_front_matter` | `manualFrontMatter`; PDF only, no correspondence body |

Correspondence fields print only where the selected format uses them; retained
`from`/`to` values do not become an MFR addressing block. Correspondence dates
default to the selected format's date style. Technical publications require
explicit dates and their structured metadata rather than only these fields.
Use `formatsByDocType` from health for actual PDF/DOCX availability.

### Technical-publication requests

Use the [publication workflow and validated examples](TECHNICAL_PUBLICATIONS.md).
`i_type`, `sl3` and `sl4` take a `publication` object with `type`, `shortTitle`,
`pcn`, `nomenclature`, `controllingOffice`, `signingDate`, `distribution` and
applicable `endItems`, `tables`, `sl3` or `sl4` content. `subject` is the long
title, `date` is the effective publication date (`d MMM yy`), and `signingDate`
is ISO `YYYY-MM-DD`. Supply the issuing `unit` and authorized `signature`, or
valid machine defaults. Neither a number's syntax nor validation assigns it.

Publication paragraphs support `publicationSection`, `tableKey`, identifier
mode/footnotes, `referenceId`, `figure`, `callout`, `procedure` and `appendix`.
Use the fixed section/table keys from the source schema. Included I-Type item
sections need their populated matching tables, attached exactly once; text
alone is insufficient. SL-3/SL-4 use their structured lists, not arbitrary body
paragraphs standing in for inventory/parts data.

`tm_ietm_front_matter` instead takes `manualFrontMatter` with subtype, equipment,
notices/rights, authority basis and publication/authentication metadata. It
rejects body paragraphs, references, enclosures and I-Type attachments/tables.
It produces front matter, not a complete technical or interactive manual.

For I-Type/SL-3/SL-4, `attachments` accepts at most **32** entries with unique
`id`, `name`, `mimeType` and `dataBase64`. Allowed MIME types are PNG, JPEG and
PDF. Use standard base64 without a data-URL prefix, local path or remote URL;
each encoded string is capped at **8,000,000 characters** and the total JSON
request still has the 16,000,000-byte HTTP cap. Figures reference `fileId` and
require a single-page PDF or supported image. Publication enclosures can refer
to an attachment by `fileId`. Referenced bytes must actually decode/render;
schema acceptance alone is not a successful PDF export.

Two-party documents take both sides under `parties`. Each party carries the
command name, an optional identifying block (`from`, `code`, `zip`, `ssic`,
`serial`, `date`) and a `signature`. Joint documents print the signer's name as
given; agreements reduce a full name to initial and surname, so give
`"David R. Smith"` rather than `"D. R. SMITH"` there.

```json
{
  "docType": "moa",
  "subject": "AGREEMENT ON JOINT OPERATIONS",
  "paragraphs": [{ "text": "..." }],
  "parties": {
    "senior": { "name": "COMMANDANT OF THE MARINE CORPS", "ssic": "1000", "serial": "0001",
                "signature": { "name": "David R. Smith", "rank": "General", "title": "Commandant of the Marine Corps" } },
    "junior": { "name": "CHIEF OF NAVAL OPERATIONS", "ssic": "1000", "serial": "0002", "date": "15 Jan 26",
                "signature": { "name": "Mary K. Jones", "rank": "Admiral", "title": "Chief of Naval Operations" } }
  }
}
```

Endorsements take the ordinal and the letter being endorsed under
`endorsement`, and are refused without it: a bare ENDORSEMENT heading is not a
document.

Set `classification.level`, or use `classification.custom` for a banner
outside the list, printed as given; not both. A paragraph may carry a
`portionMarking` (`U`, `CUI`, `FOUO`, `C`, `S`, `TS`), printed in parentheses
before its text. For listed options, the renderer derives the banner from the
document selection and the highest-ranked paragraph or figure mark. Custom
banners remain unchanged.

These are application values, not six official classification levels. `FOUO`
is accepted for legacy compatibility and ranks as `cui` in the renderer; this
does not determine whether legacy information qualifies as CUI. The existing
`top_secret_sci` value prints `TOP SECRET//SCI` without identifying specific
SCI controls. See [marking terminology](CLASSIFICATION_CONFIG.md#marking-terminology)
for the official distinctions and governing sources.

## MCP tools and file presentation

| Tool | Use |
|---|---|
| `dondocs_letter` | Render the same document fields accepted by HTTP. Returns file metadata and instructions for presenting the result. |
| `dondocs_unit_lookup` | Find unit matches, with the same query/limit rules as HTTP. |
| `dondocs_template_list` | List available starters. |
| `dondocs_template_get` | Read a starter by ID. Fill its fields and replace prompts before rendering. |
| `dondocs_save_defaults` | Save or clear machine defaults. Supported clients can request signer details through a form. |

Use a known template ID directly, or list templates when you need to find one. Collect the required values, then render. For revisions, reuse the returned `out` name.

Resources include `dondocs://defaults` and `dondocs://templates/{id}`. The `draft_letter` prompt helps prepare a render request. Unit lookup can offer a picker when the client supports elicitation; otherwise it returns matches for the caller to review.

Built distributions include a document card for hosts supporting MCP Apps. It previews PDFs, offers download controls and can show Edit in browser. Other hosts may need a file-presentation tool or access to the returned path. Choose an output folder those tools can read. Source runs do not include the built card.

The card reads rendered files through `dondocs://files/{out}`. That resource is limited to files written by this server session; it does not expose arbitrary files in the output root. File links, structured results and card controls depend on the client's protocol and capabilities.

### Browser handoff

`DONDOCS_APP_URL` selects the destination editor. The handoff puts a document snapshot in the URL fragment; it is not password-encrypted. Browser fragments are not sent in the HTTP request, but the link can appear in browser history. Check the destination and handling requirements before opening it.

Handoff is offered only for eligible UNCLASSIFIED/CUI content. Custom banners, higher markings and requests with attachment files are refused. Binary assets are not carried by the URL. Clearing the editor-address setting disables the link. The bundle's default destination is the hosted DonDocs site, not a local editor.

## Troubleshooting

| Problem | Check |
|---|---|
| Connection refused | Start the HTTP server and check `/health`. An MCP stdio registration does not start the HTTP listener. Check whether the client runs in a container or on another machine. |
| Port already in use | Stop the other listener or choose another `DONDOCS_PORT`. Update the client's address to match. |
| MCP disconnects at startup | Read the host's stderr log. Check the Node version, absolute entry path, source `--root`, and defaults-file syntax. |
| Word export fails | Confirm system Pandoc is on the server process's PATH. Check `/health`; GUI hosts may inherit a different PATH from your terminal. |
| Output cannot be written | Check the output directory's permissions and the requested `out` path. Output cannot escape the root or traverse symlinks. |
| Render times out | Check the document and server diagnostics. The default deadline is 45 seconds; set a positive finite `DONDOCS_RENDER_TIMEOUT_MS` before restarting if needed. |
| Defaults look stale | Restart after editing the file directly. MCP changes saved through `dondocs_save_defaults` apply immediately to that MCP server; separate processes keep their own loaded state. |
| Card is absent or unchanged | Confirm the host supports MCP Apps and is running a built distribution. Restart the host if it has retained an older card. |
| Edit in browser is missing | Check the editor-address setting, host link-opening support and handoff eligibility. |

## Security and license

Use trusted local clients and synthetic data for testing. A loopback listener is local to the machine, not a claim that every local caller is trusted. Follow [SECURITY.md](../SECURITY.md) for reporting and data handling.

The companion uses GNU AGPL version 3 only (`AGPL-3.0-only`). Built distributions include license texts and `SOURCE.txt`; third-party components retain their own terms. See [licensing and distribution](LICENSING.md).
