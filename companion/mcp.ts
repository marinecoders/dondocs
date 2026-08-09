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
import * as z from 'zod';
import { loadDefaults } from './letterInput';
import { OutsideSandboxError, DEFAULT_ROOT } from './outputPath';
import { renderToFile } from './renderToFile';
import { validateLetter } from './validateLetter';
import { systemPandocVersion, VENDORED_PANDOC } from './renderDocx';

const ROOT = process.env.DONDOCS_OUT_ROOT ?? DEFAULT_ROOT;

const paragraph = z.object({
  text: z.string().describe('The paragraph text. Plain prose — numbering is applied for you.'),
  level: z.number().int().min(0).max(7).optional()
    .describe('0 = "1.", 1 = "a.", 2 = "(1)" … through Figure 7-8\'s eight levels. Defaults to 0.'),
  header: z.string().optional().describe('Bold run-in heading before the text.'),
});

const unit = z.object({
  name: z.string().optional(),
  line2: z.string().optional().describe('Second letterhead line, e.g. the parent command.'),
  address: z.string().optional()
    .describe('The whole mailing address as ONE string, e.g. "PSC BOX 20004, QUANTICO VA 22134". Do not split it.'),
  department: z.enum(['usmc', 'navy']).optional(),
  seal: z.enum(['dow', 'dod']).optional(),
});

const signature = z.object({
  first: z.string().optional(), middle: z.string().optional(), last: z.string().optional(),
  rank: z.string().optional(), title: z.string().optional(),
  byDirection: z.boolean().optional(),
});

const letterInput = z.object({
  docType: z.enum(['naval_letter', 'standard_letter', 'memorandum']),
  format: z.enum(['pdf', 'docx']).optional().describe('Defaults to pdf.'),
  out: z.string().optional().describe('Filename inside the output root. Defaults to a slug of the subject.'),

  subject: z.string().optional().describe('The Subj: line. Conventionally all caps.'),
  from: z.string().optional().describe('The From: line, e.g. "Commanding Officer, 1st Battalion, 6th Marines".'),
  to: z.string().optional(),
  via: z.array(z.string()).optional().describe('Each via is its own numbered line.'),

  ssic: z.string().optional(), serial: z.string().optional(),
  date: z.string().optional().describe('Naval format, e.g. "8 Aug 26". Defaults to today.'),
  originatorCode: z.string().optional(),

  paragraphs: z.array(paragraph).optional(),
  references: z.array(z.object({ title: z.string(), url: z.string().optional() })).optional()
    .describe('Lettered (a), (b) … in the order given.'),
  enclosures: z.array(z.object({ title: z.string() })).optional(),
  copyTo: z.array(z.string()).optional(),
  distribution: z.array(z.string()).optional(),

  unit: unit.optional().describe('Omit to use the machine defaults from ~/.dondocs/companion.config.json.'),
  signature: signature.optional().describe('Omit to use the machine defaults.'),
});

const defaults = await loadDefaults();

const handle = serveStdio(() => {
  const server = new McpServer({ name: 'dondocs', version: '1' });

  server.registerTool(
    'dondocs_letter',
    {
      title: 'Write a naval letter',
      description:
        'Render SECNAV M-5216.5 correspondence — naval letter, standard letter or memorandum — to a PDF or DOCX file. '
        + 'Formatting, letterhead, seal, paragraph numbering and the signature block are handled for you; supply content only. '
        + 'Returns the path to the written file, not the document itself. '
        + `Files are written under ${ROOT}.`,
      inputSchema: letterInput,
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
          content: [{
            type: 'text' as const,
            text: `Wrote ${file.format.toUpperCase()} (${file.bytes.toLocaleString()} bytes) to ${file.path}`,
          }],
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
