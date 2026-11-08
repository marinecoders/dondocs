import { describe, expect, it } from 'vitest';
import type { DocumentSnapshot } from '@/stores/historyStore';
import { useFormStore } from '@/stores/formStore';
import { captureDocumentRevision, copyCapturedDocument, copyCapturedSession } from '@/lib/capturedDocument';
import { capturedTextFields, documentTextFields, mapCapturedText, mapSessionText } from '@/lib/documentFields';
import { projectSharedSession } from '@/lib/documentSerialization';
import { sl3Schema } from '@/data/techpub/sl3';
import { emptySl4 } from '@/data/techpub/sl4';
import { emptyManualFrontMatter } from '@/data/techpub/manualFrontMatter';
import { fixtureInstance } from '../_helpers/formFixture';

const source = { documentId: 'fields', epoch: 1, editSequence: 2, capturedAt: 123 };
function snapshot(patch: Partial<DocumentSnapshot> = {}): DocumentSnapshot {
  return {
    documentMode: 'compliant', documentCategory: 'correspondence', formType: 'navmc_10274', docType: 'naval_letter',
    formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {},
    ...patch,
  };
}
const texts = (fields: ReturnType<typeof documentTextFields>) => fields.map(field => field.text);
const replace = (field: { text: string }) => field.text.replaceAll('{{VALUE}}', 'RESOLVED');

