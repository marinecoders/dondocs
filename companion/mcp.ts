/**
 * The companion as an MCP server, over stdio.
 *
 *   npm run companion:mcp
 *
 * Second front door onto the same renderer: `server.ts` serves HTTP clients,
 * this serves MCP ones. Both go through `renderToFile` and `validateLetter`, so
 * neither the sandbox nor the rules can drift between them.
 *
 * MCP earns its keep two ways HTTP cannot — the client runs the process itself,
 * so there is nothing to leave running, and the input schema is published, so a
 * model reads the field names instead of guessing them.
 *
 * stdout is the JSON-RPC channel; every diagnostic here goes to stderr.
 */
import {
  CLIENT_CAPABILITIES_META_KEY, LATEST_PROTOCOL_VERSION, McpServer, PROTOCOL_VERSION_META_KEY, ProtocolError, ProtocolErrorCode,
  ResourceNotFoundError, ResourceTemplate, completable, inputRequired, inputResponse,
} from '@modelcontextprotocol/server';
import type { ClientCapabilities, ServerContext } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as z from 'zod';
import { LETTER_TEMPLATES } from '../src/data/templates';
import { lookupUnits } from './unitLookup';
import { CONFIG_PATH, loadDefaults } from './defaults';
import { letterSchema } from './letterSchema';
import { OutsideSandboxError, outputRoot, resolveOutputPath } from './outputPath';
import { getUiCapability, registerAppResource, RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY } from '@modelcontextprotocol/ext-apps/server';
import { APP_URI, loadAppPage } from './appPage';
import { OutputWriteError, renderToFile } from './renderToFile';
import { renderResult, templateListResult, templateResult, unitLookupResult } from './resultSchema';
import { DOC_TYPES, ENDORSEMENT_TYPES, validateLetter } from './validateLetter';
import { systemPandocVersion, VENDORED_PANDOC } from './renderDocx';

const ROOT = outputRoot();

const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

// The SDK negotiates every revision it lists but does not translate results,
// so anything a revision does not define has to be left out for that client.
// 2025-era connections negotiate once at initialize; 2026-07-28 requests
// carry the revision and the client's capabilities in their _meta envelope.
const envelope = (ctx: ServerContext) => (ctx.mcpReq.envelope ?? {}) as Record<string, unknown>;
const revisionOf = (server: McpServer, ctx: ServerContext): string =>
  (envelope(ctx)[PROTOCOL_VERSION_META_KEY] as string | undefined)
  ?? server.server.getNegotiatedProtocolVersion() ?? LATEST_PROTOCOL_VERSION;

/** Whether the client can put a form in front of the user. Elicitation dates
 * from 2025-06-18; a bare `elicitation: {}` means form mode. */
const clientCanElicit = (server: McpServer, ctx: ServerContext): boolean => {
  if (revisionOf(server, ctx) < '2025-06-18') { return false; }
  const declared = ((envelope(ctx)[CLIENT_CAPABILITIES_META_KEY] as ClientCapabilities | undefined)
    ?? server.server.getClientCapabilities())?.elicitation;
  return !!declared && (declared.form !== undefined || declared.url === undefined);
};

/** Wraps prompt arguments so a request without the optional `arguments`
 * member reads as {}: the SDK validates the missing member as undefined,
 * which an object schema refuses even when every field is optional. */
// Whether the host renders MCP Apps: it says so at initialize, or, on
// 2026-07-28, in each request's envelope.
const clientRendersPages = (server: McpServer, ctx: ServerContext): boolean => getUiCapability(
  (envelope(ctx)[CLIENT_CAPABILITIES_META_KEY] as ClientCapabilities | undefined) ?? server.server.getClientCapabilities(),
) !== undefined;

const optionalArgs = <T extends z.ZodObject>(schema: T): T => ({
  shape: schema.shape,
  '~standard': { ...schema['~standard'], validate: (value: unknown) => schema['~standard'].validate(value ?? {}) },
}) as unknown as T;

const TEMPLATE_URI = 'dondocs://templates/{id}';
const templateUri = (id: string) => TEMPLATE_URI.replace('{id}', id);
const templateIds = (prefix: string) => LETTER_TEMPLATES.map((t) => t.id).filter((id) => id.startsWith(prefix));
const TEMPLATE_IDS = templateIds('') as [string, ...string[]];

const defaults = await loadDefaults();

