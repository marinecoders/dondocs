/**
 * The doc type lists agree with the things they gate.
 *
 * Three lists have to line up: what the companion accepts (DOC_TYPES), what the
 * app can render (DOC_TYPE_CONFIG), and what the template tools hand out
 * (LETTER_TEMPLATES). Each check here is a set comparison, no compile and no
 * toolchain, so it belongs in the suite that runs on every push rather than
 * the one that needs pdflatex.
 */
import { describe, it, expect } from 'vitest';
import { DOC_TYPES, validateLetter } from '../../companion/validateLetter';
import { templateFor } from '../../companion/letterInput';
import { letterSchema } from '../../companion/letterSchema';
import { DOC_TYPE_CONFIG } from '../../src/types/document';
import { LETTER_TEMPLATES } from '../../src/data/templates';

describe('the advertised docTypes exist', () => {
  // memorandum was advertised for the life of the feature with no template
  // behind it; this is the check that would have caught it when written.
  it.each(DOC_TYPES)('%s is a doc type the app defines', (docType) => {
    const known = Object.keys(DOC_TYPE_CONFIG);
    const resolved = templateFor(docType);
    expect(known, `${docType} resolves to ${resolved}, which the app does not define`).toContain(resolved);
  });
});

describe('bundled templates identify their supported export path', () => {
  // The mirror of the suite above: that one holds what we advertise against
  // what the app defines; this holds what we hand out against what we accept.
  // dondocs_template_get returns a template for an agent to fill in and send to
  // dondocs_letter, so a template naming a docType outside DOC_TYPES is a dead
  // end the agent only discovers on the last step.
  it.each(LETTER_TEMPLATES.map((t) => [t.id, t.docType] as const))(
    '%s has a supported export path (%s)',
    (id, docType) => {
      if (docType === 'i_type') {
        expect(validateLetter({ docType, subject: 'TEST' })).toContain(
          'I-Type export requires the DonDocs web editor and its publication checks.',
        );
        expect(letterSchema.safeParse({ docType, subject: 'TEST' }).success).toBe(false);
        return;
      }
      expect(DOC_TYPES, `template ${id} names ${docType}, which dondocs_letter rejects`).toContain(docType);
    },
  );
});

describe('the two front doors accept the same docTypes', () => {
  // The schema enum is derived from DOC_TYPES so they cannot drift; this pins
  // that derivation so a future edit cannot quietly restate the list.
  it('publishes exactly DOC_TYPES', () => {
    const shape = letterSchema.shape.docType;
    expect([...shape.options]).toEqual([...DOC_TYPES]);
  });
});