describe('document text ownership and projections', () => {
  it('reads headings, endorsements, distributions, nested tables, and stable dictionary paths', () => {
    const captured = captureDocumentRevision(source, snapshot({
      formData: { appendEndorsement: true, additionalEndorsements: [{ id: 'row-id', endorsementBody: '{{VALUE}} endorsement' }] },
      paragraphs: [{ text: '{{VALUE}} body', header: '{{VALUE}} heading', level: 0, tableFootnotes: [{ id: 'footnote-id', text: '{{VALUE}} footnote' }] }],
      distributions: [{ text: '{{VALUE}} distribution' }],
      references: [{ letter: 'a', title: '{{VALUE}} reference', url: 'https://example.test/{{VALUE}}' }],
    }));
    const before = copyCapturedDocument(captured);
    const mapped = mapCapturedText(captured, replace);
    expect(texts(capturedTextFields(mapped, 'substitution'))).toEqual(expect.arrayContaining([
      'RESOLVED endorsement', 'RESOLVED body', 'RESOLVED heading', 'RESOLVED footnote',
      'RESOLVED distribution', 'RESOLVED reference', 'https://example.test/RESOLVED',
    ]));
    expect(copyCapturedDocument(captured)).toEqual(before);
    expect(copyCapturedDocument(mapped).document.formData.additionalEndorsements![0].id).toBe('row-id');

    const table = copyCapturedSession(captured);
    table.docType = 'i_type';
    table.publicationTables = { 'table.with.dot': [{ values: Object.fromEntries([['__proto__', '{{VALUE}}']]), openPurchase: { manufacturer: '{{VALUE}} maker', address: '{{VALUE}} address' } }] };
    const result = mapSessionText(table, replace);
    expect(result.publicationTables!['table.with.dot'][0].values.__proto__).toBe('RESOLVED');
    expect(Object.getPrototypeOf(result.publicationTables!['table.with.dot'][0].values)).toBe(Object.prototype);
    expect(table.publicationTables['table.with.dot'][0].values.__proto__).toBe('{{VALUE}}');
  });

  it('preserves hidden draft data while selecting fields for the active output', () => {
    const captured = captureDocumentRevision(source, snapshot({ formData: {
      subject: 'Active subject', seniorCommandName: 'Hidden party',
      additionalEndorsements: [{ id: 'hidden-id', endorsementBody: 'Hidden endorsement' }],
    } }));
    expect(texts(capturedTextFields(captured, 'output'))).toContain('Active subject');
    expect(texts(capturedTextFields(captured, 'output'))).not.toContain('Hidden party');
    expect(texts(capturedTextFields(captured, 'share'))).toEqual(expect.arrayContaining(['Hidden party', 'Hidden endorsement']));
    const mapped = mapCapturedText(captured, field => field.text.toUpperCase());
    expect(copyCapturedDocument(mapped).document.formData.seniorCommandName).toBe('Hidden party');
    expect(copyCapturedDocument(mapped).document.formData.additionalEndorsements![0].endorsementBody).toBe('Hidden endorsement');
  });

  it('never transforms asset handles, binary images, control values, or editor buffers', () => {
    const bytes = new Uint8Array([7]);
    const captured = captureDocumentRevision(source, snapshot({
      formData: { fontFamily: '{{VALUE}}', signatureImage: { name: '{{VALUE}}.png', size: 1, data: '{{VALUE}}' } },
      enclosures: [{ title: '{{VALUE}} attachment', fileRef: { id: '{{VALUE}}', name: '{{VALUE}}.pdf', type: 'application/pdf', size: 1 }, file: { name: 'memory.pdf', size: 1, data: bytes.buffer } }],
    }));
    const mapped = mapCapturedText(captured, replace);
    const result = copyCapturedDocument(mapped).document;
    expect(result.enclosures[0].title).toBe('RESOLVED attachment');
    expect(result.enclosures[0].fileRef!.id).toBe('{{VALUE}}');
    expect(result.formData.fontFamily).toBe('{{VALUE}}');
    expect(result.formData.signatureImage!.data).toBe('{{VALUE}}');
    new Uint8Array(result.enclosures[0].file!.data)[0] = 9;
    expect(bytes[0]).toBe(7);
    expect(new Uint8Array(copyCapturedDocument(mapped).document.enclosures[0].file!.data)[0]).toBe(7);
    expect(texts(capturedTextFields(captured, 'backup'))).toContain('{{VALUE}}.pdf');
    expect(texts(capturedTextFields(captured, 'share'))).not.toContain('{{VALUE}}.pdf');
  });

  it.each(['navmc_10274', 'navmc_118_11'] as const)('reads and maps %s signature statements without images or the inactive form', formType => {
    const forms = useFormStore.getState();
    const selected = structuredClone(formType === 'navmc_10274' ? forms.navmc10274 : forms.navmc11811);
    selected.signatureBlocks = [{ name: '{{VALUE}} signer', statement: '{{VALUE}} statement', style: 'image', image: '{{VALUE}} bytes' }];
    const captured = captureDocumentRevision(source, snapshot({ documentCategory: 'forms', formType,
      forms: { includeCoverPage: true, ...(formType === 'navmc_10274' ? { navmc10274: selected as typeof forms.navmc10274 } : { navmc11811: selected as typeof forms.navmc11811 }) },
    }));
    const result = copyCapturedSession(mapCapturedText(captured, replace));
    const form = formType === 'navmc_10274' ? result.forms!.navmc10274! : result.forms!.navmc11811!;
    expect(form.signatureBlocks[0]).toMatchObject({ name: 'RESOLVED signer', statement: 'RESOLVED statement', style: 'image', image: '{{VALUE}} bytes' });
    expect(result.forms!.includeCoverPage).toBe(true);
  });

  it('maps configured answers and rows while preserving choices, booleans, schema, and row identity', () => {
    const form = fixtureInstance();
    form.answers = { name: '{{VALUE}}', decision: 'yes', a: true };
    form.rows.roster = [{ id: 'row-1', answers: { grade: 'e1', date: '{{VALUE}}' } }];
    const captured = captureDocumentRevision(source, snapshot({ documentCategory: 'forms', formType: 'fixture', genericForm: form }));
    const result = copyCapturedDocument(mapCapturedText(captured, replace)).document.genericForm!;
    expect(result.answers).toEqual({ name: 'RESOLVED', decision: 'yes', a: true });
    expect(result.rows.roster[0]).toEqual({ id: 'row-1', answers: { grade: 'e1', date: 'RESOLVED' } });
    expect(result.definition).toEqual(form.definition);
    expect(texts(capturedTextFields(captured, 'output'))).toContain('Yes');
    expect(texts(capturedTextFields(captured, 'search'))).toContain('E-1');
  });

  it('keeps unanswered form labels and yes/no answers searchable without making them transformable', () => {
    const form = fixtureInstance();
    form.answers = { a: false };
    const captured = captureDocumentRevision(source, snapshot({ documentCategory: 'forms', formType: 'fixture', genericForm: form }));
    expect(texts(capturedTextFields(captured, 'search'))).toEqual(expect.arrayContaining(['Fixture form', 'Name', 'No', 'Roster']));
    const result = copyCapturedDocument(mapCapturedText(captured, field => `CHANGED ${field.text}`)).document.genericForm!;
    expect(result.answers).toEqual({ a: false });
    expect(result.definition.label).toBe('Fixture form');
  });

  it('gives repeated answers distinct locations for operation findings', () => {
    const form = fixtureInstance();
    form.rows.roster = [1, 2].map(index => ({ id: `row-${index}`, answers: { date: '2000-01-01' } }));
    const captured = captureDocumentRevision(source, snapshot({ documentCategory: 'forms', formType: 'fixture', genericForm: form }));
    const dates = capturedTextFields(captured, 'share').filter(field => field.text === '2000-01-01');
    expect(dates).toHaveLength(2);
    expect(new Set(dates.map(field => field.label)).size).toBe(2);
  });

  it('includes technical text and printed item identifiers while preserving structural identities', () => {
    const sl3 = sl3Schema.parse({ components: [{ id: 'component-id', category: 'ssri', nomenclature: '{{VALUE}} component' }] });
    const sl4 = emptySl4();
    sl4.cages = [{ id: 'cage-id', code: '{{VALUE}}', name: '{{VALUE}} supplier', address: '{{VALUE}} address', portionMarking: 'U' }];
    for (const [docType, formData, expected] of [
      ['sl3', { sl3 }, 'RESOLVED component'], ['sl4', { sl4 }, 'RESOLVED supplier'],
    ] as const) {
      const captured = captureDocumentRevision(source, snapshot({ docType, formData, endItems: [{ id: '{{VALUE}} item', nsn: '', tamcn: '', model: '' }] }));
      const result = mapCapturedText(captured, replace);
      expect(texts(capturedTextFields(result, 'output'))).toEqual(expect.arrayContaining([expected, 'RESOLVED item']));
      const document = copyCapturedDocument(result).document;
      expect(docType === 'sl3' ? document.formData.sl3!.components[0].id : document.formData.sl4!.cages[0].id).toMatch(/-id$/);
    }
  });

  it('keeps shared projections detached from later editor mutations', () => {
    const session = copyCapturedSession(captureDocumentRevision(source, snapshot({ formData: {
      appendEndorsement: true, additionalEndorsements: [{ id: 'endorsement', endorsementBody: 'CAPTURED' }],
    } })));
    const shared = projectSharedSession(session);
    session.formData.additionalEndorsements![0].endorsementBody = 'LATER';
    expect(shared.formData.additionalEndorsements![0].endorsementBody).toBe('CAPTURED');
  });

  it('preserves joint memorandum fallback fields alongside its own signer fields', () => {
    const captured = captureDocumentRevision(source, snapshot({ docType: 'joint_memorandum', formData: {
      jointSubject: '{{VALUE}} legacy subject', jointSeniorFrom: '{{VALUE}} legacy sender',
      jointMemoSeniorSigName: '{{VALUE}} memo signer',
    } }));
    expect(texts(capturedTextFields(mapCapturedText(captured, replace), 'output'))).toEqual(expect.arrayContaining([
      'RESOLVED legacy subject', 'RESOLVED legacy sender', 'RESOLVED memo signer',
    ]));
  });

  it('maps manual end-item text without changing row identity or selection values', () => {
    const manualFrontMatter = emptyManualFrontMatter();
    manualFrontMatter.endItems = [{ rowId: 'row-id', nsn: '{{VALUE}}', tamcn: '', id: '{{VALUE}} printed identifier', model: '' }];
    const captured = captureDocumentRevision(source, snapshot({ docType: 'tm_ietm_front_matter', formData: { manualFrontMatter } }));
    const result = copyCapturedDocument(mapCapturedText(captured, replace)).document.formData.manualFrontMatter!;
    expect(result.endItems[0]).toMatchObject({ rowId: 'row-id', nsn: 'RESOLVED', id: 'RESOLVED printed identifier' });
    expect(result.subtype).toBe('tm');
    expect(manualFrontMatter.endItems[0].nsn).toBe('{{VALUE}}');
  });

  it('leaves the source untouched when a transform fails after processing earlier fields', () => {
    const session = copyCapturedSession(captureDocumentRevision(source, snapshot({ formData: { subject: 'SUBJECT' }, paragraphs: [{ text: 'BODY', level: 0 }] })));
    const before = structuredClone(session);
    expect(() => mapSessionText(session, field => {
      if (field.text === 'BODY') throw new Error('Transform failed');
      return 'CHANGED';
    })).toThrow('Transform failed');
    expect(session).toEqual(before);
  });

  it('makes result paths immutable, preserves unknown transfer fields, and rejects cycles and unsupported form schemas', () => {
    const session = copyCapturedSession(captureDocumentRevision(source, snapshot()));
    Object.assign(session.formData, { legacyText: '{{VALUE}} legacy' });
    const field = documentTextFields(session, 'share').find(field => field.text === '{{VALUE}} legacy')!;
    expect(() => (field.path as string[]).push('other')).toThrow();
    expect(mapSessionText(session, replace).formData).toHaveProperty('legacyText', '{{VALUE}} legacy');
    Object.assign(session.formData, { cycle: session.formData });
    expect(() => documentTextFields(session, 'share')).toThrow('cycle');
    const form = fixtureInstance();
    Object.assign(form.definition, { schemaVersion: 999 });
    expect(() => documentTextFields(snapshot({ documentCategory: 'forms', formType: 'fixture', genericForm: form }), 'output')).toThrow();
  });
});
