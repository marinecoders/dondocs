// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { companionPublication } from '../_helpers/companionPublication';
import { letterSchema } from '../../companion/letterSchema';
import { toStore } from '../../companion/letterInput';
import { validateLetter } from '../../companion/validateLetter';
import { validate } from '../../companion/handler';
import { handoffUrl } from '../../companion/handoff';
import { decodeHandoff } from '../../src/lib/localHandoff';

it.each(['MI', 'TI', 'SI', 'LI'] as const)('accepts a complete %s through both transports', (type) => {
  const input = companionPublication(type);
  const parsed = letterSchema.parse(input);
  expect(validateLetter(parsed)).toEqual([]);
  expect(validate(input)).toEqual([]);
  expect(toStore(parsed)).toEqual(toStore(input));
  expect(toStore(parsed).formData).toMatchObject({ publicationType: type, signatureType: 'digital' });
});

it('applies machine defaults before publication validation', () => {
  const input = companionPublication();
  const defaults = { unit: input.unit, signature: input.signature };
  delete input.unit; delete input.signature;
  expect(validateLetter(input, defaults)).toEqual([]);
  expect(validate(input, defaults)).toEqual([]);
  expect(validateLetter(input).join(' ')).toMatch(/Issuing command|Signatory/);
});

it('rejects incomplete publication data, incompatible distribution and DOCX', () => {
  const input = companionPublication();
  input.publication!.pcn = '';
  input.publication!.exportRestricted = true;
  expect(validateLetter(input).join(' ')).toMatch(/PCN/);
  expect(validateLetter(input).join(' ')).toMatch(/export-control/);
  input.format = 'docx';
  expect(validateLetter(input)).toContain('I-Type export supports PDF only.');
});

it('retains structured paragraphs, table rows and authentication fields', () => {
  const input = companionPublication();
  input.publication!.tables = { majorItems: [{ values: { description: 'CONTROLLER', softwareVersion: 'v2', id: '12345A', tamcn: 'A02557G' } }] };
  input.paragraphs!.push({ text: '', level: 0, header: 'Major Items Affected', tableKey: 'majorItems', tableIdentifierMode: 'software', tableFootnotes: [{ id: '1', text: 'Test note.' }] });
  input.classification = { basis: 'derivative', classifiedBy: 'Test classifier', derivedFrom: 'Test source' };
  const store = toStore(letterSchema.parse(input));
  expect(store.publicationTables).toEqual(input.publication!.tables);
  expect(store.paragraphs.at(-1)).toEqual(input.paragraphs!.at(-1));
  expect(store.formData.classificationBasis).toBe('derivative');
});

it('refuses missing and duplicate attachment IDs and invalid encoded bytes', () => {
  const input = companionPublication();
  input.paragraphs!.push({ text: 'Bracket drawing', figure: { fileId: 'drawing' } });
  expect(validateLetter(input).join(' ')).toContain('Attachment "drawing" is missing');
  const file = { id: 'drawing', name: 'drawing.pdf', mimeType: 'application/pdf' as const, dataBase64: 'dGVzdA==' };
  input.attachments = [file, file];
  expect(validateLetter(input).join(' ')).toContain('Duplicate attachment ID');
  file.dataBase64 = 'not base64!';
  expect(letterSchema.safeParse(input).success).toBe(false);
});

it('rejects unknown publication and table-column fields instead of dropping them', () => {
  const input = companionPublication();
  expect(letterSchema.safeParse({ ...input, publication: { ...input.publication, pnc: 'typo' } }).success).toBe(false);
  expect(letterSchema.safeParse({ ...input, publication: { ...input.publication, tables: { majorItems: [{ values: { softwareVerison: 'v1' } }] } } }).success).toBe(false);
});

describe('publication handoff', () => {
  it('keeps publication fields when opening a text-only draft in the editor', () => {
    const input = companionPublication();
    const url = handoffUrl(input, {}, 'https://example.test')!;
    const session = decodeHandoff(url.split('#d=')[1]);
    expect(session?.formData.shortTitle).toBe(input.publication!.shortTitle);
    expect(session?.endItems).toEqual(input.publication!.endItems);
  });
  it('does not offer a handoff that drops files or exposes classified portions', () => {
    const input = companionPublication();
    input.attachments = [{ id: 'drawing', name: 'drawing.pdf', mimeType: 'application/pdf', dataBase64: 'dGVzdA==' }];
    expect(handoffUrl(input, {}, 'https://example.test')).toBeUndefined();
    delete input.attachments;
    input.paragraphs![0].portionMarking = 'S';
    expect(handoffUrl(input, {}, 'https://example.test')).toBeUndefined();
  });
});

it('refuses table data the selected layout would not print', () => {
  const input = companionPublication();
  input.publication!.tables = { misspelled: [] };
  expect(validateLetter(input).join(' ')).toContain('Unknown publication table');
  input.publication!.tables = { majorItems: [{ values: { description: 'BRACKET', qty: '2' } }] };
  expect(validateLetter(input).join(' ')).toContain('column "qty" is not supported');
});

it('validates a large attachment without overflowing the parser stack', () => {
  const input = companionPublication();
  input.attachments = [{ id: 'large', name: 'drawing.pdf', mimeType: 'application/pdf', dataBase64: 'A'.repeat(8_000_000) }];
  expect(letterSchema.safeParse(input).success).toBe(true);
  input.attachments[0].dataBase64 = 'AAA';
  expect(letterSchema.safeParse(input).success).toBe(false);
});
