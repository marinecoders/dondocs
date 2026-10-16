import { describe, it, expect } from 'vitest';
import { sessionSearchFields, findSearchMatch, matchesSearch } from '@/lib/workspaceSearch';
import { getEditorSections } from '@/lib/editorSections';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { useFormStore } from '@/stores/formStore';
import type { SerializedSession } from '@/stores/documentStore';

const session = (patch: Partial<SerializedSession> = {}): SerializedSession => ({
  documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formType: 'navmc_10274',
  formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], timestamp: 0, ...patch,
});

describe('workspace full-text search', () => {
  it.each(Object.keys(DOC_TYPE_CONFIG))('finds body content and a real section for %s', (docType) => {
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
});
