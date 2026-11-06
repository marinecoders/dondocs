import { expect, it } from 'vitest';
import fc from 'fast-check';
import { applyPlaceholdersToSession, detectSessionPlaceholders } from '@/lib/placeholders';
import type { SerializedSession } from '@/stores/documentStore';
import { fixtureInstance } from '../_helpers/formFixture';

function session(): SerializedSession {
  return {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'i_type', formType: 'navmc_10274', timestamp: 123,
    formData: { subject: '{{NAME}}', fontFamily: '{{FONT}}', seniorCommandName: '{{HIDDEN}}', signatureImage: { name: 'signature.png', size: 1, data: '{{IMAGE}}' } },
    paragraphs: [{ text: '{{BODY}}', header: '{{HEADING}}', level: 0, tableFootnotes: [{ id: '{{ROW_ID}}', text: '{{FOOTNOTE}}' }] }],
    references: [], enclosures: [{ title: 'Attachment', fileRef: { id: '{{ASSET}}', name: '{{FILENAME}}.pdf', type: '', size: 1 } }],
    copyTos: [], distributions: [{ text: '{{DIST}}' }], endItems: [{ id: '{{PRINTED}}', nsn: '', tamcn: '', model: '' }],
    publicationTables: { parts: [{ values: { description: '{{TABLE}}' } }] },
  };
}

it('detects exactly the fields it can replace, including headings, distributions, tables, and printed identifiers', () => {
  const source = session();
  const names = detectSessionPlaceholders(source);
  expect(names.sort()).toEqual(['BODY', 'DIST', 'FOOTNOTE', 'HEADING', 'NAME', 'PRINTED', 'TABLE']);
  const result = applyPlaceholdersToSession(source, Object.fromEntries(names.map(name => [name, `VALUE_${name}`])));
  expect(detectSessionPlaceholders(result)).toEqual([]);
  expect(result.formData.fontFamily).toBe('{{FONT}}');
  expect(result.formData.seniorCommandName).toBe('{{HIDDEN}}');
  expect(result.formData.signatureImage!.data).toBe('{{IMAGE}}');
  expect(result.enclosures[0].fileRef!.id).toBe('{{ASSET}}');
  expect(result.paragraphs[0].tableFootnotes![0].id).toBe('{{ROW_ID}}');
  expect(source.paragraphs[0].header).toBe('{{HEADING}}');
  expect(source.timestamp).toBe(result.timestamp);
});

it('replaces configured free-text answers and repeated rows without changing options or booleans', () => {
  const source = session();
  const form = fixtureInstance();
  form.answers = { name: '{{NAME}}', decision: 'yes', a: true };
  form.rows.roster = [{ id: 'row', answers: { grade: 'e1', date: '{{DATE}}' } }];
  Object.assign(source, { documentCategory: 'forms', formType: 'fixture', genericForm: form });
  expect(detectSessionPlaceholders(source).sort()).toEqual(['DATE', 'NAME']);
  const result = applyPlaceholdersToSession(source, { NAME: 'SAMPLE', DATE: '2026-11-06' });
  expect(result.genericForm!.answers).toEqual({ name: 'SAMPLE', decision: 'yes', a: true });
  expect(result.genericForm!.rows.roster[0]).toEqual({ id: 'row', answers: { grade: 'e1', date: '2026-11-06' } });
  expect(result.genericForm!.definition).toEqual(form.definition);
  expect(form.answers.name).toBe('{{NAME}}');
});

it('preserves owned structure and remains idempotent for replacement values without tokens', () => {
  fc.assert(fc.property(fc.stringMatching(/^[A-Za-z0-9 ]{0,30}$/), value => {
    const source = session();
    const before = structuredClone(source);
    const values = Object.fromEntries(detectSessionPlaceholders(source).map(name => [name, value]));
    const first = applyPlaceholdersToSession(source, values);
    expect(applyPlaceholdersToSession(first, values)).toEqual(first);
    expect(source).toEqual(before);
    expect(first.enclosures[0].fileRef).toEqual(source.enclosures[0].fileRef);
  }), { numRuns: 40 });
});
