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
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as z from 'zod';
import { LETTER_TEMPLATES } from '../src/data/templates';
import { lookupUnits } from './unitLookup';
import { loadDefaults } from './letterInput';
import { letterSchema } from './letterSchema';
import { OutsideSandboxError, DEFAULT_ROOT } from './outputPath';
import { renderToFile } from './renderToFile';
import { renderResult, templateListResult, templateResult, unitLookupResult } from './resultSchema';
import { validateLetter } from './validateLetter';
import { systemPandocVersion, VENDORED_PANDOC } from './renderDocx';

const ROOT = process.env.DONDOCS_OUT_ROOT ?? DEFAULT_ROOT;

const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

const defaults = await loadDefaults();

const handle = serveStdio(() => {
  const server = new McpServer({ name: 'dondocs', version: '1' });

  server.registerTool('dondocs_template_list', {
    title: 'List letter templates',
    description: 'List all available letter templates with their ID, name, category, and description. '
      + 'Choose a template matching the user\'s intent, then call dondocs_template_get with its ID. '
      + 'Ask the user if multiple matches are plausible; explain when no template fits.',
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

  server.registerTool('dondocs_template_get', {
    title: 'Get a letter template',
    description: 'Return the complete letter template for an ID from dondocs_template_list. '
      + 'Use it as a starting draft: ask the user for bracketed placeholders and missing correspondence details. '
      + 'Interpret each placeholder in context, preserve supplied facts, and never invent missing information. '
      + 'When ready, pass the completed letter fields to dondocs_letter; omit template metadata (id, name, category, description).',
    inputSchema: z.object({ id: z.string().min(1).describe('Exact template ID from dondocs_template_list.') }).strict(),
    outputSchema: templateResult,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => {
    const template = LETTER_TEMPLATES.find((entry) => entry.id === id);
    if (!template) {
      return {
        content: [{ type: 'text' as const, text: `Unknown template ID: ${id}. Call dondocs_template_list to find available IDs.` }],
        isError: true,
      };
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(template) }], structuredContent: template };
  });

  server.registerTool('dondocs_unit_lookup', {
    title: 'Find a unit mailing address',
    description: 'Search the bundled unit directory by recorded name, abbreviation, MCC, or location. No alias expansion. '
      + 'Pass a selected match\'s unit object directly to dondocs_letter. '
      + 'If multiple units match, ask the user which unit or location they mean; MCC is not always unique. '
      + 'If truncated, narrow the query. If no matches, ask for another name, MCC, or location.',
    inputSchema: z.object({
      query: z.string().trim().min(1).max(200).describe('For example Marine Innovation Unit, Marine Innovation Unit Newburgh, 2/23, or SVP.'),
      limit: z.number().int().min(1).max(50).default(20),
    }).strict(),
    outputSchema: unitLookupResult,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ query, limit }) => {
    try {
      const result = await lookupUnits(query, limit);
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
        'Render SECNAV M-5216.5 correspondence — every letter, memorandum, endorsement and agreement type the app defines; see the docType enum — to a PDF or DOCX file. '
        + 'Formatting, letterhead, seal, paragraph numbering and the signature block are handled for you; supply content only. '
        + 'Returns the path to the written file, not the document itself. '
        + `Files are written under ${ROOT}.`,
      inputSchema: letterSchema,
      outputSchema: renderResult,
      annotations: {
        // It writes a file and nothing else; re-running with the same `out`
        // replaces that file rather than accumulating.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      // The schema catches wrong types; these are the rules it cannot express —
      // chiefly that a letter with neither subject nor body is a blank page, not
      // a document. The HTTP transport enforces the identical set.
      const problems = validateLetter(input);
      if (problems.length) {
        return { content: [{ type: 'text' as const, text: problems.join('; ') }], isError: true };
      }

      try {
        const file = await renderToFile(input, defaults, ROOT);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Wrote ${file.format.toUpperCase()} (${file.bytes.toLocaleString()} bytes) to ${file.path}`,
            },
            // A host that renders links lets the user open the file from the reply.
            {
              type: 'resource_link' as const,
              uri: pathToFileURL(file.path).href,
              name: basename(file.path),
              mimeType: MIME[file.format],
              size: file.bytes,
            },
          ],
          structuredContent: file,
        };
      } catch (err) {
        // Hand the model something it can act on. A sandbox refusal means it
        // chose a bad `out`; anything else is ours and the message says so.
        const message = err instanceof OutsideSandboxError
          ? `${err.message}. Choose a filename inside the output root instead.`
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
