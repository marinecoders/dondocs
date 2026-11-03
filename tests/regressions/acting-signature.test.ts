import { describe, it, expect } from 'vitest';
import { DOC_TYPE_CONFIG, type DocumentData, type Profile } from '@/types/document';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { generateSignatoryTex } from '@/services/latex/generator';
import { signingCapacity, signingCapacityPatch, supportsActingSignature } from '@/lib/signingAuthority';
import { profileFormPatch } from '@/stores/documentsStore';
import { parseProfileImport } from '@/lib/profileImport';
import { useDocumentStore } from '@/stores/documentStore';

function store(docType = 'naval_letter', fields: Partial<DocumentData> = {}) {
  return {
    docType, formData: {
      sigFirst: 'Mary', sigMiddle: 'L', sigLast: 'Brooks', sigRank: 'Colonel',
      sigTitle: 'Commanding Officer', acting: true,
      // A previous by-direction choice must never contaminate the Acting block.
      byDirection: true, byDirectionAuthority: 'the Commanding General', ...fields,
    },
    paragraphs: [{ text: 'Body.', level: 0 }], references: [], enclosures: [],
    copyTos: [], distributions: [],
  };
}

const singleTypes = Object.keys(DOC_TYPE_CONFIG).filter((type) =>
  supportsActingSignature(type) && DOC_TYPE_CONFIG[type].signature !== 'dual');

describe('Acting signatures', () => {
  it.each(singleTypes)('%s prints Acting independently of By direction in both generators', (type) => {
    const input = store(type);
    expect(generateSignatoryTex(input)).toContain('\\setByDirection{Acting}');
    expect(generateSignatoryTex(input)).not.toContain('By direction');
    const flat = generateFlatLatex(input);
    expect(flat).toContain('Acting');
    expect(flat).not.toContain('By direction');
  });

  it('prints only the name and Acting for a commander, despite a profile title', () => {
    const flat = generateFlatLatex(store());
    expect(flat).toContain('M. L. BROOKS');
    expect(flat).not.toContain('Colonel');
    expect(flat).not.toContain('Commanding Officer');
  });

  it('retains an explicitly supplied replacement title above Acting', () => {
    const input = store('naval_letter', { actingTitle: 'Deputy & Chief' });
    expect(generateSignatoryTex(input)).toContain('{Deputy \\& Chief}');
    expect(generateFlatLatex(input)).toMatch(/Deputy \\& Chief[\s\S]*Acting/);
  });

  it('ignores a stale acting title after switching back to Regular or By direction', () => {
    for (const byDirection of [false, true]) {
      const input = store('naval_letter', { acting: false, actingTitle: 'Deputy', byDirection });
      expect(generateFlatLatex(input)).not.toContain('Deputy');
      expect(generateSignatoryTex(input)).not.toContain('Deputy');
    }
  });

  it.each(['joint_letter', 'joint_memorandum', 'moa', 'mou'])('%s keeps each party’s Acting setting independent', (type) => {
    for (const [juniorActing, seniorActing] of [[true, false], [false, true], [true, true], [false, false]]) {
      const input = store(type, { juniorActing, seniorActing });
      const pdf = generateSignatoryTex(input);
      expect(pdf).toContain(`\\setByDirection{${seniorActing ? 'Acting' : ''}}`);
      expect(pdf).toContain(`\\renewcommand{\\JuniorByDirection}{${juniorActing ? 'Acting' : ''}}`);
      const flat = generateFlatLatex(input);
      expect(flat.match(/\bActing\b/g)?.length || 0).toBe(Number(juniorActing) + Number(seniorActing));
    }
  });

  it('preserves legacy joint-memo signers and keeps letter signers independent', () => {
    const legacy = store('joint_memorandum', {
      jointSeniorSigName: 'A. PARKER', jointSeniorSigTitle: 'Deputy',
      jointJuniorSigName: 'B. RIVERA', juniorActing: true,
    });
    for (const output of [generateSignatoryTex(legacy), generateFlatLatex(legacy)]) {
      expect(output).toContain('A. PARKER');
      expect(output).toContain('B. RIVERA');
    }
    const letter = { ...legacy, docType: 'joint_letter', formData: {
      ...legacy.formData, jointMemoSeniorSigName: 'STALE MEMO', jointMemoSeniorSigTitle: 'Old Memo Title',
    } };
    for (const output of [generateSignatoryTex(letter), generateFlatLatex(letter)]) {
      expect(output).toContain('A. PARKER');
      expect(output).not.toContain('STALE MEMO');
      expect(output).not.toContain('Old Memo Title');
    }
  });

  it('keeps Acting out of Info Memo and publication signature configuration', () => {
    for (const type of ['information_memorandum', 'i_type', 'sl3', 'sl4', 'tm_ietm_front_matter', 'navmc_10274']) {
      expect(supportsActingSignature(type)).toBe(false);
    }
    expect(generateFlatLatex(store('information_memorandum'))).not.toContain('Acting');
    expect(generateSignatoryTex(store('information_memorandum'))).not.toContain('{Acting}');
  });

  it('maps legacy by-direction documents and makes capacity changes exclusive', () => {
    expect(signingCapacity({ byDirection: true })).toBe('byDirection');
    expect(signingCapacity({})).toBe('regular');
    expect(signingCapacityPatch('acting')).toEqual({ acting: true, byDirection: false });
    expect(signingCapacityPatch('byDirection')).toEqual({ acting: false, byDirection: true });
    expect(signingCapacityPatch('regular')).toEqual({ acting: false, byDirection: false });
  });

  it('round-trips Acting profiles and clears it when applying a legacy profile', () => {
    const profile: Profile = {
      unitLine1: '', unitLine2: '', unitAddress: '', ssic: '', from: '',
      sigFirst: 'Mary', sigMiddle: 'L', sigLast: 'Brooks', sigRank: '', sigTitle: '',
      acting: true, actingTitle: 'Deputy', byDirection: true,
    };
    const restored = parseProfileImport(JSON.parse(JSON.stringify({ profiles: { Deputy: profile } })));
    expect(profileFormPatch(restored.Deputy)).toMatchObject({ acting: true, actingTitle: 'Deputy', byDirection: false });
    const { acting: _acting, actingTitle: _actingTitle, ...legacy } = profile;
    expect(profileFormPatch(legacy)).toMatchObject({ acting: false, actingTitle: '', byDirection: true });
  });

  it('clears all Acting settings on a blank-document reset', () => {
    useDocumentStore.getState().setFormData({ acting: true, actingTitle: 'Deputy', seniorActing: true, juniorActing: true });
    useDocumentStore.getState().resetForm();
    expect(useDocumentStore.getState().formData).toMatchObject({ acting: false, actingTitle: '', seniorActing: false, juniorActing: false });
  });
});
