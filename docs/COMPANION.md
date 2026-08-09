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

## Machine defaults

A unit is a property of the box, not of the request. Put yours in
`~/.dondocs/companion.config.json` and an agent stops restating it on every call:

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

A missing file is normal, not an error — built-in fallbacks keep a fresh install
rendering. Precedence is **request > config > fallback** at every field, so a
caller can override the unit for one letter without editing anything.

Override the location with `DONDOCS_CONFIG`, the port with `DONDOCS_PORT`, and
the output root with `DONDOCS_OUT_ROOT`.

`DONDOCS_RENDER_TIMEOUT_MS` bounds a render — 45s, covering both formats and
both transports. The number is set against the caller's patience rather than
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

Register it with the client. For Claude Desktop that is
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS —
check your client's own docs, since the location and key differ between them:

```json
{
  "mcpServers": {
    "dondocs": {
      "command": "npm",
      "args": ["--prefix", "/absolute/path/to/dondocs", "run", "companion:mcp"],
      "env": { "DONDOCS_OUT_ROOT": "/Users/you/Documents/DonDocs" }
    }
  }
}
```

One tool is exposed, `dondocs_letter`. It takes the same fields as `/generate`
and returns the path it wrote. A filename outside the output root comes back as
a tool error the model can read and retry, not a protocol failure.

**stdout belongs to the protocol.** Anything printed there that is not a JSON-RPC
message corrupts the session and the client drops the connection. Two things in
this repo used to do exactly that — the vite texlive banner and the engine
worker's own logging — and both now go to stderr. If you add logging anywhere
the companion can reach, use `console.error`.
`tests/integration/companion-mcp.test.ts` parses every stdout line and fails on
anything that is not a protocol message.

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
