import { describe, it, expect } from 'vitest';
import { sessionSearchFields, findSearchMatch, matchesSearch } from '@/lib/workspaceSearch';
import { getEditorSections } from '@/lib/editorSections';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { useFormStore } from '@/stores/formStore';
import type { SerializedSession } from '@/stores/documentStore';
import { sl3Schema } from '@/data/techpub/sl3';
import { fixtureInstance } from '../_helpers/formFixture';

const session = (patch: Partial<SerializedSession> = {}): SerializedSession => ({
  documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
  formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], timestamp: 0, ...patch,
});

describe('workspace full-text search', () => {
  it('indexes a printed end-item identifier', () => {
    const publication = sessionSearchFields(session({ docType: 'i_type', endItems: [{ nsn: '', tamcn: '', id: 'PRINTED-2716', model: '' }] }));
    expect(findSearchMatch(publication, 'PRINTED-2716')?.field.sectionId).toBe('cover');
  });
  it('excludes structural parent identities while retaining the component text', () => {
    const sl3 = sl3Schema.parse({ components: [{ id: 'row', category: 'ssri', parentId: 'private-parent-identity', nomenclature: 'Receiver' }] });
    const inventory = sessionSearchFields(session({ docType: 'sl3', formData: { sl3 } }));
    expect(findSearchMatch(inventory, 'private-parent-identity')).toBeUndefined();
    expect(findSearchMatch(inventory, 'Receiver')?.field.sectionId).toBe('sl3-inventory');
  });
  it('includes structured publication references', () => {
    const sl3 = sl3Schema.parse({ fieldingPlanReference: 'Orchid fielding plan' });
    expect(findSearchMatch(sessionSearchFields(session({ docType: 'sl3', formData: { sl3 } })), 'Orchid')?.field.sectionId).toBe('sl3-details');
  });
  it('includes empty configured row-group labels', () => {
    const form = fixtureInstance();
    const fields = sessionSearchFields(session({ documentCategory: 'forms', formType: 'fixture', genericForm: form }));
    expect(findSearchMatch(fields, 'Roster')?.field.sectionId).toBe('roster');
  });
  it('preserves classification choices, configured answer labels, and destinations', () => {
    expect(findSearchMatch(sessionSearchFields(session({ formData: { classLevel: 'cui' } })), 'cui')?.field.sectionId).toBe('classification');
    const form = fixtureInstance();
    form.answers.a = false;
    const fields = sessionSearchFields(session({ documentCategory: 'forms', formType: 'fixture', genericForm: form }));
    expect(findSearchMatch(fields, 'Decision Yes')?.field.sectionId).toBe('decision');
    expect(fields.some(field => field.text === 'A: No')).toBe(true);
    expect(fields.filter(field => /^Name(?::|$)/.test(field.text))).toHaveLength(1);
  });
  it('retains an obsolete choice value for recovery without indexing definition IDs', () => {
    const form = fixtureInstance();
    form.answers.decision = 'obsolete-choice';
    form.definition.definitionRevision = 'private-definition-revision';
    const fields = sessionSearchFields(session({ documentCategory: 'forms', formType: 'fixture', genericForm: form }));
    expect(findSearchMatch(fields, 'obsolete-choice')?.field.sectionId).toBe('decision');
    expect(findSearchMatch(fields, 'private-definition-revision')).toBeUndefined();
  });
  it('keeps malformed entries from breaking other search results', () => {
    const form = fixtureInstance();
    Object.assign(form.definition, { schemaVersion: 999 });
    expect(sessionSearchFields(session({ documentCategory: 'forms', formType: 'fixture', genericForm: form }))).toEqual([]);
    expect(sessionSearchFields({} as SerializedSession)).toEqual([]);
    expect(findSearchMatch(sessionSearchFields(session({ formData: { subject: 'Recoverable healthy entry' } })), 'healthy')?.field.sectionId).toBe('addressing');
  });
  it('returns detached, immutable search records', () => {
    const source = session({ formData: { subject: 'CAPTURED SUBJECT' } });
    const fields = sessionSearchFields(source);
    source.formData.subject = 'LATER SUBJECT';
    expect(findSearchMatch(fields, 'CAPTURED')?.field.text).toBe('CAPTURED SUBJECT');
    expect(() => Object.assign(fields[0], { sectionId: 'elsewhere' })).toThrow();
  });

  it('finds additional endorsement content in the signature section without indexing row IDs', () => {
    const fields = sessionSearchFields(session({ formData: { additionalEndorsements: [
      { id: 'private-row-id', endorsementBody: 'Approved for amphibious training.', endorsementSigLast: 'REVIEWER' },
    ] } }));
    expect(findSearchMatch(fields, 'amphibious')?.field.sectionId).toBe('signature');
    expect(findSearchMatch(fields, 'reviewer')?.field.sectionId).toBe('signature');
    expect(findSearchMatch(fields, 'private-row-id')).toBeUndefined();
  });
  it.each(['naval_letter', 'i_type'])('shows readable letterhead choices and retains search destinations for %s', (docType) => {
    const fields = sessionSearchFields(session({ docType, formData: { department: 'usmc', sealType: 'dow' } }));
    const sectionId = docType === 'i_type' ? 'cover' : 'letterhead';
    expect(findSearchMatch(fields, 'usmc')?.field).toMatchObject({ sectionId, text: 'Department / Service: United States Marine Corps (USMC)' });
    expect(findSearchMatch(fields, 'marine corps')?.field.sectionId).toBe(sectionId);
    expect(findSearchMatch(fields, 'dow')?.field).toMatchObject({ sectionId, text: 'Seal: Department of War (DoW)' });
    expect(findSearchMatch(fields, 'department of war')?.field.sectionId).toBe(sectionId);
  });
  it('preserves unknown choices and user prose without expanding abbreviations in content', () => {
    const fields = sessionSearchFields(session({ formData: { department: 'Custom service', sealType: '', subject: 'usmc/dow training' } }));
    expect(fields.map(field => field.text)).toContain('Department / Service: Custom service');
    expect(fields.map(field => field.text)).toContain('usmc/dow training');
    expect(fields.some(field => field.text.startsWith('Seal:'))).toBe(false);
  });
  it.each(Object.keys(DOC_TYPE_CONFIG).filter((type) => type !== 'sl3' && type !== 'sl4' && type !== 'tm_ietm_front_matter'))('finds body content and a real section for %s', (docType) => {
    const fields = sessionSearchFields(session({ docType, paragraphs: [{ text: 'Historic amphibious exercise request', level: 0 }] }));
    const match = findSearchMatch(fields, 'amphibious');
    expect(match?.field.sectionId).toBe('body');
    expect(getEditorSections(DOC_TYPE_CONFIG[docType], docType).some((s) => s.id === match?.field.sectionId)).toBe(true);
    expect(match?.snippet).toContain('amphibious');
  });
  it('searches both forms, including signature statements, without indexing images or unrelated forms', () => {
    const fields = sessionSearchFields(session({ documentCategory: 'forms', forms: { includeCoverPage: false,
      navmc10274: { ...useFormStore.getState().navmc10274, supplementalInfo: 'Orchid counseling', signatureBlocks: [{ name: 'SAMPLE', statement: 'Witnessed at harbor', style: 'image', image: 'data:image/png;base64,private' }] },
      navmc11811: { ...useFormStore.getState().navmc11811, remarksText: 'Other private draft' },
    } }));
    expect(findSearchMatch(fields, 'orchid')?.field.sectionId).toBe('content');
    expect(findSearchMatch(fields, 'harbor')?.field.sectionId).toBe('signatures');
    expect(findSearchMatch(fields, 'private')).toBeUndefined();
    const page11 = sessionSearchFields(session({ documentCategory: 'forms', formType: 'navmc_118_11', forms: { includeCoverPage: false, navmc11811: { ...useFormStore.getState().navmc11811, remarksTextRight: 'Starboard remarks', lastName: 'Example' } } }));
    expect(findSearchMatch(page11, 'starboard')?.field.sectionId).toBe('content');
    expect(findSearchMatch(page11, 'example')?.field.sectionId).toBe('marine');
  });
  it('matches words in different fields and centers a bounded snippet on distant matches', () => {
    expect(matchesSearch('EXERCISE request to Camp Lejeune', 'lejeune request')).toBe(true);
    expect(matchesSearch('EXERCISE request', 'request missing')).toBe(false);
    const match = findSearchMatch([{ text: 'x '.repeat(300) + 'target phrase' + ' y'.repeat(300), sectionId: 'body', label: 'Paragraphs' }], 'target phrase');
    expect(match?.snippet.length).toBeLessThanOrEqual(182);
    expect(match?.snippet).toContain('target phrase');
  });
  it('routes joint-party fields to commands and ignores inactive letterhead fields', () => {
    const fields = sessionSearchFields(session({ docType: 'joint_letter', formData: { jointSeniorName: 'Senior command', unitLine1: 'Hidden unit' } }));
    expect(findSearchMatch(fields, 'senior')?.field.sectionId).toBe('joint');
    expect(findSearchMatch(fields, 'hidden')).toBeUndefined();
  });
  it('routes technical-publication cover fields and end items to the cover', () => {
    const fields = sessionSearchFields(session({ docType: 'i_type', formData: { subject: 'Radar maintenance', unitLine1: 'Test issuing command' }, endItems: [{ nsn: '5820-01-234-5678', tamcn: '', id: '', model: 'Training receiver' }] }));
    expect(findSearchMatch(fields, 'radar')?.field.sectionId).toBe('cover');
    expect(findSearchMatch(fields, 'issuing')?.field.sectionId).toBe('cover');
    expect(findSearchMatch(fields, 'receiver')?.field.sectionId).toBe('cover');
  });
});
