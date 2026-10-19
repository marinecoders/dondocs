import { describe, it, expect } from 'vitest';
import { templateSession } from '@/lib/templateSession';
import { LETTER_TEMPLATES } from '@/data/templates';
import { loadSharedSession, useDocumentStore } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';
import { useUserTemplatesStore } from '@/stores/userTemplatesStore';
import { getSerializedSessionForShare } from '@/stores/documentStore';

describe('reviewable templates', () => {
  it('opens a clean correspondence template from a form without carrying old addressing or distribution', () => {
    useDocumentStore.setState({ documentCategory: 'forms', formData: { to: 'Unrelated addressee', appendEndorsement: true }, distributions: [{ text: 'Unrelated distribution' }] });
    const session = templateSession(LETTER_TEMPLATES[0], { unitLine1: 'Selected unit' });
    loadSharedSession(session);
    const current = useDocumentStore.getState();
    expect(current.documentCategory).toBe('correspondence');
    expect(current.formData.to).toBeUndefined();
    expect(current.formData.appendEndorsement).toBeUndefined();
    expect(current.distributions).toEqual([]);
    expect(current.formData.unitLine1).toBe('Selected unit');
    expect(current.paragraphs.map((p) => p.text)).toEqual(LETTER_TEMPLATES[0].paragraphs.map((p) => p.text));
  });
  it('saves and restores a form template independently of other form content', () => {
    useDocumentStore.setState({ documentCategory: 'forms', formType: 'navmc_118_11' });
    useFormStore.getState().setNavmc11811Field('remarksText', 'Reusable entry');
    const id = useUserTemplatesStore.getState().saveTemplate('Page 11 example', getSerializedSessionForShare());
    const saved = useUserTemplatesStore.getState().templates[id];
    expect(saved.docType).toBe('navmc_118_11');
    useFormStore.getState().setNavmc11811Field('remarksText', 'Different entry');
    loadSharedSession(saved.session);
    expect(useFormStore.getState().navmc11811.remarksText).toBe('Reusable entry');
  });
});