// Handed to the model at connect time: the order the tools go in, which no
// single tool description can say. Every call is a model turn, so the
// template ids are here and the render is asked for early: a letter from the
// user's own words is one call, from a template two.
const INSTRUCTIONS = `DonDocs renders SECNAV M-5216.5 correspondence with dondocs_letter; files are written under ${ROOT}. `
  + 'Settle the originating unit first: omit unit to use the machine defaults (read dondocs://defaults to see them), '
  + 'or find one with dondocs_unit_lookup. Give the From and To lines: letters, endorsements and memoranda print the labels even when they are empty. '
  + `To start from a template, call dondocs_template_get with one of ${TEMPLATE_IDS.join(', ')}, or read dondocs://templates/{id}; dondocs_template_list describes them. `
  + 'A render takes under a second, so call dondocs_letter once the facts are in hand rather than drafting in chat first; '
  + 'show the user the file as its result says, and revise by calling dondocs_letter again with the out it reports.';

const handle = serveStdio(() => {
  const server = new McpServer({ name: 'dondocs', version: '1' }, { instructions: INSTRUCTIONS });

  // What the config file sets for a render that omits `unit` or `signature`,
  // and where to change it. The snapshot the renders use, so an edit shows
  // after a restart. Nulls fall through to toStore's built-in fallbacks.
  server.registerResource('defaults', 'dondocs://defaults', {
    title: 'Machine defaults',
    description: 'The unit, signature, SSIC and originator code the config file sets for a letter that omits them, as loaded at startup, and the path of that file. '
      + 'A null unit or SSIC falls back to a UNITED STATES MARINE CORPS letterhead and SSIC 5216; a null signature or originator code leaves that block empty.',
    mimeType: 'application/json',
  }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({
      path: CONFIG_PATH,
      unit: defaults.unit ?? null,
      signature: defaults.signature ?? null,
      ssic: defaults.ssic ?? null,
      originatorCode: defaults.originatorCode ?? null,
    }) }],
  }));

  server.registerTool('dondocs_template_list', {
    title: 'List letter templates',
    description: 'List the bundled letter templates with their ID, name, category and description. '
      + 'dondocs_template_get names the IDs itself, so when the user\'s wording points to one, skip this and call that. '
      + 'Ask the user if several templates fit; explain when none does.',
    inputSchema: z.object({}).strict(),
    outputSchema: templateListResult,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const templates = LETTER_TEMPLATES.map(({ id, name, category, description }) => ({ id, name, category, description }));
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(templates) }],
      structuredContent: { templates },
    };
  });

  // The same templates as resources, so a host can list and attach one
  // without a tool call. The tools stay: a model driving the flow needs them.
  server.registerResource('template', new ResourceTemplate(TEMPLATE_URI, {
    list: () => ({
      resources: LETTER_TEMPLATES.map(({ id, name, description }) => ({
        uri: templateUri(id), name: id, title: name, description, mimeType: 'application/json',
      })),
    }),
    complete: { id: templateIds },
  }), {
    title: 'Letter template',
    description: 'A bundled letter template: document type, subject, paragraphs with bracketed placeholders, references.',
    mimeType: 'application/json',
  }, async (uri, { id }) => {
    const template = LETTER_TEMPLATES.find((entry) => entry.id === id);
    if (!template) { throw new ResourceNotFoundError(uri.href); }
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(template) }] };
  });

  // A rendered file, for the page below to read back through the host. Only
  // what this process wrote: the root is a write sandbox a person may point
  // at a broad folder, and a read of anything under it would be a way out
  // for whatever the model was talked into asking for. Nothing is listed.
  const FILE_MIME: Record<string, string> = { '.pdf': MIME.pdf, '.docx': MIME.docx };
  const written = new Set<string>();
  server.registerResource('file', new ResourceTemplate('dondocs://files/{out}', { list: undefined }), {
    title: 'Rendered letter',
    description: 'A file dondocs_letter wrote in this session, by the out it reported.',
  }, async (uri, { out }) => {
    // The template matcher hands the segment over as written; a nested name
    // arrives percent-encoded, since a bare slash would not match.
    let path: string;
    try { path = resolveOutputPath(decodeURIComponent(String(out)), ROOT); } catch { throw new ResourceNotFoundError(uri.href); }
    if (!written.has(path)) { throw new ResourceNotFoundError(uri.href); }
    let bytes: Buffer;
    try { bytes = await readFile(path); } catch { throw new ResourceNotFoundError(uri.href); }
    return { contents: [{ uri: uri.href, mimeType: FILE_MIME[extname(path)] ?? 'application/octet-stream', blob: bytes.toString('base64') }] };
  });

  // The card a page-rendering host shows in place of the text: a built file
  // beside the entry, so a source run offers none and says so once.
  const page = loadAppPage();
  if (page) {
    registerAppResource(server, 'letter-page', APP_URI, { title: 'Letter card' }, async () => ({
      contents: [{ uri: APP_URI, mimeType: RESOURCE_MIME_TYPE, text: page }],
    }));
  } else {
    console.error('dondocs: no built page beside the entry; render results are text only');
  }

  // A starting point a host can offer by name. Both arguments complete, so a
  // user picks a type or a template without knowing the ids.
  server.registerPrompt('draft_letter', {
    title: 'Draft a naval letter',
    description: 'Draft correspondence of a given document type, optionally from a bundled template, and render it with dondocs_letter.',
    argsSchema: optionalArgs(z.object({
      docType: completable(
        z.enum(DOC_TYPES as [string, ...string[]]).describe('Document type; defaults to the template\'s own.'),
        (value) => DOC_TYPES.filter((type) => type.startsWith(value)),
      ).optional(),
      template: completable(z.string().describe('Template ID from dondocs_template_list.'), templateIds).optional(),
    })),
  }, async ({ docType, template: id }) => {
    const template = id === undefined ? undefined : LETTER_TEMPLATES.find((entry) => entry.id === id);
    if (id !== undefined && !template) { throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown template ID: ${id}`); }
    const type = docType ?? template?.docType;
    const text = [
      type
        ? `Draft a document of type "${type}" with DonDocs.`
        : 'Draft naval correspondence with DonDocs. Ask me which document type fits before writing; dondocs_letter lists them in its docType enum.',
      template
        ? `Start from the "${template.name}" template attached below: keep its structure, fill each bracketed placeholder from what I tell you, and ask for the From and To lines and anything else it needs that I have not given.`
        : 'Ask me for the From and To lines, the subject, and what the letter needs to say, then write the paragraphs.',
      'For the originating unit, use the machine defaults (dondocs://defaults) or look it up with dondocs_unit_lookup; do not guess an address. Confirm the addressee with me.',
      ...(type && ENDORSEMENT_TYPES.includes(type)
        ? ['Ask me for the endorsement ordinal (FIRST, SECOND ...) and the identification of the letter being endorsed, and pass them as endorsement.ordinal and endorsement.basicLetterId; the render is refused without them.']
        : []),
      `Render with dondocs_letter${type ? ` using docType "${type}"` : ''}; its result says how to show me the file.`,
    ].join(' ');
    return {
      messages: [
        { role: 'user' as const, content: { type: 'text' as const, text } },
        ...(template ? [{
          role: 'user' as const,
          content: {
            type: 'resource' as const,
            resource: { uri: templateUri(template.id), mimeType: 'application/json', text: JSON.stringify(template) },
          },
        }] : []),
      ],
    };
  });

  server.registerTool('dondocs_template_get', {
    title: 'Get a letter template',
    description: 'Return the complete letter template for an ID; dondocs_template_list describes each. '
      + 'Use it as a starting draft: ask the user for bracketed placeholders and missing correspondence details. '
      + 'Interpret each placeholder in context, preserve supplied facts, and never invent missing information. '
      + 'When ready, pass the completed letter fields to dondocs_letter; omit template metadata (id, name, category, description). '
      + 'An endorsement template also needs endorsement.ordinal and endorsement.basicLetterId.',
    inputSchema: z.object({ id: z.enum(TEMPLATE_IDS).describe('Template ID.') }).strict(),
    outputSchema: templateResult,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => {
    const template = LETTER_TEMPLATES.find((entry) => entry.id === id);
    // The enum refuses an unknown id before this runs, with the same list.
    if (!template) {
      return {
        content: [{ type: 'text' as const, text: `Unknown template ID: ${id}. The IDs are ${TEMPLATE_IDS.join(', ')}.` }],
        isError: true,
      };
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(template) }], structuredContent: template };
  });

  server.registerTool('dondocs_unit_lookup', {
    title: 'Find a unit mailing address',
    description: 'Search the bundled unit directory by recorded name, abbreviation, MCC, or location. No alias expansion. '
      + 'Pass a selected match\'s unit object directly to dondocs_letter. '
      + 'If the result still lists several units, ask the user which unit or location they mean; MCC is not always unique. '
      + 'If truncated, narrow the query. If no matches, ask for another name, MCC, or location.',
    inputSchema: z.object({
      query: z.string().trim().min(1).max(200).describe('For example Marine Innovation Unit, Marine Innovation Unit Newburgh, 2/23, or SVP.'),
      limit: z.number().int().min(1).max(50).default(20),
    }).strict(),
    outputSchema: unitLookupResult,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ query, limit }, ctx) => {
    try {
      let result = await lookupUnits(query, limit);
      // Several matches and a client that can ask: put the choice to the user
      // instead of the model. The retry carries the answer; a decline, or an
      // answer outside the list, leaves the list as it was.
      if (result.total > 1 && !result.truncated && clientCanElicit(server, ctx)) {
        const answer = inputResponse(ctx.mcpReq.inputResponses, 'unit');
        const chosen = answer.kind === 'elicit' && answer.action === 'accept' ? String(answer.content?.unit ?? '') : '';
        const picked = /^\d+$/.test(chosen) ? result.matches[Number(chosen)] : undefined;
        if (picked) {
          result = { ...result, total: 1, truncated: false, matches: [picked] };
        } else if (answer.kind === 'missing') {
          const indices = result.matches.map((_, i) => String(i));
          const titles = result.matches.map((m) => `${m.unit.name}, ${m.unit.address}${m.mcc ? ` (${m.mcc})` : ''}`);
          // Titled choices are `oneOf` from 2025-11-25; before that, `enum` with `enumNames`.
          const unit = revisionOf(server, ctx) >= '2025-11-25'
            ? { type: 'string' as const, title: 'Unit', oneOf: indices.map((i, k) => ({ const: i, title: titles[k] })) }
            : { type: 'string' as const, title: 'Unit', enum: indices, enumNames: titles };
          return inputRequired({ inputRequests: { unit: inputRequired.elicit({
            message: `${result.total} units match "${query}". Which one?`,
            requestedSchema: { type: 'object', properties: { unit }, required: ['unit'] },
          }) } });
        }
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Unit lookup failed: ${err instanceof Error ? err.message : String(err)}. Retry the lookup; if it continues to fail, provide the unit name and mailing address directly to dondocs_letter.` }],
        isError: true,
      };
    }
  });

  server.registerTool(
    'dondocs_letter',
    {
      title: 'Write a naval letter',
      description:
        'Render SECNAV M-5216.5 correspondence, every letter, memorandum, endorsement and agreement type the app defines (see the docType enum), to a PDF or DOCX file. '
        + 'Formatting, letterhead, seal, paragraph numbering and the signature block are handled for you; supply content only. '
        + 'Returns the path to the written file, not the document itself; the result says how to show the file to the user. '
        + `Files are written under ${ROOT}. `
        + 'A render takes under a second: call this once the facts are in hand, and to revise call it again with out set to the name it reports, which replaces that file.',
      inputSchema: letterSchema,
      outputSchema: renderResult,
      // The link to the page under both keys hosts have read it from, as the
      // SDK's registerAppTool writes it.
      ...(page ? { _meta: { ui: { resourceUri: APP_URI }, [RESOURCE_URI_META_KEY]: APP_URI } } : {}),
      annotations: {
        // It writes one file. A given `out` replaces whatever is there; with
        // `out` omitted the same request adds a numbered file each time.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input, ctx) => {
      // The schema catches wrong types; these are the rules it cannot express —
      // chiefly that a letter with neither subject nor body is a blank page, not
      // a document. The HTTP transport enforces the identical set.
      const problems = validateLetter(input);
      if (problems.length) {
        return { content: [{ type: 'text' as const, text: problems.join('; ') }], isError: true };
      }

      try {
        const file = await renderToFile(input, defaults, ROOT);
        written.add(file.path);
        // A host that renders links lets the user open the file from the
        // reply. The block dates from 2025-06-18; an older client rejects
        // the whole result over it.
        const link = revisionOf(server, ctx) >= '2025-06-18' ? [{
          type: 'resource_link' as const,
          uri: pathToFileURL(file.path).href,
          name: basename(file.path),
          mimeType: MIME[file.format],
          size: file.bytes,
        }] : [];
        return {
          content: [
            {
              type: 'text' as const,
              text: `Wrote ${file.format.toUpperCase()} (${file.bytes.toLocaleString()} bytes) to ${file.path}\n`
                + (page && clientRendersPages(server, ctx)
                  ? 'The letter is shown in the chat as a card. '
                  : 'Show it in the chat: call present_files with the path above, loading that tool first if it is not loaded; give the path only when no such tool exists. ')
                + `To revise, call again with out "${file.out}" to replace it.`,
            },
            ...link,
          ],
          structuredContent: file,
        };
      } catch (err) {
        // Hand the model something it can act on. A sandbox refusal means it
        // chose a bad `out`; anything else is ours and the message says so.
        const message = err instanceof OutsideSandboxError
          ? `${err.message}. Choose a filename inside the output root instead.`
          : err instanceof OutputWriteError ? err.message
            : `Render failed: ${err instanceof Error ? err.message : String(err)}`;
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );

  return server;
});

// stderr, never stdout — stdout belongs to the protocol.
console.error(`dondocs MCP server ready; writing under ${ROOT}`);
void systemPandocVersion().then((v) => {
  if (!v) { console.error('  docx unavailable: pandoc is not on PATH (pdf is unaffected)'); }
  else if (v !== VENDORED_PANDOC) { console.error(`  docx uses system pandoc ${v}; the app vendors ${VENDORED_PANDOC}`); }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { void handle.close().then(() => process.exit(0)); });
}
