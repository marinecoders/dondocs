/**
 * Everything the companion advertises actually renders.
 *
 * The docTypes x formats cross product, each rendered for real. `memorandum` was
 * advertised for the life of the feature without ever producing a PDF; DOCX
 * reads no doc-type template, so it succeeded and the type looked healthy.
 *
 * The second suite needs no toolchain: a doc type the app does not define cannot
 * render, and that is knowable without compiling anything.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadDefaults, templateFor, type CompanionDefaults } from '../../companion/letterInput';
import { renderToFile } from '../../companion/renderToFile';
import { DOC_TYPES, FORMATS } from '../../companion/validateLetter';
import { DOC_TYPE_CONFIG } from '../../src/types/document';
import { LETTER_TEMPLATES } from '../../src/data/templates';

/** DOCX needs pandoc; PDF does not. Skipping is honest, silence is not. */
const hasPandoc = spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;

/** The first bytes of each format, so a zero-length or truncated file cannot pass. */
const MAGIC: Record<string, string> = { pdf: '%PDF', docx: 'PK' };

let root: string;
let defaults: CompanionDefaults;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dondocs-matrix-'));
  // A machine config would make the result depend on the box it ran on.
  process.env.DONDOCS_CONFIG = '/nonexistent/companion.config.json';
  defaults = await loadDefaults();
}, 60_000);

afterAll(async () => {
  if (root) { await rm(root, { recursive: true, force: true }); }
});

const MATRIX = DOC_TYPES.flatMap((docType) => FORMATS.map((format) => [docType, format] as const));

describe('the advertised surface', () => {
  it('advertises at least one docType and one format', () => {
    expect(DOC_TYPES.length).toBeGreaterThan(0);
    expect(FORMATS.length).toBeGreaterThan(0);
  });

  it.each(MATRIX)('renders docType %s as %s', async (docType, format) => {
    if (format === 'docx' && !hasPandoc) {
      console.warn(`[surface-matrix] pandoc missing - ${docType}/docx SKIPPED locally.`);
      expect(Boolean(process.env.CI), 'CI must install pandoc; without it these cases prove nothing.').toBe(false);
      return;
    }

    const file = await renderToFile(
      {
        docType,
        format: format as 'pdf' | 'docx',
        out: `${docType}.${format}`,
        subject: `SURFACE CHECK ${docType.toUpperCase()}`,
        from: 'Commanding Officer, Test Unit',
        to: 'Commanding General, Test Command',
        paragraphs: [{ text: 'Every advertised combination is expected to produce a real document.' }],
      } as never,
      defaults,
      root,
    );

    const bytes = await readFile(file.path);
    expect(bytes.subarray(0, MAGIC[format].length).toString('latin1')).toBe(MAGIC[format]);
    // A floor against a "successful" render of nothing: a letterhead-only page
    // is a few kilobytes, a real letter far more.
    expect(bytes.byteLength).toBeGreaterThan(4_000);
  }, 200_000);
});

describe('the advertised docTypes exist', () => {
  // No compile, no toolchain. The cheap half of the suite above.
  it.each(DOC_TYPES)('%s is a doc type the app defines', (docType) => {
    const known = Object.keys(DOC_TYPE_CONFIG);
    const resolved = templateFor(docType);
    expect(known, `${docType} resolves to ${resolved}, which the app does not define`).toContain(resolved);
  });
});

describe('every bundled template is renderable', () => {
  // The mirror of the suite above: that one holds what we advertise against
  // what the app defines; this holds what we hand out against what we accept.
  // dondocs_template_get returns a template for an agent to fill in and send to
  // dondocs_letter, so a template naming a docType outside DOC_TYPES is a dead
  // end the agent only discovers on the last step.
  it.each(LETTER_TEMPLATES.map((t) => [t.id, t.docType] as const))(
    '%s asks for a docType the companion accepts (%s)',
    (id, docType) => {
      expect(DOC_TYPES, `template ${id} names ${docType}, which dondocs_letter rejects`).toContain(docType);
    },
  );
});
