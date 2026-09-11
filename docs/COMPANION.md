# The DonDocs companion

A loopback HTTP endpoint that renders naval correspondence from JSON. It exists
so an agent on the same machine — anything that can make an HTTP request — can
produce a real, format-correct PDF or DOCX without a browser.

```bash
npm run companion
```

```
DonDocs companion on http://127.0.0.1:7712  (loopback only, v1)
  writing under /Users/you/Documents/DonDocs
```

It renders through the **same generator the app uses**. `src/services/latex/`
holds the document logic behind a `LatexEngine` port; the browser satisfies that
port with SwiftLaTeX's WASM worker and the companion satisfies it with a Node
worker thread. There is no second implementation of the letter rules to drift.

## Why loopback, specifically

This is the architectural point rather than a default. A `127.0.0.1` request
never meets the site proxy, the DoD CA bundle, or SSPI — the three things that
make .mil networking painful. Binding anything routable would give that up, so
the server binds `127.0.0.1` explicitly and never `0.0.0.0`.

## The contract

`GET /` or `GET /health` returns capabilities: contract version, supported
formats and docTypes, the output root, the configured defaults, and which pandoc
will convert DOCX. Probe this first — it tells a client everything it needs
without sending a letter.

`POST /generate` renders one document.

```bash
curl -X POST http://127.0.0.1:7712/generate -H 'content-type: application/json' -d '{
  "docType": "naval_letter",
  "format": "pdf",
  "subject": "REQUEST FOR ADDITIONAL RANGE TIME",
  "from": "Commanding Officer, 1st Battalion, 6th Marines",
  "to": "Commanding General, II MEF",
  "paragraphs": [{ "text": "Request approval for additional range time in FY26." }]
}'
```

```json
{ "ok": true, "v": 1, "files": [{ "format": "pdf", "path": "/Users/you/Documents/DonDocs/request-for-additional-range-time.pdf", "bytes": 253832 }] }
```

**It answers with a path, never the document.** Agent harnesses clip tool output,
often to a few thousand characters, and that one-paragraph letter is 248 KB —
roughly 338,000 characters as base64. A path is sixty and opens a real file.

**Status carries the outcome.** A caller derives success from the HTTP status, so
a bad request is a 4xx and never a 200 with an error inside it. `400` means the
request was wrong and the errors array says how — all of them at once, so one
round-trip is enough to fix it. `500` means rendering genuinely failed.

Requests are capped at 1 MB, and `out` is resolved inside the output root and
refused if it escapes. `out` is chosen by a model composing JSON, so
`../../../../etc/passwd` is a realistic input rather than a hypothetical one.
A file already at `out` is replaced; the MCP tool says so with
`destructiveHint`. With `out` omitted the name is a slug of the subject, and
a name already taken gets the next number (`subject-2.pdf`), so a repeated
subject never writes over an earlier letter. A write that fails is reported
as `could not write <path>`, not as a render failure.

## Document types

`docType` accepts every type the app defines — the enum in the tool schema and
`docTypes` in `GET /health` are both derived from the app's registry, so the
list here is illustrative rather than authoritative:

| Family | Types | Extra fields |
|---|---|---|
| Letters | `naval_letter`, `standard_letter`, `multiple_address_letter` | none |
| Business | `business_letter`, `executive_correspondence` | `salutation`, `complimentaryClose` |
| Memoranda | `mfr`, `mf`, `plain_paper_memorandum`, `letterhead_memorandum`, `decision_memorandum`, `executive_memorandum` | none |
| Executive | `standard_memorandum` (alias `memorandum`), `action_memorandum`, `information_memorandum` | standard memo: `attnLine`, `throughLine` (DOCX only); info memo: `coordination`, `preparedBy` (action memo too, DOCX only) |
| Endorsements | `same_page_endorsement`, `new_page_endorsement` | `endorsement: { ordinal, basicLetterId }` |
| Two-party | `joint_letter`, `joint_memorandum`, `moa`, `mou` | `parties: { senior, junior }` |

The plain `from`, `to`, `subject` and `date` fields work for every type; the
companion routes them to whatever the type reads. The date defaults to the
format the type's chapter prescribes — `8 Aug 26` for a naval letter,
`August 8, 2026` for business and executive correspondence — when omitted.

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

Classification is `classification.level`, or `classification.custom` for a
banner outside the list, printed as given; not both. A paragraph may carry a
`portionMarking` (U, CUI, FOUO, C, S, TS), printed before its text, and the
banner rises to the highest mark in the document.

## Machine defaults

A unit is a property of the box, not of the request. Put yours in
`~/.dondocs/companion.config.json` and an agent stops restating it on every
call. Set it first: without it every letter starts with a unit lookup, and the
signer has to be given each time.

```json
{
  "unit": {
    "name": "MARINE INNOVATION UNIT",
    "line2": "TRAINING AND EDUCATION COMMAND",
    "address": "PSC BOX 20004, QUANTICO VA 22134-5001",
    "department": "usmc",
    "seal": "dow"
  },
  "signature": { "first": "A", "middle": "B", "last": "SMITH", "rank": "Major", "title": "Officer in Charge" },
  "ssic": "5216",
  "originatorCode": "S-6"
}
```

`originatorCode` is the app's `officeCode`, printed on the sender-symbol line
with the serial on the types that carry an SSIC.

A missing file is normal, not an error — built-in fallbacks keep a fresh install
rendering. A file that exists but is not this shape (a wrong type, a key the
request could not set either) stops the companion at startup with the path and
the field named, the same as a file that is not JSON. Precedence is
**request > config > fallback** at every field, so a caller can override the
unit for one letter without editing anything. The unit line under the
department heading is `name` (or `line1`, the app's name for the same line);
with neither, only the heading prints.

`GET /health` reports the loaded `unit` and `signature`; over MCP the same
values, plus `ssic`, `originatorCode` and the config path, are the
`dondocs://defaults` resource. Both show the snapshot taken at startup, so an
edit to the file shows after a restart.

Override the location with `DONDOCS_CONFIG`, the port with `DONDOCS_PORT`, and
the output root with `DONDOCS_OUT_ROOT`.

`DONDOCS_RENDER_TIMEOUT_MS` bounds a render — 45s, covering both formats and
both transports. A value that is not a positive number is ignored with a note
on stderr. The number is set against the caller's patience rather than
ours: agent HTTP tools commonly allow about a minute per call, so a companion
that waited as long would expire at the same moment and hand the model an opaque
transport timeout instead of a message naming what was slow.
Measured renders are 0.87s (PDF) and 0.49s (DOCX), so reaching 45s means
something is wedged. A timeout answers `504`.

## Using it from an agent that speaks HTTP

Any agent that can make an HTTP request can use the companion — no SDK, no
client library. Point its HTTP tool at `http://127.0.0.1:7712/generate` with the
JSON above.

It works without special handling because loopback addresses are normally exempt
from proxy configuration, and because the response is a path rather than a
document, so it survives whatever output limit the harness applies.

If the harness allows custom tools, one wrapping that request beats a raw HTTP
call — the model gets a described schema instead of being told the URL and
payload shape every time. Where it does not, the raw call is fine.

## Browsing templates over HTTP

For unit addresses, use `GET /units?query=Marine%20Innovation%20Unit%20Newburgh&limit=20`.
`query` is required (1–200 characters after trimming); `limit` defaults to 20
and must be an integer from 1 to 50, matching the MCP lookup limits.
The response is `{ ok: true, v: 1, source, lastUpdated, total, truncated, matches }`.
Each match contains `mcc` and a `unit` object that can be passed to `/generate`.
No matches returns HTTP 200 with an empty `matches` array. Invalid inputs return
HTTP 400 with `{ ok: false, v: 1, errors: [...] }`.
This route uses the same `lookupUnits()` implementation as `dondocs_unit_lookup`.

`GET /templates` returns `{ ok: true, v: 1, templates: [...] }`, where each
entry contains a registered template's `id`, `name`, `category`, and `description`.
`GET /templates/{id}` returns `{ ok: true, v: 1, template: {...} }` with the full template.
These read-only routes use the same registry as the application and MCP tools.
Unknown IDs return HTTP 404 with an `errors` array.

From PowerShell, with the companion running:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:7712/templates'

Invoke-RestMethod -Uri 'http://127.0.0.1:7712/templates/report-findings' |
    ConvertTo-Json -Depth 10
```

Restart the companion after adding or changing registered templates.

## Using it from an MCP client

There is a second front door for clients that speak MCP rather than HTTP —
Claude Desktop and the MCP-aware editors:

```bash
npm run companion:mcp
```

You do not normally run that yourself. An MCP client launches the process over
stdio when it needs it and shuts it down after, which is the one real advantage
over the HTTP endpoint: nothing to leave running, and no confusing connection
error when someone forgets. The other is that the input schema is published, so
the model reads the real field names instead of guessing them.

There are three ways to install it, in order of least setup.

**The bundle.** Each release carries `dondocs-<version>.mcpb`, the built
server packed as an MCP Bundle, with its SHA-256 beside it. A client that
takes bundles (the desktop apps for macOS and Windows do) installs it when you
open the file, asks for the output folder, and runs it with the Node it ships,
so nothing else is installed. PDF needs nothing more; DOCX needs `pandoc` on
PATH. To build it yourself: `npm run build:companion && npm run build:mcpb`
writes `dist-mcpb/dondocs-<version>.mcpb`.

**The built file.** `npm run build:companion` writes `dist-companion/`: the
two entries bundled with everything they import, beside the render assets.
Register the MCP entry with any client that runs a command:

```json
{
  "mcpServers": {
    "dondocs": {
      "command": "node",
      "args": ["/absolute/path/to/dondocs/dist-companion/companion/mcp.mjs"],
      "env": { "DONDOCS_OUT_ROOT": "/Users/you/Documents/DonDocs" }
    }
  }
}
```

The file needs only Node 20 or later; `node_modules` is not consulted.
`dist-companion/companion/server.mjs` is the HTTP door built the same way.
The package also declares the entry as the `dondocs-mcp` bin, for `npm link`.

**From source**, for development. This runs the TypeScript entry through
vite-node from a checkout in which `npm install` has been run:

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
      "env": { "DONDOCS_OUT_ROOT": "/Users/you/Documents/DonDocs" }
    }
  }
}
```

`--root` is required: a client launches the server from its own working
directory, and without it module resolution fails. The equivalent through npm
is `npm --prefix /absolute/path/to/dondocs run --silent companion:mcp`; see the
note on stdout below for why `--silent` matters.

Where the client keeps its registration differs: the desktop app reads
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS;
check your client's own docs.

A config file that is not JSON, or not the documented shape, stops the server
before it answers `initialize`. A client shows that as a disconnect with
nothing on the protocol; the reason is on stderr, which most clients keep in
their MCP log.

`dondocs_template_list` takes no arguments and returns a JSON array containing
every bundled letter template's `id`, `name`, `category`, and `description`.
Call `dondocs_template_get` with `{"id":"report-findings"}` to retrieve the full
template, including its document type, subject, paragraphs, and any references
and SSIC. Both tools are read-only. The IDs are an enum on `dondocs_template_get`
and are named in the instructions, so a model whose user asked for a PFT waiver
calls the get and skips the list; an unknown ID returns a tool error naming the
valid ones.

The agent chooses a matching template, works with the user to fill bracketed
placeholders and correspondence details, then passes completed letter fields to
`dondocs_letter` (excluding template metadata). If multiple templates fit, ask
the user to choose; if none fit, explain that no matching template is available.
Both tools use `LETTER_TEMPLATES` in `src/data/templates/index.ts`, just like the
application. Register new templates there and restart the MCP server to expose
them; no MCP tool changes are needed.

`dondocs_letter` takes the same fields as `/generate`
and returns the path it wrote, then on a second line the host tool that puts
the file in the chat and the `out` that replaces that file. A filename outside
the output root comes back as a tool error the model can read and retry, not a
protocol failure.

`dondocs_unit_lookup` searches the bundled address directory without giving the
agent filesystem access. Call it with `{"query":"Marine Innovation Unit"}` (name, abbreviation,
MCC, or location). It returns `matches`, `total`, `truncated`, and directory
source/date metadata. Results default to 20; optional `limit` accepts 1–50.
Each match contains an MCC and a `unit` object ready for `dondocs_letter`.

For example, `MIU` or `Marine Innovation Unit` returns seven locations. Ask
which location the user means, then narrow with `{"query":"MIU Newburgh"}`. Pass that match's `unit` object
unchanged in the letter request. No additional lookup or identifier is needed.
MCC values are searchable but are not always unique. When results are truncated,
narrow the query; when no units match, ask for another name, MCC, or location.
An unambiguous result can be used immediately. Search uses only values recorded
in the directory; there is no alias expansion. If an acronym is not recorded,
search its full name or ask the user what it stands for.

### Round trips

The server's share of a letter is small: the process starts in 0.2 s, a lookup
takes 14 ms and a PDF render 0.3 to 0.4 s. A letter through the desktop app
still took six minutes of wall clock in testing: each tool call is a model
turn, a host may ask the person to allow each tool the first time, and the rest
is the conversation. So the server is arranged for the fewest calls:

- With a defaults file there is nothing to look up, and the instructions say
  to omit `unit`.
- The template IDs are an enum on `dondocs_template_get` and are named in the
  instructions, so `dondocs_template_list` is for when the user's wording does
  not point to one.
- The render tool's description, the instructions and the result say to render
  once the facts are in hand and to revise by rendering again with `out` set to
  the name the result reports, rather than drafting in chat and then sending
  the same text as a call.
- The result names the host tool that puts the file in the chat. The desktop
  app shows a tool result's text; it does not render the `resource_link`,
  and an embedded document it forwards to the model as an image, which the
  API refuses. Its card comes from a tool of its own, `present_files`, which
  takes the path and reads the file through the Filesystem extension. The
  model calls it when the result names it; asked to share the file if a tool
  of its own could, it did not. There is no card without a file, so choose
  an output folder that extension may read.

From the user's own words that is one DonDocs call and the share; from a
template, two.

### Beyond tools

The server also sends instructions and publishes resources, a prompt,
completions, and structured results. A client that only calls tools is
unaffected.

- **Instructions.** `initialize` carries a paragraph on how the tools fit
  together: look the unit up or rely on the defaults, start from one of the
  named templates or not, render once the facts are in hand, present the
  file, revise with `out`. Hosts pass it to the model as context.
- **Machine defaults.** `dondocs://defaults` is what the config file sets for
  a render that omits `unit`, `signature`, `ssic` or `originatorCode`, plus
  the path of that file. A null unit or SSIC falls back to the built-in
  letterhead and SSIC 5216; a null signature or originator code prints
  nothing.
- **Structured results.** Every tool declares an `outputSchema` and returns the
  same data as `structuredContent` beside its text block. `dondocs_letter`
  returns `{ format, path, bytes }`; the lookup returns its matches, each with
  a `unit` that is a subset of what `dondocs_letter` accepts.
- **A link to the file.** `dondocs_letter` also returns a `resource_link` to
  the written file (`file://` URI, MIME type, size) to clients on protocol
  revision 2025-06-18 or later, where the block exists; older clients get the
  text block alone. The desktop app does not render it; see the round trips
  section for what does put the file in its chat.
- **Templates as resources.** The bundled templates are listed under
  `dondocs://templates/{id}`, titled by name. Reading one returns the same JSON
  as `dondocs_template_get`; the `id` completes.
- **A `draft_letter` prompt.** Optional `docType` and `template`, both with
  completion. Returns the instructions to draft and render that letter; with a
  template, the prompt embeds it as a resource.
- **A unit picker.** When a lookup matches several units and the client has
  declared form elicitation, `dondocs_unit_lookup` asks the user which one and
  returns only that match. Declining, or a client without forms, gets the
  list. Truncated results are not offered as a picker; narrow the query. The
  choices are a titled `oneOf` on 2025-11-25 and later, `enum` with
  `enumNames` before that; on 2026-07-28 the question travels in band and the
  client's capabilities are read from each request.

Nothing is logged over the protocol; diagnostics go to stderr.

### What a caller cannot do

The caller is a model assembling JSON, so the request is treated as hostile.
Every field that reaches the `.tex` is escaped, a reference `letter` must be
one or two lowercase letters, and there is no pass-through for unnamed
generator fields (`formData` used to be one, and could overwrite the
classification banner). Output goes only inside the root: `..`, absolute
paths elsewhere, the root itself, and paths through a symlink are refused
before anything renders. A render that overruns `DONDOCS_RENDER_TIMEOUT_MS` is
cancelled and its engine disposed.

**stdout belongs to the protocol.** Anything printed there that is not a JSON-RPC
message corrupts the session and the client drops the connection. Two things in
this repo used to do exactly that — the vite texlive banner and the engine
worker's own logging — and both now go to stderr. If you add logging anywhere
the companion can reach, use `console.error`.
`tests/integration/companion-mcp.test.ts` parses every stdout line and fails on
anything that is not a protocol message.

That is why the registration above runs the entry point directly. `npm run`
announces the script on **stdout**, so a registration through npm needs
`--silent` or every session opens with two non-protocol lines. Clients tried
here skipped them and connected, but that is their leniency rather than the
contract.

## DOCX is converted by a different pandoc

The app vendors a pandoc 3.9 WASM build; the companion spawns whatever pandoc is
on `PATH`, so output can differ from a browser export in ways this code cannot
see. `GET /health` reports both versions and flags a mismatch.

Not a new compromise: `tests/_helpers/compileDocx.ts` spawns system pandoc too,
because `pandoc-converter.ts` is browser-bound (window.location, fetch, Blob,
dynamic URL import) and will not import into Node. Closing the gap means porting
it behind a port the way `LatexEngine` was — its own project.

If pandoc is absent, `GET /health` says so and DOCX requests fail cleanly. PDF is
unaffected.
